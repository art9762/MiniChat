# Minichat — Security Audit (pre-sale)

Дата: 2026-05-12. Аудит охватывает server/ (Express+SQLite) и client/ (React+Vite).

Шкала: 🔴 критично (фиксить до продажи) · 🟠 серьёзно · 🟡 средне · 🟢 best-practice

> **Статус (2026-05-12):** ветка `harden/security` закрывает всё критичное и серьёзное (1-12, 14-17, 20). Среднее/best-practice — backlog. Подходит для friends-only деплоя.

---

## 🔴 КРИТИЧЕСКОЕ — блокеры для прода

### 1. Invite/Token коды предсказуемы (Math.random) — ✅ FIXED
`server/routes/admin.ts:11-15` — `genCode` использует `Math.random()`. Это PRNG, не CSPRNG. Зная пару сгенерированных кодов и время, атакующий может восстановить состояние и перебрать соседние. При продаже токенов через коды это прямой денежный риск.

**Фикс:**
```ts
import { randomInt } from "crypto";
const part = (n: number) =>
  Array.from({ length: n }, () => chars[randomInt(0, chars.length)]).join("");
```

### 2. Нет CSRF-защиты — ✅ FIXED
Добавлен глобальный `csrfGuard` (`server/lib/csrf.ts`), требующий заголовок `X-Requested-With: minichat` на любой не-GET. Клиент шлёт его автоматически (`client/src/lib/api.ts`). В паре с SameSite=Lax + строгим CORS allow-list этого достаточно для friends-scope.

Сессии в httpOnly cookie + `credentials: include` + state-changing POST (`/chat`, `/redeem`, `/admin/*`). `SameSite=lax` спасает от классической CSRF, но:
- `lax` пропускает top-level GET и некоторые навигации;
- любой XSS на любом поддомене того же сайта обходит lax;
- если когда-нибудь смените на `none` для cross-origin SPA — всё рушится.

**Фикс:** double-submit CSRF-token (cookie + header `X-CSRF-Token`) на все mutating роуты, либо custom-header check (`X-Requested-With`) с CORS-whitelist.

### 3. Race condition на балансе → бесплатный Opus — ✅ FIXED
`server/routes/chat.ts:34-50` — pre-flight проверяет баланс, а списание идёт после `onDone`. Параллельные запросы все пройдут проверку. Списание делает `MAX(0, balance - cost)` → уход в минус «обрезается», т.е. пользователь получит N запросов бесплатно при balance≈cost.

**Фикс:** резервирование (hold) перед стартом стрима:
```sql
UPDATE users SET token_balance = token_balance - ?
WHERE id = ? AND token_balance >= ?
```
проверять `changes === 1`; в конце корректировать дельту (actual − estimate). Либо взять «верхний оптимистичный hold» = max возможный output × price.

### 4. Race condition на invite/token redemption — ✅ FIXED
`auth.ts /register` и `/redeem`: SELECT → UPDATE без атомарной проверки. Два запроса с одним кодом могут одновременно пройти SELECT (`used_by` null), потом оба UPDATE.

**Фикс:** в UPDATE добавить `AND used_by IS NULL` и смотреть `result.changes`:
```ts
const r = db.prepare(
  `UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL`
).run(...);
if (r.changes === 0) throw new Error("invite already used");
```

