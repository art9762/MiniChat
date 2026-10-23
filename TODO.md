# MiniChat — remaining work

[Setup and checks](README.md) · [Chat API](server/routes/chat.ts) · [Database schema](server/lib/db.ts)

## Current state

The chat/project implementation includes streamed responses, first-message persistence,
project IDs in chat requests, and attachment-only sends. The Projects foundation
is already present; the original specification below is design history rather
than a list of features still awaiting implementation.

Implementation baseline `065a534` was checked on 2026-10-23: five rendered-app
regression tests, client/server builds and a temporary-database server smoke check
passed. [Hosted CI](https://github.com/art9762/MiniChat/actions/runs/39944309829)
also passed. Model streams are mocked in the client tests; live Trinity calls,
embedding/retrieval quality, automatic memory quality and real multi-user sessions
remain unverified.

## Priorities and acceptance criteria

P0 closes access-control gaps; P1 completes core behavior and its evidence; P2 follows
after those workflows are reliable. These are open tasks, not completed capabilities.

| Priority | Remaining task and source | Acceptance criteria |
|----------|---------------------------|---------------------|
| P0 | Account and attachment isolation. [Conversation storage](client/src/hooks/useConversations.ts) uses one browser key; [attachment access](server/routes/attachments.ts) permits authenticated access when a chat has no database row. | Two-account tests show no cross-account history after sign-out/sign-in. Unknown or unowned chat IDs cannot expose or accept another account's attachments; intended project-member access has explicit tests. |
| P1 | Complete Stop/cancellation across the [hook](client/src/hooks/useChat.ts), [composer](client/src/components/InputBar.tsx), [stream client](client/src/lib/api.ts) and [server](server/routes/chat.ts). | Stop aborts the browser request and upstream generation, preserves received text and settles/refunds the balance hold exactly once according to a tested billing rule. |
| P1 | Normalize upstream base URLs. [Chat providers](server/lib/providers.ts) append `/chat/completions`, while [embeddings](server/lib/embeddings.ts) append `/v1/embeddings`; the [example](server/.env.example) already includes `/v1`. | One documented configuration reaches both endpoints with no duplicated version segment. Local provider fixtures cover URLs, response validation and keyword fallback without paid calls. |
| P1 | Add API integration evidence for [billing, project context and attachments](server/routes/chat.ts). Current regression tests mock fetch. | Temporary SQLite and local provider fixtures cover success, upstream errors, disconnects, membership, ownership, prompt/context injection and memory hooks; balances and usage records agree in every terminal case. |
| P1 | Finish owned chat persistence and moving existing chats into projects. The [move API client](client/src/lib/api.ts) has no UI caller, and [conversation history](client/src/hooks/useConversations.ts) stays local. | An owned chat can be moved through the UI, survives reload with the same project and messages, and obeys account/project permissions. Coordinate with any proposed server-backed history work before implementing a duplicate. |
| P1 | Resolve dependency findings and broaden quality checks. Earlier installs reported audit advisories; the [client lint command](client/package.json) is separate from [CI](.github/workflows/ci.yml). | A fresh audit identifies current affected packages; fixes or documented exceptions accompany clean install/build/tests. Add useful lint/API coverage to CI and retain the existing chat regressions. |
| P2 | Complete attachment storage lifecycle and image-in-project policy. [Uploads](server/routes/attachments.ts) still have a cleanup TODO; [project indexing](server/routes/projects.ts) only indexes extracted text. | Unlinked files are cleaned after the documented retention period without deleting referenced files. The UI clearly states how project images are used, backed by tests for that chosen behavior. |
| P2 | Measure loading and mobile workflows. The prior production build reported a large client bundle. | Record bundle/load measurements and browser evidence for new chat, project navigation, upload, errors and cancellation; optimize measured bottlenecks with no behavior regressions. |

Agent workspaces are outside the current chat/project branch. Evaluate the existing
[agent-workspace proposal](https://github.com/art9762/MiniChat/pull/7) separately;
this roadmap does not treat it as shipped functionality.

## Original Projects specification

The following retains the agreed design. For the current schema and migrations,
use [server/lib/db.ts](server/lib/db.ts); the illustrative SQL below predates later
attachment migrations.

**Idea:** "Project" — это папка с чатами + собственная память/контекст для агента.

### Состав проекта
- **Папка чатов** — все чаты внутри проекта группируются вместе
- **Описание** — короткое summary
- **Master prompt** — системный промпт, автоинжект во все чаты проекта
- **Файлы** — загруженные документы, доступные через RAG
- **Память** — long-term заметка, **обновляется агентом автоматически**, юзер видит и может редактировать

### Решения (locked)
1. **Лимиты файлов:** 10 МБ на файл, 150 МБ на проект
2. **Форматы:** text (md/txt/code), images (png/jpg/webp), PDF, docx — с парсингом
   - **Те же форматы доступны как attachments в обычных чатах (вне проектов)**
3. **Контекст-стратегия:** **RAG** (embeddings + chunking + retrieval). Master prompt всегда инжектится целиком.
4. **Память проекта:** агент пишет автоматически после каждого чата (через summarize-pass), юзер может править textarea
5. **Шеринг:** **invite-ссылка** с одноразовым/limited токеном (`/projects/:id/join/:token`)
6. **Роли:** `owner` / `member` (member = full read+write кроме delete project и member management)
7. **Биллинг:** токены списываются с **автора сообщения**
8. **Перенос существующих чатов в проект:** да, сразу (drag или меню "Move to project")

### Схема БД
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  master_prompt TEXT,
  memory TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',  -- owner | member
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE project_invites (
  token       TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  max_uses    INTEGER NOT NULL DEFAULT 1,
  used_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE project_files (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  storage_path TEXT NOT NULL,         -- on-disk path under data/files/
  text_content TEXT,                  -- extracted text (NULL for images stored as vision)
  uploaded_by  TEXT NOT NULL REFERENCES users(id),
  uploaded_at  INTEGER NOT NULL
);

CREATE TABLE file_chunks (
  id          TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content     TEXT NOT NULL,
  embedding   BLOB NOT NULL,          -- Float32Array buffer
  token_count INTEGER NOT NULL
);
CREATE INDEX idx_file_chunks_project ON file_chunks(project_id);

-- Chat attachments (reusable for plain chats too)
CREATE TABLE chat_attachments (
  id           TEXT PRIMARY KEY,
  message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  text_content TEXT,
  created_at   INTEGER NOT NULL
);

ALTER TABLE chats ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
```

### Original delivery phases (historical)
- **P1 — Backend skeleton:** migrations, CRUD `/projects`, `/projects/:id/members`, invite flow. Move chat to project.
- **P2 — File parsing module:** shared lib `server/lib/files.ts` — parse PDF/docx/images/text. Used by projects + chat attachments.
- **P3 — RAG:** embeddings via Trinity, chunking (~500 tok), cosine retrieval, top-K injection into chat context. Master prompt always prepended.
- **P4 — Auto-memory:** post-chat hook → summarize → update `projects.memory`.
- **P5 — UI:** sidebar Projects section, project view (Chats / Files / Settings / Members), drag-to-project.
- **P6 — Chat attachments UI:** paperclip in composer, send images/PDFs/docs in plain chats.

### Открытые вопросы (можно решить по ходу)
- Embedding model: какая в Trinity? (надо проверить /v1/embeddings)
- Картинки в RAG: вместо embedding — multimodal vision call при retrieval, или OCR + text embed?
- Storage backend для файлов: пока локальный диск `data/files/{projectId}/{fileId}`
