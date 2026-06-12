# MiniChat → Claude Code Web: план реализации

> Цель: превратить MiniChat в аналог Claude Code Web — у каждого юзера персональная «виртуалка» (Docker-контейнер), в которой работает агент (Claude Code CLI), с полным доступом юзера к файловой системе, GitHub-интеграцией и новым UI в стиле ChatGPT на чисто чёрном фоне.

## Принятые решения (НЕ пересматривать без согласования)

| Вопрос | Решение |
|---|---|
| Движок агента | **Claude Code CLI** (`@anthropic-ai/claude-code`, ~2.1.x) внутри контейнера юзера, headless (`claude -p ... --output-format stream-json`), `ANTHROPIC_BASE_URL` указывает на **биллинг-прокси нашего сервера**, который форвардит в Trinity и списывает баланс |
| Жизненный цикл контейнера | **On-demand + persistent named volume**: volume живёт вечно, контейнер стартует при открытии воркспейса/запуске агента, авто-стоп по idle ~15 мин |
| Квота диска | 10 ГБ на юзера, **админы — без лимита** (override в БД) |
| Деплой | Linux-сервер с Docker; сервер управляет контейнерами через docker socket (**dockerode**). Dev — macOS Docker Desktop (⚠️ на момент написания локальный Docker daemon не запущен — перед E2E-тестами запустить Docker Desktop) |
| GitHub | **PAT-токен**: юзер вставляет в настройках, хранится в SQLite зашифрованным (AES-256-GCM, ключ из `server/.env`), в контейнер инжектится как git credential helper |
| UI | Полный редизайн: ChatGPT-стиль, чисто чёрный (`#000`), centered chat column, плюс новые вьюхи: Agent run, Files, Workspace, GitHub settings |
| Процесс | Версионирование semver + CHANGELOG.md, доки в `docs/` + ADR в `docs/adr/`, conventional commits |

## Существующая база (см. CLAUDE.md — он точный и актуальный)

- npm workspaces: `client/` (React 19 + Vite + TS + Tailwind v4), `server/` (Express + tsx + better-sqlite3).
- Авторизация: httpOnly cookie `mc_sid`, таблица `sessions`, роли user/admin, статусы active/suspended/banned, `requireAuth`/`requireAdmin` в `server/lib/auth.ts`.
- Биллинг: общий `token_balance`, прайс в `server/lib/pricing.ts`, формула `cost = ceil((p.input*in + p.output*out)/1000)`, списание в `routes/chat.ts` по факту `usage` из стрима, лог в `usage_log`, 402 при пустом балансе.
- Чат-стрим: SSE, чанки `data:{"content":...}` → финал `data:{"usage":{...}}` → `data:[DONE]`, провайдеры в `lib/providers.ts` (Anthropic/OpenAI через Trinity).
- Trinity: Claude `https://gate.trinity.tg/aurora/v1`, GPT `https://gate.trinity.tg/orion/v1`, ключи в `server/.env`.
- БД-миграции: выполняются при старте в `server/lib/db.ts` (SQLite, WAL, FK ON, файл `data/minichat.db`).
- Диалоги юзеров сейчас в localStorage (`useConversations.ts`).

---

## Фаза 0. Архитектура и ADR (делается первой, блокирует остальное)

Написать в `docs/adr/`:

