import { useState, useRef, useEffect } from "react";
import { ArrowUp, Square, Paperclip, X, FileText, Image as ImageIcon, File as FileIcon, Sliders } from "lucide-react";
import { api } from "../lib/api";
import type { ChatAttachment, ImageResolution } from "../types";

interface Props {
  onSend: (text: string, attachments: ChatAttachment[]) => void;
  isStreaming: boolean;
  disabled?: boolean;
  modelName?: string;
  chatId: string | null;
  attachmentsEnabled?: boolean;
  imageQuality?: ImageResolution;
  onImageQualityChange?: (q: ImageResolution) => void;
}

const QUALITY_LABEL: Record<ImageResolution, string> = {
  low: "Low",
  medium: "Med",
  high: "High",
};

const QUALITY_HINT: Record<ImageResolution, string> = {
  low: "512px · быстро/дёшево",
  medium: "1024px · по умолчанию",
  high: "1568px · детально",
};

// Client-side pre-downscale: huge originals (e.g. 4K phone shots) → ≤2048px webp
// before upload. Server then makes 3 final variants (low/medium/high).
const CLIENT_MAX_EDGE = 2048;

async function downscaleIfImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  // SVG and animated gif: pass through; webp/jpeg/png are safe to canvas-encode.
  if (file.type === "image/svg+xml" || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const w0 = bitmap.width;
    const h0 = bitmap.height;
    const maxEdge = Math.max(w0, h0);
    if (maxEdge <= CLIENT_MAX_EDGE) {
      bitmap.close?.();
      return file;
    }
    const scale = CLIENT_MAX_EDGE / maxEdge;
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", 0.9)
    );
    if (!blob) return file;
    // keep original name but switch ext to .webp so it's clear what was sent
    const baseName = file.name.replace(/\.[^./\\]+$/, "");
    return new File([blob], `${baseName}.webp`, { type: "image/webp" });
  } catch {
    return file;
  }
}

function AttachmentPill({ att, onRemove }: { att: ChatAttachment; onRemove: () => void }) {
  const isImage = att.mimeType.startsWith("image/");
  const Icon = isImage ? ImageIcon : att.mimeType === "application/pdf" ? FileText : FileIcon;
  return (
    <div className="flex items-center gap-1.5 bg-[var(--bg-hover)] text-[var(--text-secondary)] text-[12px] px-2 py-1 rounded-lg max-w-[180px]">
      <Icon size={12} className="shrink-0 text-[var(--text-muted)]" />
      <span className="truncate">{att.name}</span>
      <button
        onClick={onRemove}
        className="shrink-0 hover:text-[var(--danger)] transition-colors"
        title="Remove"
      >
        <X size={11} />
      </button>
    </div>
  );
}

export function InputBar({ onSend, isStreaming, disabled, modelName, chatId, attachmentsEnabled = true, imageQuality = "medium", onImageQualityChange }: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qualityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isStreaming) ref.current?.focus();
  }, [isStreaming]);

  useEffect(() => {
    if (!qualityOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!qualityRef.current?.contains(e.target as Node)) setQualityOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [qualityOpen]);

  const hasImageAttachment = attachments.some((a) => a.mimeType.startsWith("image/"));

  const handleSubmit = () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || isStreaming || disabled) return;
    onSend(trimmed, attachments);
    setText("");
    setAttachments([]);
    if (ref.current) {
      ref.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !chatId) return;
    setUploading(true);
    try {
      const prepared = await Promise.all(Array.from(files).map(downscaleIfImage));
      const uploads = await Promise.all(prepared.map((file) => api.uploadChatAttachment(chatId, file)));
      setAttachments((prev) => [...prev, ...uploads]);
    } catch (err: any) {
      alert(`Upload error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      className="px-2 sm:px-4 pt-2"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="max-w-3xl mx-auto">
        <div className="relative flex flex-col bg-[var(--bg-tertiary)] rounded-3xl px-2 py-2 transition-shadow focus-within:shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
          {/* Attachment pills */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2 pb-2">
              {attachments.map((att) => (
                <AttachmentPill
                  key={att.id}
                  att={att}
                  onRemove={() => {
                    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
                    api.deleteChatAttachment(att.chatId, att.id).catch(() => {});
                  }}
                />
              ))}
            </div>
          )}

          <div className="flex items-end">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp,.json,.csv,.js,.ts,.py,.rb,.go,.rs,.html,.css"
              onChange={(e) => handleFiles(e.target.files)}
              onClick={(e) => { (e.target as HTMLInputElement).value = ""; }}
            />
            <button
              disabled={!chatId || uploading || !attachmentsEnabled}
              onClick={() => fileRef.current?.click()}
              className="shrink-0 w-9 h-9 rounded-full hover:bg-[var(--bg-hover)] flex items-center justify-center text-[var(--text-muted)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={uploading ? "Uploading..." : chatId ? "Attach file" : "Send a message first to enable attachments"}
            >
              {uploading ? (
                <span className="w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
              ) : (
                <Paperclip size={16} />
              )}
            </button>
            {hasImageAttachment && onImageQualityChange && (
              <div ref={qualityRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setQualityOpen((v) => !v)}
                  className="h-9 px-2 rounded-full hover:bg-[var(--bg-hover)] flex items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  title={`Качество картинок: ${QUALITY_HINT[imageQuality]}`}
                >
                  <Sliders size={13} />
                  <span>{QUALITY_LABEL[imageQuality]}</span>
                </button>
                {qualityOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-44 bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl shadow-xl py-1 z-10">
                    <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Качество картинок</div>
                    {(["low", "medium", "high"] as ImageResolution[]).map((q) => (
                      <button
                        key={q}
                        onClick={() => { onImageQualityChange(q); setQualityOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--bg-hover)] flex items-center justify-between ${q === imageQuality ? "text-[var(--accent)]" : "text-[var(--text-primary)]"}`}
                      >
                        <span>{QUALITY_LABEL[q]}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{QUALITY_HINT[q]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <textarea
              ref={ref}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              placeholder={disabled ? "Чат недоступен" : "Type something..."}
              rows={1}
              className="flex-1 resize-none bg-transparent text-[14px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none min-h-[24px] max-h-[200px] leading-relaxed py-2 px-1"
              style={{ height: "auto", overflow: "hidden" }}
              onInput={(e) => {
                const el = e.target as HTMLTextAreaElement;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 200) + "px";
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={disabled || (!text.trim() && attachments.length === 0 && !isStreaming)}
              className="shrink-0 w-9 h-9 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-active)] disabled:text-[var(--text-faint)] flex items-center justify-center transition-colors text-[#1f1f1f]"
              title={isStreaming ? "Stop" : "Send (Enter)"}
            >
              {isStreaming ? <Square size={14} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.4} />}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center mt-2 gap-1">
          <p className="text-[11px] text-[var(--text-faint)]">
            MiniChat may display inaccurate info, including about people, so double-check responses.{modelName && <span className="ml-1">· {modelName}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}
