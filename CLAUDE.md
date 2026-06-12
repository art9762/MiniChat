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
admin_audit_log (id, admin_id, action, target_id, payload, created_at)

-- Claude Code Web:
workspaces     (user_id PK, volume_name, container_id, status, last_activity_at,
                disk_used_bytes, disk_quota_bytes [NULL=unlimited], ws_token_hash, created_at)
github_tokens  (user_id PK, token_encrypted [AES-256-GCM iv:tag:ct], github_username, connected_at)
agent_sessions (id, user_id, title, cli_session_id, status: idle|running|error, created_at, updated_at)
agent_events   (id, session_id, type, payload_json, created_at)
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
- `GET  /api/admin/audit` — лог действий админа (last 500)
- `GET  /api/admin/workspaces` — все воркспейсы + username (из БД, без docker)
- `PATCH /api/admin/workspaces/:userId` `{ quotaBytes? | quotaGB? }` (null = unlimited)
- `POST /api/admin/workspaces/:userId/stop` (503 если docker недоступен)
- `POST /api/admin/workspaces/:userId/delete` `{ wipeVolume? }`
- `GET  /api/admin/agent-runs` — агрегаты `{ sessions, runs, tokens, cost }` по юзерам (прибл.: usage_log не разделяет chat/agent)

### Claude Code Web (все под `requireAuth`, скоуп по `req.user.id`)
- `GET  /api/workspace` · `POST /api/workspace/start|stop` · `POST /api/workspace/reset` `{ confirm:true }`
- `GET/POST /api/agent/sessions` · `DELETE /api/agent/sessions/:id`
- WS `GET /api/agent/ws?session=<id>` — auth по cookie на upgrade; клиент: `{type:"prompt",text,model?}`/`{type:"cancel"}`; сервер: `status|assistant_text|tool_use|tool_result|result|error` (см. `lib/agentTypes.ts`)
- `GET/PUT/POST /api/files*` — listing/content/mkdir/rename/delete/upload/download (guard `wsPath.ts`)
- `GET /api/github` · `PUT/DELETE /api/github/token` · `POST /api/github/clone`

### Биллинг-прокси агента (`x-api-key: wsk_…`, НЕ cookie)
- `POST /api/agent-proxy/v1/messages` — Anthropic Messages API surface для CLI в контейнере; auth по ws-токену (bcrypt vs `ws_token_hash`), форвард в Trinity aurora настоящим ключом, перехват usage, списание. Монтируется ДО глобального `express.json` (свой лимит 20mb).

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
# SECRETS_KEY=<64 hex / 32 bytes: openssl rand -hex 32>  # шифрование PAT
# WORKSPACE_IMAGE=minichat-workspace:latest
# WORKSPACE_IDLE_MINUTES=15
# AGENT_PROXY_BASE_URL=  # опц., по умолч. host.docker.internal:PORT/api/agent-proxy

# Образ воркспейса (для agent mode):
# npm run build:workspace-image -w server

npm run dev   # client :5173 (proxy /api → :3001), server :3001
```

## Структура

```
client/src/
  auth/
    AuthProvider.tsx     — контекст: user, login, register, logout, refresh, setBalance
    AuthScreen.tsx       — экран входа/регистрации
  components/
    AdminPanel.tsx       — модалка админки (+ табы Workspaces / Agent runs)
    AccountMenu.tsx      — попап аккаунта (баланс, redeem, logout)
    Sidebar / ChatWindow / InputBar / ModelSelector / RightPanel / ...
    agent / files / github — вьюхи Claude Code Web (Phase 4)
  hooks/
    useChat.ts           — стрим, парсит content/usage/error, обновляет баланс
    useConversations.ts  — localStorage CRUD (диалоги пока локальные)
    useAgent.ts          — WebSocket agent run (Phase 4)
  lib/api.ts             — fetch с credentials:'include' + SSE + WS хелперы
  agentTypes.ts          — зеркало server/lib/agentTypes.ts (WS протокол + DTO)

server/
  index.ts               — express + cors(credentials) + cookie-parser + attachUser
  lib/
    db.ts                — SQLite + миграции при старте (все таблицы)
    auth.ts              — bcrypt, sessions, cookie, requireAuth/requireAdmin
    pricing.ts           — прайсы моделей и calcCost (+ prefix-fallback для CLI)
    providers.ts         — стримы OpenAI/Anthropic с onContent/onDone(usage)/onError
    docker.ts            — dockerode: volume/container lifecycle, exec, disk, idle-reaper, DockerUnavailableError
    crypto.ts            — AES-256-GCM (encryptSecret/decryptSecret) + generateWorkspaceToken
    wsPath.ts            — path-traversal guard для files API
    rateLimit.ts         — limiter'ы login/register/redeem/chat/agentProxy/files
    agentTypes.ts        — контракты WS (AgentClient/ServerMessage) + REST DTO
    env.ts               — валидация env + workspace-конфиг
  routes/
    auth.ts              — register / login / logout / me / redeem
    admin.ts             — users / invites / token-codes / stats / audit / workspaces / agent-runs
    chat.ts              — auth, баланс-чек, списание, usage_log
    workspace.ts         — start/stop/reset/status контейнера (скоуп по user.id)
    agent.ts             — agent sessions CRUD + WS /api/agent/ws раннер
    agent-proxy.ts       — Anthropic Messages API surface для CLI (биллинг)
    files.ts             — файловый браузер через docker exec/archive
    github.ts            — PAT (шифр.) + clone
  scripts/
    seed-admin.ts        — создание/промоут первого админа

