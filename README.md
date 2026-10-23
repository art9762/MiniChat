# MiniChat

Chat with Claude and GPT models through the [Trinity](https://gate.trinity.tg) proxy,
organize conversations in projects, and attach documents or images.

![TypeScript](https://img.shields.io/badge/TypeScript-typed-3178c6)
![React](https://img.shields.io/badge/React-19-61dafb)
![Vite](https://img.shields.io/badge/Vite-8-646cff)

[Getting started](#getting-started) · [Checks](#checks) · [API](#api) · [Remaining work](TODO.md)

The current client keeps conversations in browser localStorage. Project settings,
membership, files and billing are stored by the server. Account isolation,
cancellation and broader integration coverage remain tracked in the [roadmap](TODO.md).

## Features

- Streaming responses (SSE) from Claude and GPT models
- Multiple conversations with localStorage persistence
- Model selection and server-side model pricing
- Settings panel with system prompt and temperature controls
- Project chats pass their project context to the API for prompts, retrieval and memory
- File attachments, including messages sent with an attachment and no typed text
- Invite-based accounts, token balances and an admin panel
- Responsive UI with Tailwind CSS v4

## Tech Stack

| Layer | Tech |
|-------|------|
| Client | React + Vite + TypeScript + Tailwind CSS v4 |
| Server | Express + TypeScript (tsx) + SQLite |
| Monorepo | npm workspaces (`client`, `server`) |

## Configured Models

The API exposes these model IDs. Availability depends on the configured Trinity gateway.

| Model | Provider | Tier |
|-------|----------|------|
| claude-opus-4-7 | Anthropic | premium |
| claude-opus-4-6 | Anthropic | premium |
| claude-sonnet-4-6 | Anthropic | standard |
| claude-haiku-4-5 | Anthropic | fast |
| claude-sonnet-4-6-1m | Anthropic | standard |
| claude-opus-4-6-1m | Anthropic | premium |
| claude-opus-4-7-1m | Anthropic | premium |
| gpt-5.4 | OpenAI | premium |
| gpt-5.2 | OpenAI | standard |
| gpt-5-mini | OpenAI | fast |

## Getting Started

### Prerequisites

- Node.js 22 (22.22.2 or later, matching the CI major version)
- API keys for Trinity proxy

### Installation

```bash
git clone https://github.com/art9762/MiniChat.git
cd MiniChat
npm ci
```

### Configuration

Create `server/.env` for local development. The four `TRINITY_*` values below are
required by [server startup validation](server/lib/env.ts); replace the placeholder
endpoints and keys with your provider configuration.

```env
PORT=3001
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:5173
SESSION_COOKIE_SECURE=0
TRINITY_OPENAI_URL=https://your-gate/openai/v1
TRINITY_OPENAI_KEY=your-openai-proxy-key
TRINITY_ANTHROPIC_URL=https://your-gate/anthropic
TRINITY_ANTHROPIC_KEY=your-anthropic-proxy-key
```

The [environment example](server/.env.example) contains production settings,
including secure cookies, allowed origins and `DATA_DIR`. SQLite and uploaded
files use `DATA_DIR`, or a `data` directory relative to the server's working
directory. Embeddings URL compatibility is an open item in the [roadmap](TODO.md).

For the first local admin account, set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in
your shell environment, then run `npm run seed:admin -w server`. Sign in as that
account to create invite codes and manage balances. Registration requires an invite.

### Run

```bash
npm run dev
```

This starts both servers concurrently:
- **Client:** http://localhost:5173
- **API:** http://localhost:3001

## Checks

```bash
npm run build
npm test
```

The client regression tests render the app with a simulated DOM and mocked API streams.
They cover the first message and API errors in a new chat, switching chats during a response,
project context in chat requests, and attachment-only messages. No API keys are needed.
The [CI workflow](.github/workflows/ci.yml) also builds both workspaces and checks
server startup, CSRF rejection and security headers with synthetic configuration.
Live model, embedding, retrieval and memory quality have not been validated by these tests.

## Publication

The existing [Docker workflow](.github/workflows/docker.yml) publishes images on
`main` pushes. The existing [Deploy workflow](.github/workflows/deploy.yml) also
runs on `main` pushes and uses the repository's configured deployment secrets.
Branch validation alone does not establish production behavior.

## Project Structure

```
client/
  src/
    components/   — Sidebar, ChatWindow, MessageBubble, InputBar, ModelSelector, SettingsPanel
    hooks/        — useChat (streaming), useConversations (localStorage CRUD)
    lib/api.ts    — fetch + SSE streaming to backend
server/
  lib/providers.ts  — OpenAI & Anthropic providers with SSE
  routes/chat.ts    — POST /api/chat, GET /api/models
```

## API

### `POST /api/chat`

Streams a chat completion. Body:

```json
{
  "model": "claude-sonnet-4-6",
  "messages": [{ "role": "user", "content": "Hello" }],
  "temperature": 0.7
}
```

Response: SSE stream with `data: {"content": "..."}` chunks, ending with `data: [DONE]`.

Optional `chatId` identifies the conversation. For a project chat, send `projectId`
to apply the project's prompt, retrieved files and memory (the server verifies membership).
To send uploaded attachments, include `chatId` and `attachmentIds` and keep a user
message in `messages`, even when its text is empty.

### `GET /api/models`

Returns the list of available models.

## License

MIT