1. **ADR-001: Workspace runtime** — per-user Docker-контейнер. Image: `node:22-bookworm` + git + gh + ripgrep + build-essential + `@anthropic-ai/claude-code` (глобально). Named volume `mc-ws-<userId>` примонтирован в `/workspace`. Контейнер: `mc-ws-<userId>`, лимиты `--memory 2g --cpus 2 --pids-limit 512`, `no-new-privileges`, non-root user, **без** проброса docker socket внутрь. Сеть: обычный bridge (агенту нужен интернет для npm/git), но `extra_hosts`/firewall на доступ к локалхосту сервера — доступ к API сервера только через выделенный alias биллинг-прокси.
2. **ADR-002: Биллинг агента** — Claude Code CLI в контейнере получает `ANTHROPIC_BASE_URL=http://host-gateway:3001/api/agent-proxy` (через `host.docker.internal` / `extra_hosts: host-gateway:host-gateway`) и `ANTHROPIC_API_KEY=<одноразовый scoped-токен воркспейса>`. Прокси: валидирует workspace-токен → проверяет баланс (402 если пусто) → форвардит на Trinity aurora с настоящим ключом → парсит usage из ответа/стрима (`message_start`/`message_delta`) → списывает по `pricing.ts` → пишет `usage_log`. Так CLI «думает», что говорит с Anthropic, а биллинг полностью наш.
3. **ADR-003: Квота 10 ГБ** — мягкая квота: периодический `du -sb /workspace` (docker exec) + проверка перед стартом агента и при upload; при превышении — блок записи агента (отказ запуска) и баннер в UI. (Жёсткая квота через xfs project quota — опционально на проде, отметить в deployment.md.)
4. **ADR-004: Стриминг агента в UI** — WebSocket `/api/agent/ws` (ws-пакет). Сервер запускает `docker exec` c `claude -p <prompt> --output-format stream-json --verbose`, парсит NDJSON-события (assistant text, tool_use, tool_result, result с total_cost/usage) и транслирует в WS как типизированные сообщения. Поддержка `--resume <sessionId>` для продолжения сессии, cancel = kill exec process.
5. **ADR-005: Хранение секретов** — PAT и workspace-токены: AES-256-GCM, ключ `SECRETS_KEY` (32 байта, hex) в `server/.env`, формат `iv:tag:ciphertext`.

## Фаза 1. Backend: БД + workspace manager

**Новые таблицы** (миграции в `lib/db.ts`, по образцу существующих):

```
workspaces      (user_id PK→users, volume_name, container_id, status: none|starting|running|stopped,
                 last_activity_at, disk_used_bytes, disk_quota_bytes DEFAULT 10737418240,
                 ws_token_hash, created_at)
github_tokens   (user_id PK→users, token_encrypted, github_username, connected_at)
agent_sessions  (id, user_id, title, cli_session_id, status: idle|running|error,
                 created_at, updated_at)
agent_events    (id, session_id→agent_sessions, type, payload_json, created_at)   -- история ранов
```

**`server/lib/docker.ts`** (dockerode):
- `ensureWorkspace(userId)` — volume + container create (image из ADR-001, env: `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY=ws-токен`, лимиты, labels `minichat.user=<id>`), start, статус в БД.
- `stopWorkspace(userId)`, `removeWorkspace(userId, {wipeVolume})`.
- `execInWorkspace(userId, cmd, opts)` — обёртка docker exec со стримами.
- Idle-reaper: setInterval 60s, стоп контейнеров с `last_activity_at` старше 15 мин.
- `getDiskUsage(userId)` — `du -sb /workspace`, кэш в `workspaces.disk_used_bytes`.
- Образ: `deploy/workspace-image/Dockerfile` + npm-скрипт `build:workspace-image`.

**Роуты `server/routes/workspace.ts`** (все под requireAuth):
- `GET /api/workspace` — статус + диск + квота.
- `POST /api/workspace/start`, `POST /api/workspace/stop`.
- `POST /api/workspace/reset` — wipe volume (с подтверждением).

## Фаза 2. Биллинг-прокси + агент-раннер

**`server/routes/agent-proxy.ts`** — реализация ADR-002. Принимает Anthropic Messages API запросы (`POST /api/agent-proxy/v1/messages`), auth по `x-api-key` = workspace-токен (bcrypt/hash-сверка с `ws_token_hash`), стриминг-passthrough на Trinity с перехватом usage. Модель из запроса CLI мапится на прайс `pricing.ts` (CLI шлёт `claude-sonnet-*`/`claude-opus-*`/`claude-haiku-*` — добавить fallback-прайс по префиксу для неизвестных ID). Списание и `usage_log` — как в `routes/chat.ts`.

