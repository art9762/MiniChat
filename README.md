# MiniChat

Mini ChatGPT-style UI that works with multiple AI models via [Trinity](https://gate.trinity.tg) proxy.

![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![React](https://img.shields.io/badge/React-19-61dafb)
![Vite](https://img.shields.io/badge/Vite-6-646cff)

## Features

- Streaming responses (SSE) from Claude and GPT models
- Multiple conversations with localStorage persistence
- Model selector with tier indicators (premium / standard / fast)
- Settings panel with system prompt and temperature controls
- Project chats pass their project context to the API for prompts, retrieval and memory
- File attachments, including messages sent with an attachment and no typed text
- Responsive UI with Tailwind CSS v4

## Tech Stack

| Layer | Tech |
|-------|------|
| Client | React + Vite + TypeScript + Tailwind CSS v4 |
| Server | Express + TypeScript (tsx) |
| Monorepo | npm workspaces (`client`, `server`) |

## Supported Models

| Model | Provider | Tier |
|-------|----------|------|
| claude-opus-4-7 | Anthropic | premium |
| claude-opus-4-6 | Anthropic | premium |
| claude-sonnet-4-6 | Anthropic | standard |
| claude-haiku-4-5 | Anthropic | fast |
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
npm install
```

### Configuration

Create `server/.env`:

```env
ANTHROPIC_API_KEY=your-key-here
OPENAI_API_KEY=your-key-here
```

### Run

```bash
npm run dev
```

This starts both servers concurrently:
- **Client:** http://localhost:5173
- **API:** http://localhost:3001

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

The client regression tests render the app with a simulated DOM and mocked API streams.
They cover the first message and API errors in a new chat, switching chats during a response,
project context in chat requests, and attachment-only messages. No API keys are needed.

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