### 5. Нет rate limiting / brute-force protection — ✅ FIXED
`/login`, `/register`, `/redeem`, `/chat` — ничего. Можно:
- перебирать пароли админа;
- перебирать invite/token коды (особенно учитывая #1);
- DoS провайдеров через `/chat`.

**Фикс:** `express-rate-limit` + `express-slow-down`. Минимум:
- `/login`: 5 попыток/мин/IP, 20/час/username;
- `/register` + `/redeem`: 10/час/IP;
- `/chat`: 30/мин/user.

### 6. Whitelist моделей отсутствует — ✅ FIXED
`server/routes/chat.ts` принимает любую `model` строку от клиента и шлёт в upstream. `pricing.ts` для неизвестной модели возвращает DEFAULT (5/20) → возможен бесплатный доступ к более дорогой модели, если её id не в прайсе, но провайдер её обслужит.

**Фикс:** проверять `MODELS.find(m => m.id === body.model)` до вызова провайдера, иначе 400.

### 7. Утечка ошибок upstream в клиент — ✅ FIXED
`providers.ts` при ошибке отдаёт `text` от Trinity клиенту as-is через `onError`. Может содержать headers/keys/internal URL в текстах ошибок Anthropic/OpenAI-совместимого шлюза.

**Фикс:** логировать полный текст на сервер, клиенту отдавать дженерик `{ error: "upstream_error", status }`.

---

## 🟠 СЕРЬЁЗНОЕ

### 8. Нет лимита длины пароля → bcrypt DoS — ✅ FIXED (длина 6-128; async-bcrypt — backlog)
`/register` принимает любой пароль ≥6 символов, bcryptjs **синхронный** (`hashSync`, `compareSync`) и блокирует event loop. Пароль на 1 MB положит сервер.

**Фикс:** `password.length <= 128`; и переезд на нативный `bcrypt` (или argon2) с async API.

### 9. JSON body 2 MB → DoS / сжигание квоты — ✅ FIXED
`express.json({ limit: "2mb" })` + нет лимита на длину сообщения или количество messages в `/chat`. Пользователь шлёт 2 MB system prompt → улетает в провайдер → дорого/долго.

**Фикс:**
- `limit: "256kb"` для большинства эндпоинтов;
- проверка `messages.length <= 100` и суммарной длины content `<= 200_000` chars.

### 10. CORS / origin — ✅ FIXED
`origin: process.env.CLIENT_ORIGIN || "http://localhost:5173"` — в проде если переменная не задана, прод-фронт не получит cookie, а localhost разрешён. И нет sanity-check значения.

**Фикс:** в проде требовать `CLIENT_ORIGIN` (fail-fast если не задана), поддержать список через `,`.

### 11. NODE_ENV-зависимый `secure` cookie — ✅ FIXED
`secure: process.env.NODE_ENV === "production"`. Любой кто запустит без `NODE_ENV=production` (типичный косяк PM2/Docker) — отдаст session по HTTP. Лучше явный флаг `COOKIE_SECURE=1`.

### 12. Нет HTTPS enforcement — ✅ FIXED (helmet + trust proxy; HTTPS terminates на reverse proxy, см. DEPLOY.md)
HSTS, redirect HTTP→HTTPS, `trust proxy` под reverse-proxy — ничего нет. Обязательно при выкладке.

### 13. Регистрация → автологин с invite в одной операции
Если фронт повторит POST `/register` дважды (двойной клик), второй вернёт 409 «username taken», но invite уже занят. Не критично, но UX/abuse-vector в комбинации с другими багами.

**Фикс:** идемпотентность по invite + сразу serialize в одной транзакции.

### 14. Нет защиты от удаления последнего админа — ✅ FIXED
`DELETE /admin/users/:id` блокирует только self-delete. Один админ может удалить другого, потом случайно себя через UI или через бан → система без админов.

**Фикс:** проверка `COUNT(*) FROM users WHERE role='admin' AND status='active' > 1` перед demote/ban/delete админа.

### 15. Истёкшие сессии не чистятся — ✅ FIXED (hourly cleanup в `server/index.ts`)
`sessions` таблица растёт бесконечно. Не security per se, но утечка PII в backup.

**Фикс:** cron `DELETE FROM sessions WHERE expires_at < ?` (раз в час).

### 16. SOP вокруг ENV — ✅ FIXED (`server/lib/env.ts` assertEnv)
Ключи Trinity в `.env`. Нет проверки на старте, что они заданы — если пусто, fetch уйдёт в `undefined/v1/...` и упадёт runtime с подозрительным error в клиент.

**Фикс:** на старте `assertEnv(['TRINITY_OPENAI_URL','TRINITY_OPENAI_KEY','TRINITY_ANTHROPIC_URL','TRINITY_ANTHROPIC_KEY'])`.

---

## 🟡 СРЕДНЕЕ

### 17. Нет аудит-лога админских действий — ✅ FIXED
ban/suspend/grant tokens/delete user/invite & token-code create/delete пишутся в `admin_audit_log`. Доступ: `GET /api/admin/audit`.

### 18. Усечение баланса MAX(0, …) маскирует ошибки
Если cost > balance — баланс становится 0 без алерта. В сочетании с #3 — финансовая дыра.

**Фикс:** если списание превышает баланс — пометить юзера `suspended`, событие в audit log.

### 19. bcryptjs (pure JS) медленный и не constant-time на всех платформах
Для прода — нативный `bcrypt` или `argon2`. cost=10 ок, но проверьте latency под нагрузкой.

### 20. Helmet / security headers отсутствуют — ✅ FIXED
Нет `X-Frame-Options`, `X-Content-Type-Options`, CSP, Referrer-Policy.

**Фикс:** `import helmet from "helmet"; app.use(helmet());`

### 21. /me возвращает status/role
Не уязвимость, но stale-кеш на клиенте: если админ забанил юзера во время активной сессии, бэк это видит (`requireAuth`), но клиент не узнаёт пока не сделает запрос. Окей для MVP, флаг для продажи.

### 22. Логи неструктурированы
Только `console.log` в `index.ts`. Под прод — pino/winston + correlation-id.

### 23. SettingsPanel / systemPrompt
`systemPrompt` принимается от клиента и форвардится upstream. Это by design, но позволяет пользователю манипулировать промтом и темой запросов (включая нежелательный контент → политики Anthropic/OpenAI). Для продажи — добавить content moderation hook или хотя бы запись `systemPrompt` в usage_log для разбора инцидентов.

### 24. Нет limits на размер истории чата
Клиент шлёт всю историю → каждый запрос дороже. Серверный truncation/sliding-window сэкономит деньги и снизит attack surface.

### 25. Версии TypeScript/ESLint в `client/package.json` — фантомные
`"typescript": "~6.0.2"`, `"eslint": "^10.3.0"`, `"vite": "^8.0.12"`. На дату аудита таких релизов нет. Либо опечатка, либо locked на private mirror — проверь, что `npm install` детерминирован и не подтягивает что-то странное. `package-lock.json` обязан быть в репо.

---

## 🟢 BEST-PRACTICE / GAPS

- Нет password reset / email verification (нет email вообще — ок для invite-only, но gap).
- Нет 2FA для админа — для прода с биллингом стоит.
- Нет проверки силы пароля (только длина ≥6).
- Нет CAPTCHA на регистрации (invite-only смягчает).
- Backup БД — стратегия не описана. SQLite WAL хорошо, но нужен `litestream` или периодический dump.
- Нет CI с `npm audit` / `snyk` / SAST.
- Лицензии зависимостей не проверены — для продажи важно.
- `data/minichat.db` — права 600? Должны быть.

---

## Сводный план фикса (порядок приоритета)

1. CSPRNG для invite/token (#1) — 10 минут.
2. Whitelist моделей (#6) — 10 минут.
3. Атомарные UPDATE для invite/token redemption (#4) — 20 минут.
4. Balance hold на старте /chat вместо post-deduction (#3) — 1 час.
5. rate-limit на /login, /register, /redeem, /chat (#5) — 1 час.
6. Скрыть upstream errors (#7) + assert ENV (#16) — 30 минут.
7. CSRF token + helmet + COOKIE_SECURE флаг (#2, #11, #20) — 1–2 часа.
8. Лимиты: размер JSON, длина пароля, длина messages (#8, #9) — 30 минут.
9. Защита последнего админа + audit log (#14, #17) — 1 час.
10. Async-bcrypt/argon2, sessions cleanup, structured logs — backlog (#15, #19, #22).

Итого MVP-pack для безопасной продажи: **~6–8 часов работы**.

---

## Что у вас сделано хорошо

- Параметризованный SQL, без конкатенаций — SQLi нет.
- HttpOnly + SameSite=Lax cookie.
- Транзакции вокруг multi-statement операций.
- bcrypt вместо raw hash.
- Разделение требований: `requireAuth` / `requireAdmin`.
- FK `ON DELETE CASCADE` на usage_log/sessions.
- nanoid(32) для session id — корректный CSPRNG (в отличие от `genCode`).
- Pre-flight баланс хоть и слабый, но есть.

База здоровая. Дыры в основном в финансовой части и rate-limiting — типичная история для MVP. До продажи их обязательно закрыть.
