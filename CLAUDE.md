# MiniChat

Мини-клон ChatGPT UI для работы с моделями через Trinity прокси.

## Стек
- **Client:** React + Vite + TypeScript + Tailwind CSS v4
- **Server:** Express + TypeScript (tsx)
- **Workspaces:** npm workspaces (client, server)

## Trinity прокси
- Claude (Anthropic API): `https://gate.trinity.tg/aurora/v1`
- GPT (OpenAI API): `https://gate.trinity.tg/orion/v1`
- Ключи в `server/.env` (не коммитить!)

## Модели
| ID | Провайдер | Tier |
|----|-----------|------|
| claude-opus-4-7 | anthropic | premium |
| claude-opus-4-6 | anthropic | premium |
| claude-sonnet-4-6 | anthropic | standard |
| claude-haiku-4-5 | anthropic | fast |
| claude-sonnet-4-6-1m | anthropic | standard |
| claude-opus-4-6-1m | anthropic | premium |
| claude-opus-4-7-1m | anthropic | premium |
| gpt-5.4 | openai | premium |
| gpt-5.2 | openai | standard |
| gpt-5-mini | openai | fast |

## Запуск
```bash
npm install
# заполнить server/.env ключами
npm run dev  # client :5173, server :3001
```

## Структура
- `client/src/components/` — React компоненты (Sidebar, ChatWindow, MessageBubble, InputBar, ModelSelector, SettingsPanel)
- `client/src/hooks/` — useChat (стриминг), useConversations (localStorage CRUD)
- `client/src/lib/api.ts` — fetch + SSE стриминг к бэкенду
- `server/lib/providers.ts` — OpenAI и Anthropic провайдеры с SSE
- `server/routes/chat.ts` — POST /api/chat, GET /api/models

## Conventions
- Модель определяется по префиксу: `claude*` → Anthropic endpoint, остальное → OpenAI endpoint
- Бэкенд унифицирует SSE формат: `data: {"content": "..."}` и `data: [DONE]`
- Данные чатов хранятся в localStorage
