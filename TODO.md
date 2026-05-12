# Minichat — TODO

## 🗂 Projects (workspace-style folders)

**Idea:** "Project" — это папка с чатами + собственная память/контекст для агента.

### Состав проекта
- **Папка чатов** — все чаты внутри проекта группируются вместе
- **Описание** — короткое summary (что это за проект, зачем)
- **Master prompt** — системный промпт, который автоматически подставляется во все чаты проекта
- **Файлы** — загруженные документы/тексты, доступные агенту как контекст
- **Память** — отдельная "long-term" заметка/состояние, обновляемое между сессиями

### Шеринг
- Владелец проекта может **дать доступ друзьям** (по user id / по invite-ссылке)
- Роли: `owner` / `editor` / `viewer` (?)
- Совместная работа: несколько юзеров видят одни и те же чаты/файлы/память
- Биллинг: токены списываются с **автора сообщения**, не с владельца проекта

### Схема БД (draft)
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  master_prompt TEXT,
  memory TEXT,                    -- long-term notes
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'editor',  -- owner | editor | viewer
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE project_files (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  content     TEXT NOT NULL,      -- text content (or path to blob)
  size_bytes  INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  uploaded_at INTEGER NOT NULL
);

-- chats.project_id (nullable — chat outside any project)
ALTER TABLE chats ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
```

### API (draft)
- `GET    /projects` — мои проекты (own + shared)
- `POST   /projects` — создать
- `GET    /projects/:id` — детали
- `PATCH  /projects/:id` — name/description/master_prompt/memory
- `DELETE /projects/:id` — только owner
- `POST   /projects/:id/members` — { userId | inviteCode, role }
- `DELETE /projects/:id/members/:userId`
- `POST   /projects/:id/files` — multipart/text upload
- `GET    /projects/:id/files`
- `DELETE /projects/:id/files/:fileId`
- Chat-level: при создании chat можно передать `projectId`; master_prompt + files инжектятся в context.

### UI
- Сайдбар: секция **Projects** над списком чатов
- Клик на проект → раскрывает чаты проекта + кнопка "New chat in project"
- Внутри проекта: вкладки **Chats / Files / Settings / Members**
- Settings: name, description, master prompt (большой textarea), memory (textarea)
- Members: список + invite by username

### Открытые вопросы
- Лимит размера файлов? (small project, 1MB на файл, 10MB на проект?)
- Master prompt + файлы как считать в токенах? — учитывать в estimate перед send
- Делиться проектом по ссылке или только по username? — username проще
- Можно ли переносить существующий чат в проект? — да, drag-n-drop или меню

---

## Прочее
- (security hardening — DONE, merged to main)
