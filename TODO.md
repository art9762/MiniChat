# Minichat — TODO

## 🗂 Projects (workspace-style folders) — SPEC LOCKED

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

### Phases (roadmap)
- **P1 — Backend skeleton:** migrations, CRUD `/projects`, `/projects/:id/members`, invite flow. Move chat to project. *(ready to start)*
- **P2 — File parsing module:** shared lib `server/lib/files.ts` — parse PDF/docx/images/text. Used by projects + chat attachments.
- **P3 — RAG:** embeddings via Trinity, chunking (~500 tok), cosine retrieval, top-K injection into chat context. Master prompt always prepended.
- **P4 — Auto-memory:** post-chat hook → summarize → update `projects.memory`.
- **P5 — UI:** sidebar Projects section, project view (Chats / Files / Settings / Members), drag-to-project.
- **P6 — Chat attachments UI:** paperclip in composer, send images/PDFs/docs in plain chats.

### Открытые вопросы (можно решить по ходу)
- Embedding model: какая в Trinity? (надо проверить /v1/embeddings)
- Картинки в RAG: вместо embedding — multimodal vision call при retrieval, или OCR + text embed?
- Storage backend для файлов: пока локальный диск `data/files/{projectId}/{fileId}`
