export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: number;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
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