**`server/lib/agent.ts` + `server/routes/agent.ts`**:
- `POST /api/agent/sessions` — создать сессию; `GET /api/agent/sessions` — список; `DELETE` — удалить.
- WS `GET /api/agent/ws?session=<id>` (пакет `ws`, upgrade на том же http-сервере, auth по cookie): клиент шлёт `{type:"prompt", text, model?}`, сервер: ensureWorkspace → проверка баланса/квоты → `docker exec claude -p ... --output-format stream-json --resume <cli_session_id>` → парсит NDJSON, пишет `agent_events`, транслирует `{type:"assistant_text"|"tool_use"|"tool_result"|"status"|"result"|"error", ...}`. `{type:"cancel"}` убивает exec.
- `claude` CLI настройки в контейнере: `--dangerously-skip-permissions` (изолированная среда — допустимо), cwd `/workspace`.

## Фаза 3. Files API + GitHub

**`server/routes/files.ts`** (requireAuth, всё через docker exec/getArchive на контейнере, path-traversal guard — нормализация и запрет выхода из `/workspace`):
- `GET /api/files?path=` — listing (имя, тип, размер, mtime).
- `GET /api/files/content?path=` — содержимое (лимит ~2 МБ, бинарные — 415).
- `PUT /api/files/content` — запись; `POST /api/files/mkdir|rename|delete`.
- `POST /api/files/upload` (multipart, multer) — putArchive в контейнер.
- `GET /api/files/download?path=` — файл: docker getArchive → распаковка одного entry → stream. Папка/весь воркспейс: getArchive tar → конвертация в zip (archiver) → stream.
- `GET /api/files/usage` — занято/квота.

**`server/routes/github.ts`**:
- `PUT /api/github/token` — сохранить PAT (шифрование ADR-005), валидация через `GET https://api.github.com/user`.
- `DELETE /api/github/token`, `GET /api/github` — статус (username, connected_at, без токена).
- При старте контейнера, если PAT есть: записать `~/.git-credentials` (`https://x-access-token:<PAT>@github.com`) + `git config credential.helper store` + `GH_TOKEN` env для gh CLI.
- `POST /api/github/clone` `{repoUrl, dir?}` — git clone в /workspace через exec.

## Фаза 4. UI редизайн + новые вьюхи

Глобально: `index.css` — новая палитра на чисто чёрном: `--bg-primary:#000`, `--bg-sidebar:#0a0a0a`, `--bg-elevated:#141414`, `--border-subtle:#1f1f1f`, акцент сдержанный (белый/серый, accent для кнопок). Стиль ChatGPT: узкая колонка чата по центру (max-w ~48rem), скруглённый «floating» composer с тенью внизу, сообщения без рамок (юзер — бабл справа/выделенный, ассистент — plain text), markdown-рендер с подсветкой кода (уже есть/добавить `react-markdown` + `shiki|highlight.js`).

Структура:
- **Sidebar** (ChatGPT-style): New chat, список диалогов, внизу — аккаунт. Переключатель режимов **Chat | Agent**.
- **Chat mode** — текущий функционал, рестайл.
- **Agent mode** (новое): тот же chat-layout, но рендер событий агента: текст ассистента; tool-use карточки (Bash: команда + collapsible вывод; Edit/Write: путь + diff-вью; Read/Glob/Grep: компактно); статус-строка (running/done, потрачено токенов/стоимость); кнопка Stop. Хук `useAgent.ts` поверх WebSocket.
- **Files panel** (правая панель или выезжающая): дерево `/workspace`, превью файла (read-only редактор или просмотр с подсветкой), кнопки Upload / Download file / Download workspace (.zip), индикатор `X.X GB / 10 GB`, Refresh.
- **Workspace chip** в хедере: статус контейнера (stopped/starting/running), Start/Stop, меню Reset.
- **Settings → GitHub**: поле PAT, статус подключения (username), Disconnect, форма Clone repo.
- Сохранить: AuthScreen, AccountMenu (redeem), AdminPanel — рестайл под новую палитру.