deploy/workspace-image/Dockerfile — образ контейнера юзера (node:22 + git/gh/rg + claude-code CLI)
docs/                   — architecture.md, api.md, deployment.md, adr/ADR-001..005
```

## UI / Дизайн
- **3-колоночный layout** в стиле Google AI Studio: sidebar | chat | right panel
- **Тема**: dark-black через CSS custom properties (`--bg-primary: #0a0a0a`, `--bg-sidebar: #060606`, etc.) в `index.css`
- **Дополнительные CSS-переменные**: `--bg-input`, `--border-subtle`, `--border-focus`, `--accent`, `--accent-hover`, `--accent-subtle`
- **Стилизация**: компактный профессиональный UI — rounded-md, мелкие шрифты (11-13px), uppercase section-лейблы с иконками
- **Header**: показывает название чата + текущую модель в моноширинном бейдже + индикатор Streaming
- **Sidebar**: тонкая кнопка New chat с бордером, версия в футере
- **Правая панель**: секции MODEL / SYSTEM PROMPT / TEMPERATURE с иконками, модели сгруппированы по провайдеру, tier-иконки (Crown/Zap/Gauge), context window, пресеты temperature
- **Сообщения**: кнопка Copy на hover, uppercase метки YOU/ASSISTANT
- **InputBar**: счётчик символов, подсказка Shift+Enter, border-t сверху
- **Welcome-экран**: минималистичный с иконкой Terminal
- **Список моделей**: hardcoded в `RightPanel.tsx` (массив MODELS + MODEL_INFO с описаниями, tier и context window)

## Claude Code Web (агентные воркспейсы)

Каждому юзеру — персональный Docker-контейнер (`mc-ws-<userId>`) + постоянный
volume в `/workspace`, где headless Claude Code CLI работает как агент. Полный
дизайн — в `docs/adr/ADR-001..005` и `docs/architecture.md`.

- **Runtime (ADR-001):** образ `deploy/workspace-image` (node:22 + git/gh/rg +
  `@anthropic-ai/claude-code`). Контейнер: non-root `node`, `no-new-privileges`,
  2 GiB/2 CPU/512 pids, **без** docker-сокета внутри. On-demand старт,
  idle-reaper стопит после `WORKSPACE_IDLE_MINUTES`. volume переживает рестарты.
- **Биллинг агента (ADR-002):** CLI получает `ANTHROPIC_BASE_URL` →
  `routes/agent-proxy.ts` и `ANTHROPIC_API_KEY=wsk_…` (ws-токен, bcrypt-хеш в
  `ws_token_hash`). Прокси: auth токена → баланс-чек → форвард в Trinity aurora
  настоящим ключом → перехват usage → списание + `usage_log`. Trinity-ключи
  никогда не попадают в контейнер. Прайсинг — тот же `pricing.ts` с
  prefix-fallback для полных Anthropic ID, что шлёт CLI.
- **Квота (ADR-003):** мягкая, 10 GiB (`du -sb` кэш в `disk_used_bytes`),
  проверка перед раном/аплоадом. Админы — `disk_quota_bytes = NULL` (unlimited).
- **Стриминг (ADR-004):** WS `/api/agent/ws`, `docker exec claude -p …
  --output-format stream-json [--resume <cli_session_id>]`, парс NDJSON →
  типизированные сообщения, события в `agent_events`, `cli_session_id` для
  продолжения.
- **Секреты (ADR-005):** PAT — AES-256-GCM (`SECRETS_KEY`), формат
  `iv:tag:ciphertext`, никогда не возвращается клиенту. ws-токены —
  bcrypt-хеш (не шифрование, сверка-only).
- **Деплой:** `npm run build:workspace-image -w server`; docker-compose монтирует
  `/var/run/docker.sock` (root-equivalent — см. `docs/deployment.md`); CI билдит
  оба образа. Биллинг агента и чата пишут в один `usage_log` (admin agent-runs —
  приближение).

## Conventions
- Модель определяется по префиксу: `claude*` → Anthropic, иначе → OpenAI.
- Бэкенд унифицирует SSE: `data: {"content": "..."}` для текста, `data: {"usage": {...}}` финал, `data: [DONE]`.
- Биллинг (chat и agent): hold → settle (атомарный pre-flight списание, реконсиляция по факту usage, рефанд при дисконнекте).
- Диалоги юзеров пока в `localStorage` (TODO: миграция в БД, чтобы админ видел чаты). Agent-сессии — на сервере (`agent_sessions`).
- Цены в `pricing.ts` — править там, без миграций БД.
- В клиенте все запросы — `credentials: "include"` (без этого cookie не идут).
- ESM на сервере: импорты с расширением `.js` (TS компилируется в ESM).
- Files API: любой путь через `resolveWorkspacePath` (guard от traversal).
- Не коммитить: `.env`, `.mcp.json`, `.claude/`, `.claude-flow/`

## TODO / next
- Перенести диалоги из localStorage в БД, добавить просмотр диалогов юзера в админке.
- TTL для инвайтов (сейчас вечные до использования).
- Опц. жёсткая квота через XFS project quotas (см. `docs/deployment.md`).
- Ротация `SECRETS_KEY` (сейчас — ручная перегенерация `github_tokens`).
