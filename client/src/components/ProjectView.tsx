import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageSquare, Files, Settings, Users, Upload, Trash2, Copy, Check,
  Download, UserMinus, LogOut, Plus, RefreshCw, X
} from "lucide-react";
import { api } from "../lib/api";
import type { ProjectDetail, ProjectFile, ProjectMember, Conversation } from "../types";
import type { User } from "../types";

interface Props {
  projectId: string;
  currentUser: User;
  conversations: Conversation[];
  onOpenChat: (chatId: string) => void;
  onCreateChat: (projectId: string) => void;
  onBack?: () => void;
}

type Tab = "chats" | "files" | "settings" | "members";

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

export function ProjectView({ projectId, currentUser, conversations, onOpenChat, onCreateChat, onBack }: Props) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const chats = conversations.filter((c) => c.project_id === projectId);
  const [tab, setTab] = useState<Tab>("chats");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Settings tab state
  const [settingsName, setSettingsName] = useState("");
  const [settingsDesc, setSettingsDesc] = useState("");
  const [settingsPrompt, setSettingsPrompt] = useState("");
  const [settingsMemory, setSettingsMemory] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Invite modal
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.getProject(projectId);
      setProject(p as ProjectDetail);
      setSettingsName((p as ProjectDetail).name ?? "");
      setSettingsDesc((p as ProjectDetail).description ?? "");
      setSettingsPrompt((p as ProjectDetail).master_prompt ?? "");
      setSettingsMemory((p as ProjectDetail).memory ?? "");
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const isOwner = project?.owner_id === currentUser.id;

  const handleSaveSettings = async () => {
    if (!project) return;
    setSettingsSaving(true);
    try {
      const patch: Record<string, string | null> = {
        description: settingsDesc || null,
        master_prompt: settingsPrompt || null,
        memory: settingsMemory || null,
      };
      if (isOwner) patch.name = settingsName;
      const updated = await api.updateProject(project.id, patch);
      setProject((prev) => prev ? { ...prev, ...(updated as any) } : prev);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch (e: any) {
      alert("Ошибка: " + e.message);
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleGenerateInvite = async () => {
    if (!project) return;
    setInviteLoading(true);
    try {
      const res = await api.createInvite(project.id) as any;
      setInviteUrl(res.url);
    } catch (e: any) {
      alert("Ошибка: " + e.message);
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyInvite = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  const handleRemoveMember = async (userId: string) => {
    if (!project) return;
    if (!confirm("Удалить участника?")) return;
    try {
      await api.removeMember(project.id, userId);
      setProject((prev) => prev ? {
        ...prev,
        members: prev.members.filter((m) => m.user_id !== userId),
      } : prev);
    } catch (e: any) {
      alert("Ошибка: " + e.message);
    }
  };

  const handleLeave = async () => {
    if (!project) return;
    if (!confirm("Покинуть проект?")) return;
    try {
      await api.removeMember(project.id, currentUser.id);
      onBack?.();
    } catch (e: any) {
      alert("Ошибка: " + e.message);
    }
  };

  const uploadFile = async (file: File) => {
    if (!project) return;
    setUploadLoading(true);
    try {
      const res = await api.uploadFile(project.id, file) as any;
      setProject((prev) => prev ? { ...prev, files: [res, ...prev.files] } : prev);
    } catch (e: any) {
      alert("Ошибка загрузки: " + e.message);
    } finally {
      setUploadLoading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) uploadFile(f);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) uploadFile(f);
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!project) return;
    if (!confirm("Удалить файл?")) return;
    try {
      await api.deleteFile(project.id, fileId);
      setProject((prev) => prev ? {
        ...prev,
        files: prev.files.filter((f) => f.id !== fileId),
      } : prev);
    } catch (e: any) {
      alert("Ошибка: " + e.message);
    }
  };

  const totalFileSize = project?.files.reduce((s, f) => s + f.size_bytes, 0) ?? 0;
  const MAX_STORAGE = 150 * 1024 * 1024;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm">
        Загрузка...
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--danger)] text-sm">
        {error || "Проект не найден"}
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "chats", label: "Чаты", icon: <MessageSquare size={14} /> },
    { id: "files", label: "Файлы", icon: <Files size={14} /> },
    { id: "settings", label: "Настройки", icon: <Settings size={14} /> },
    { id: "members", label: "Участники", icon: <Users size={14} /> },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 mb-1">
          {onBack && (
            <button onClick={onBack} className="btn-icon text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X size={16} />
            </button>
          )}
          <h1 className="text-[17px] font-semibold text-[var(--text-primary)] truncate">{project.name}</h1>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
            {isOwner ? "владелец" : "участник"}
          </span>
        </div>
        {project.description && (
          <p className="text-[12px] text-[var(--text-muted)] truncate">{project.description}</p>
        )}
        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                tab === t.id
                  ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">

        {/* CHATS TAB */}
        {tab === "chats" && (
          <div className="space-y-1">
            <button
              onClick={() => onCreateChat(project.id)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[13px] font-medium text-[var(--text-primary)] transition-colors mb-3"
            >
              <Plus size={15} strokeWidth={2.3} /> Новый чат
            </button>
            {chats.length === 0 && (
              <p className="text-[12px] text-[var(--text-faint)] text-center mt-8">
                Нет чатов в проекте
              </p>
            )}
            {chats.map((chat) => (
              <div
                key={chat.id}
                onClick={() => onOpenChat(chat.id)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-[var(--bg-hover)] transition-colors group"
              >
                <MessageSquare size={14} className="shrink-0 text-[var(--text-muted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-[var(--text-primary)] truncate">{chat.title || "Новый чат"}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{formatDate(chat.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* FILES TAB */}
        {tab === "files" && (
          <div>
            {/* Storage bar */}
            <div className="mb-4 p-3 rounded-xl bg-[var(--bg-secondary)]">
              <div className="flex justify-between text-[12px] text-[var(--text-muted)] mb-1.5">
                <span>Хранилище</span>
                <span>{formatBytes(totalFileSize)} / 150 MB</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                  style={{ width: `${Math.min((totalFileSize / MAX_STORAGE) * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-8 cursor-pointer transition-colors mb-4 ${
                isDragOver
                  ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                  : "border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Upload size={20} className="text-[var(--text-muted)]" />
              <span className="text-[13px] text-[var(--text-secondary)]">
                {uploadLoading ? "Загрузка..." : "Перетащите файл или нажмите для выбора"}
              </span>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileInputChange} />
            </div>

            {/* File list */}
            {project.files.length === 0 && (
              <p className="text-[12px] text-[var(--text-faint)] text-center mt-4">Файлы не загружены</p>
            )}
            <div className="space-y-1">
              {project.files.map((file: ProjectFile) => (
                <div key={file.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] group transition-colors">
                  <Files size={14} className="shrink-0 text-[var(--text-muted)]" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-[var(--text-primary)] truncate">{file.name}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {formatBytes(file.size_bytes)} · {file.mime_type} · {formatDate(file.uploaded_at)}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={`/api/projects/${project.id}/files/${file.id}`}
                      download={file.name}
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      <Download size={13} />
                    </a>
                    <button
                      onClick={() => handleDeleteFile(file.id)}
                      className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--danger)]"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SETTINGS TAB */}
        {tab === "settings" && (
          <div className="max-w-xl space-y-4">
            <div>
              <label className="block text-[12px] font-medium text-[var(--text-muted)] mb-1.5">Название</label>
              <input
                value={settingsName}
                onChange={(e) => setSettingsName(e.target.value)}
                disabled={!isOwner}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
              />
              {!isOwner && <p className="text-[11px] text-[var(--text-muted)] mt-1">Только владелец может переименовать</p>}
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--text-muted)] mb-1.5">Описание</label>
              <textarea
                value={settingsDesc}
                onChange={(e) => setSettingsDesc(e.target.value)}
                rows={2}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] resize-none"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[var(--text-muted)] mb-1.5">Системный промпт</label>
              <textarea
                value={settingsPrompt}
                onChange={(e) => setSettingsPrompt(e.target.value)}
                rows={4}
                placeholder="Общие инструкции для всех чатов проекта..."
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] resize-none font-mono"
              />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="block text-[12px] font-medium text-[var(--text-muted)]">Память проекта</label>
                <span className="flex items-center gap-1 text-[10px] text-[var(--text-faint)] px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)]">
                  <RefreshCw size={9} /> Auto-updated by AI
                </span>
              </div>
              <textarea
                value={settingsMemory}
                onChange={(e) => setSettingsMemory(e.target.value)}
                rows={4}
                placeholder="Контекст, автоматически обновляемый ИИ..."
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl px-3 py-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] resize-none font-mono"
              />
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={settingsSaving}
              className={`flex items-center gap-2 px-5 py-2 rounded-full text-[13px] font-medium transition-colors ${
                settingsSaved
                  ? "bg-[var(--success,#34d399)]/20 text-[var(--success,#34d399)]"
                  : "bg-[var(--accent)] text-white hover:opacity-90"
              } disabled:opacity-60`}
            >
              {settingsSaved ? <><Check size={14} /> Сохранено</> : settingsSaving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        )}

        {/* MEMBERS TAB */}
        {tab === "members" && (
          <div className="max-w-xl">
            {isOwner && (
              <div className="mb-5">
                <button
                  onClick={handleGenerateInvite}
                  disabled={inviteLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[13px] font-medium text-[var(--text-primary)] transition-colors"
                >
                  <Plus size={14} /> {inviteLoading ? "Генерация..." : "Создать ссылку-приглашение"}
                </button>
                {inviteUrl && (
                  <div className="mt-3 p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <div className="text-[11px] text-[var(--text-muted)] mb-2">Ссылка действительна 72 часа, 1 использование:</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[11px] text-[var(--text-secondary)] bg-[var(--bg-tertiary)] px-2 py-1.5 rounded-lg truncate font-mono">{inviteUrl}</code>
                      <button
                        onClick={handleCopyInvite}
                        className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
                      >
                        {inviteCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              {project.members.map((member: ProjectMember) => (
                <div key={member.user_id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] group transition-colors">
                  <div className="w-7 h-7 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-[12px] font-medium text-[var(--text-secondary)] shrink-0">
                    {member.username[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-[var(--text-primary)] truncate">
                      {member.username}
                      {member.user_id === currentUser.id && <span className="text-[var(--text-muted)] ml-1">(вы)</span>}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">{formatDate(member.added_at)}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    member.role === "owner"
                      ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                      : "bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                  }`}>
                    {member.role === "owner" ? "владелец" : "участник"}
                  </span>

                  {/* Actions */}
                  {isOwner && member.user_id !== currentUser.id && member.role !== "owner" && (
                    <button
                      onClick={() => handleRemoveMember(member.user_id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--danger)] transition-all"
                      title="Удалить участника"
                    >
                      <UserMinus size={13} />
                    </button>
                  )}
                  {!isOwner && member.user_id === currentUser.id && (
                    <button
                      onClick={handleLeave}
                      className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--danger)] transition-all"
                    >
                      <LogOut size={12} /> Покинуть
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