API-клиент: расширить `lib/api.ts` (REST + WS helper). Диалоги агент-сессий — с сервера (`agent_sessions`), обычный чат пока остаётся в localStorage (не трогать, отдельный TODO).

## Фаза 5. Админка

- Таб **Workspaces**: список (юзер, статус контейнера, диск, last activity), действия: Stop, Delete (с volume), смена квоты (поле bytes/GB, NULL = unlimited; у админов default unlimited — при создании workspace квота NULL если role=admin).
- Таб **Agent runs**: агрегаты из usage_log/agent_sessions (кол-во ранов, токены, стоимость по юзерам).
- Серверные роуты `server/routes/admin.ts` дополнить: `GET /api/admin/workspaces`, `PATCH /api/admin/workspaces/:userId` (quota), `POST /api/admin/workspaces/:userId/stop|delete`.

## Фаза 6. Доки, версии, деплой

- `docs/architecture.md` (схема: client ↔ server ↔ dockerode ↔ контейнеры; биллинг-флоу), `docs/api.md` (все роуты), `docs/deployment.md` (требования: Linux + Docker, socket-права, build workspace-image, env-переменные, как включить xfs-квоты), ADR из фазы 0.
- `CHANGELOG.md` (keep-a-changelog), bump до `1.0.0` (или 0.9.0 если решат, что бета), версии во всех трёх package.json.
- Обновить `CLAUDE.md`: новые таблицы, роуты, структура, env (`SECRETS_KEY`, `WORKSPACE_IMAGE`, `WORKSPACE_IDLE_MINUTES`), conventions.
- Обновить deploy-артефакты: docker-compose сервера — примонтировать `/var/run/docker.sock`, env, билд workspace-image в CI (`.github/workflows`).
- Conventional commits по фазам, без коммита `.env`/`data/`.

## Порядок и зависимости

```
Фаза 0 (ADR) → Фаза 1 (DB+docker) → Фаза 2 (прокси+агент) → Фаза 3 (files+github) → Фаза 6
                         ↘ Фаза 4 (UI) можно параллельно с 2–3 после ADR (моки API)
                              Фаза 5 (админка) после 1 и 3
```

## Acceptance criteria (E2E, нужен запущенный Docker)

1. Юзер логинится → открывает Agent mode → контейнер автостартует → пишет «создай express hello-world и запусти тесты» → видит стрим: текст, bash-команды с выводом, созданные файлы; баланс уменьшился, в `usage_log` строки с моделью агента.
2. Files: видит созданные файлы, открывает содержимое, скачивает один файл и весь workspace zip'ом; загружает файл — он виден агенту.
3. Перезапуск контейнера (idle 15 мин или Stop/Start) — файлы на месте; `--resume` продолжает сессию агента.
4. Баланс = 0 → запуск агента отдаёт 402, UI показывает понятную ошибку.
5. GitHub: вставил PAT → Clone приватного репо работает; агент может `git push`.
6. Квота: при >10 ГБ агент не стартует, UI показывает превышение; у админа лимита нет.
7. Админ видит все воркспейсы, может остановить/удалить, поменять квоту.
8. Не-админ не имеет доступа к чужим файлам/воркспейсам (проверить IDOR на всех новых роутах: всё скоупится по session user_id).
9. UI: чисто чёрный фон, ChatGPT-layout, старые флоу (login/register/redeem/admin) работают.

## Безопасность (обязательные пункты для ревью)

- Path traversal guard в files API (resolve + prefix-check `/workspace`).
- Workspace-токен ≠ Trinity-ключ; Trinity-ключи никогда не попадают в контейнер.
- Контейнеры: non-root, no-new-privileges, mem/cpu/pids лимиты, без docker socket, label-скоупинг при перечислении.
- PAT шифруется, никогда не возвращается в API после сохранения.
- Rate limit на agent-proxy (защита от спама из контейнера).
- WS auth: тот же cookie `mc_sid`, проверка при upgrade.
