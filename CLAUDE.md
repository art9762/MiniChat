# MiniChat

Мини-клон ChatGPT UI для работы с моделями через Trinity прокси. Сервис с авторизацией, инвайт-системой, балансом токенов и админ-панелью.

## Стек
- **Client:** React 19 + Vite + TypeScript + Tailwind CSS v4
- **Server:** Express + TypeScript (tsx) + SQLite (better-sqlite3)
- **Auth:** http-only cookie sessions + bcrypt
- **Workspaces:** npm workspaces (client, server)

## Trinity прокси
- Claude (Anthropic API): `https://gate.trinity.tg/aurora/v1`
- GPT (OpenAI API): `https://gate.trinity.tg/orion/v1`
- Ключи в `server/.env` (не коммитить!)

## Модели и прайсинг

Баланс — общий, в условных единицах. Списание идёт по факту ответа из `usage` стрима. Прайс задан в `server/lib/pricing.ts` (input/output на 1M токенов):

| ID | Провайдер | Tier | input | output |
|----|-----------|------|-------|--------|
| claude-opus-4-7 / 4-6 | anthropic | premium | 15 | 75 |
| claude-opus-*-1m | anthropic | premium | 30 | 150 |
| claude-sonnet-4-6 | anthropic | standard | 3 | 15 |
| claude-sonnet-4-6-1m | anthropic | standard | 6 | 30 |
| claude-haiku-4-5 | anthropic | fast | 1 | 5 |
| gpt-5.4 | openai | premium | 10 | 40 |
| gpt-5.2 | openai | standard | 3 | 12 |
| gpt-5-mini | openai | fast | 0.5 | 2 |

Формула: `cost = ceil((p.input * inTokens + p.output * outTokens) / 1000)`

## Авторизация и роли

- **Регистрация только по одноразовому инвайт-коду** (`INV-XXXX-XXXX`), который выпускает админ.
- Юзернейм 3-32 `[a-zA-Z0-9_]`, пароль ≥6 символов. Без email.
- Сессия — `httpOnly` cookie `mc_sid`, TTL 30 дней (таблица `sessions`).
- Роли: `user` | `admin`.
- Статусы: `active` | `suspended` (логин ок, чат недоступен) | `banned` (логин запрещён).
- Пополнение баланса — через одноразовый код `TKN-XXXX-XXXX` (выпуск админом, фиксированная сумма на код).

## БД (SQLite, `data/minichat.db`)

```
users        (id, username, password_hash, role, status, token_balance, created_at)
sessions     (id, user_id, created_at, expires_at)
invite_codes (code, created_by, created_at, used_by, used_at)
token_codes  (code, amount, created_by, created_at, used_by, used_at)
usage_log    (id, user_id, model, input_tokens, output_tokens, cost, created_at)
```

WAL mode, foreign keys ON. Папка `data/` в `.gitignore`.

## API

### Публичный
- `POST /api/auth/register` `{ username, password, inviteCode }` → cookie + user
- `POST /api/auth/login` `{ username, password }` → cookie + user
- `POST /api/auth/logout`
- `GET  /api/auth/me` (auth) → user
- `POST /api/auth/redeem` (auth) `{ code }` → `{ added, balance }`
- `GET  /api/models` (auth)
- `POST /api/chat` (auth) — стрим SSE; чанки: `{content}`, финальный `{usage:{inputTokens,outputTokens,cost,balance}}`, затем `[DONE]`. Возвращает 402 при пустом балансе.

### Админ (`requireAdmin`)
- `GET  /api/admin/stats` — счётчики (юзеры по статусам, открытые коды, total_spent/requests)
- `GET  /api/admin/users` — список + `requests`, `spent`
- `PATCH /api/admin/users/:id` `{ status?, role?, token_balance?, addTokens? }`
- `DELETE /api/admin/users/:id` (нельзя себя)
- `GET/POST/DELETE /api/admin/invites[/:code]`
- `GET/POST/DELETE /api/admin/token-codes[/:code]` (POST: `{ amount }`)

## UI

- `auth/AuthScreen` — двухшаговая регистрация (сначала инвайт, потом логин/пароль), переключение login/register.
- `App` — гейт по auth, бейдж баланса `⚡ N` в шапке, иконка Shield для админа, баннер при `suspended`, дизейбл инпута.
- `components/AccountMenu` — баланс, активация токен-кода, выход.
- `components/AdminPanel` — модалка с табами:
  - **Пользователи**: смена статуса/роли, прямое редактирование баланса
  - **Инвайты**: создать / скопировать / удалить неиспользованные
  - **Коды токенов**: задать сумму → создать; список с пометкой кем использован
  - **Статистика**: карточки сводных метрик

## Запуск

```bash
npm install

# Создать первого админа
ADMIN_USERNAME=admin ADMIN_PASSWORD=*** npm run seed:admin -w server

# server/.env:
# TRINITY_OPENAI_URL=https://gate.trinity.tg/orion/v1
# TRINITY_OPENAI_KEY=***
# TRINITY_ANTHROPIC_URL=https://gate.trinity.tg/aurora/v1
# TRINITY_ANTHROPIC_KEY=***
# CLIENT_ORIGIN=http://localhost:5173

npm run dev   # client :5173 (proxy /api → :3001), server :3001
```

## Структура

```
client/src/
  auth/
    AuthProvider.tsx     — контекст: user, login, register, logout, refresh, setBalance
    AuthScreen.tsx       — экран входа/регистрации
  components/
    AdminPanel.tsx       — модалка админки
    AccountMenu.tsx      — попап аккаунта (баланс, redeem, logout)
    Sidebar / ChatWindow / InputBar / ModelSelector / RightPanel / ...
  hooks/
    useChat.ts           — стрим, парсит content/usage/error, обновляет баланс
    useConversations.ts  — localStorage CRUD (диалоги пока локальные)
  lib/api.ts             — fetch с credentials:'include' + SSE парсер

server/
  index.ts               — express + cors(credentials) + cookie-parser + attachUser
  lib/
    db.ts                — SQLite + миграции при старте
    auth.ts              — bcrypt, sessions, cookie, requireAuth/requireAdmin
    pricing.ts           — прайсы моделей и calcCost
    providers.ts         — стримы OpenAI/Anthropic с onContent/onDone(usage)/onError
  routes/
    auth.ts              — register / login / logout / me / redeem
    admin.ts             — users / invites / token-codes / stats
    chat.ts              — auth, баланс-чек, списание, usage_log
  scripts/
    seed-admin.ts        — создание/промоут первого админа
```

## Conventions
- Модель определяется по префиксу: `claude*` → Anthropic, иначе → OpenAI.
- Бэкенд унифицирует SSE: `data: {"content": "..."}` для текста, `data: {"usage": {...}}` финал, `data: [DONE]`.
- Диалоги юзеров пока в `localStorage` (TODO: миграция в БД, чтобы админ видел чаты).
- Цены в `pricing.ts` — править там, без миграций БД.
- В клиенте все запросы — `credentials: "include"` (без этого cookie не идут).

## TODO / next
- Перенести диалоги из localStorage в БД, добавить просмотр диалогов юзера в админке.
- Rate limiting на `/auth/login` и `/auth/register`.
- TTL для инвайтов (сейчас вечные до использования).
- Логи действий админа (audit log).
- CSRF-защита на мутации (сейчас SameSite=lax спасает в большинстве случаев).
