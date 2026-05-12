export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
  sources?: { url: string; title: string }[];
  searchQuery?: string;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  chatId: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: number;
  project_id?: string | null;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
}

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  master_prompt: string | null;
  memory: string | null;
  created_at: number;
  updated_at: number;
  role?: string; // current user's role
}

export interface ProjectMember {
  user_id: string;
  username: string;
  role: string;
  added_at: number;
}

export interface ProjectFile {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  uploaded_at: number;
}

export interface ProjectDetail extends Project {
  members: ProjectMember[];
  files: ProjectFile[];
}

export interface Settings {
  temperature: number;
  systemPrompt: string;
}

export interface User {
  id: string;
  username: string;
  role: "user" | "admin";
  status: "active" | "suspended" | "banned";
  token_balance: number;
  created_at: number;
}
