import { useCallback, useEffect, useRef, useState } from "react";
import {
  Folder,
  FolderOpen,
  File as FileIcon,
  ChevronRight,
  ChevronDown,
  Upload,
  Download,
  RefreshCw,
  X,
  Loader,
  HardDrive,
} from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { api } from "../../lib/api";
import type { FileEntryDTO } from "../../agentTypes";

interface Props {
  onClose: () => void;
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", json: "json",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", c: "c",
  cpp: "cpp", h: "c", css: "css", html: "html", md: "markdown", sh: "bash",
  yml: "yaml", yaml: "yaml", toml: "toml", sql: "sql",
};
const langFor = (name: string) => EXT_LANG[name.split(".").pop()?.toLowerCase() ?? ""] ?? "text";

const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1e6) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(2)} GB`;
};

export function FilesPanel({ onClose }: Props) {
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number | null } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadDir] = useState(""); // upload to workspace root
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadUsage = useCallback(() => {
    api.filesUsage().then(setUsage).catch(() => {});
  }, []);

  useEffect(() => {
    loadUsage();
  }, [loadUsage, refreshKey]);

  const openFile = async (path: string) => {
    setSelected(path);
    setPreviewLoading(true);
    setPreviewErr(null);
    setPreview(null);
    try {
      const { content } = await api.fileContent(path);
      setPreview({ path, content });
    } catch (e: any) {
      setPreviewErr(e.message || "Не удалось открыть файл");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await api.fileUpload(uploadDir, file);
      setRefreshKey((k) => k + 1);
    } catch {
      /* surfaced via tree refresh */
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const pct =
    usage && usage.quotaBytes
      ? Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100)
      : 0;

  return (
    <aside className="w-80 border-l border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col shrink-0">
      <header className="flex items-center gap-2 px-3 h-11 border-b border-[var(--border)] shrink-0">
        <span className="section-label flex items-center gap-1.5">
          <Folder size={12} /> Files
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          title="Обновить"
        >
          <RefreshCw size={13} />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          title="Загрузить файл"
        >
          <Upload size={13} />
        </button>
        <a
          href={api.workspaceDownloadUrl()}
          className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          title="Скачать весь воркспейс"
        >
          <Download size={13} />
        </a>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          title="Закрыть"
        >
          <X size={14} />
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
      </header>

      {/* Usage bar */}
      {usage && (
        <div className="px-3 py-2 border-b border-[var(--border)]">
          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] mb-1">
            <span className="flex items-center gap-1">
              <HardDrive size={10} />
              {fmtBytes(usage.usedBytes)}
              {usage.quotaBytes != null ? ` / ${fmtBytes(usage.quotaBytes)}` : " / ∞"}
            </span>
            {usage.quotaBytes != null && <span>{pct.toFixed(0)}%</span>}
          </div>
          {usage.quotaBytes != null && (
            <div className="h-1 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-400" : "bg-[var(--accent)]"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1.5 min-h-0">
        <DirNode
          key={refreshKey}
          dir=""
          depth={0}
          selected={selected}
          onSelectFile={openFile}
          defaultOpen
        />
      </div>

      {/* Preview */}
      {(preview || previewLoading || previewErr) && (
        <div className="border-t border-[var(--border)] flex flex-col max-h-[45%] min-h-0">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] shrink-0">
            <FileIcon size={11} className="text-[var(--text-muted)] shrink-0" />
            <span className="text-[11px] font-mono text-[var(--text-secondary)] truncate flex-1">
              {selected}
            </span>
            {selected && (
              <a
                href={api.fileDownloadUrl(selected)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                title="Скачать файл"
              >
                <Download size={12} />
              </a>
            )}
            <button
              onClick={() => {
                setPreview(null);
                setPreviewErr(null);
                setSelected(null);
              }}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={12} />
            </button>
          </div>
          <div className="overflow-auto min-h-0">
            {previewLoading && (
              <div className="flex items-center gap-2 px-3 py-4 text-xs text-[var(--text-muted)]">
                <Loader size={13} className="spin" /> Загрузка…
              </div>
            )}
            {previewErr && <div className="px-3 py-3 text-xs text-red-400">{previewErr}</div>}
            {preview && (
              <SyntaxHighlighter
                style={oneDark as any}
                language={langFor(preview.path)}
                customStyle={{ margin: 0, background: "transparent", fontSize: "11px" }}
              >
                {preview.content}
              </SyntaxHighlighter>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

// ── Lazy-loading directory node ──────────────────────────────────────────────

function DirNode({
  dir,
  depth,
  selected,
  onSelectFile,
  defaultOpen,
}: {
  dir: string;
  depth: number;
  selected: string | null;
  onSelectFile: (path: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [entries, setEntries] = useState<FileEntryDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { entries } = await api.files(dir);
      entries.sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1
      );
      setEntries(entries);
    } catch (e: any) {
      setErr(e.message || "ошибка");
    } finally {
      setLoading(false);
    }
  }, [dir]);

  useEffect(() => {
    if (open && entries === null) load();
  }, [open, entries, load]);

  return (
    <div>
      {depth > 0 && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {open ? <FolderOpen size={12} className="text-amber-400/70" /> : <Folder size={12} className="text-amber-400/70" />}
          <span className="truncate">{dir.split("/").pop()}</span>
        </button>
      )}

      {open && (
        <div>
          {loading && (
            <div
              className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-[var(--text-muted)]"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <Loader size={10} className="spin" /> загрузка…
            </div>
          )}
          {err && (
            <div
              className="px-2 py-1 text-[10px] text-red-400"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              {err}
            </div>
          )}
          {entries?.length === 0 && (
            <div
              className="px-2 py-1 text-[10px] text-[var(--text-muted)]"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              пусто
            </div>
          )}
          {entries?.map((e) => {
            const path = join(dir, e.name);
            if (e.type === "dir") {
              return (
                <DirNode
                  key={path}
                  dir={path}
                  depth={depth + 1}
                  selected={selected}
                  onSelectFile={onSelectFile}
                />
              );
            }
            return (
              <button
                key={path}
                onClick={() => onSelectFile(path)}
                className={`w-full flex items-center gap-1 px-2 py-1 text-xs transition-colors ${
                  selected === path
                    ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
                style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              >
                <FileIcon size={12} className="opacity-50 shrink-0" />
                <span className="truncate flex-1 text-left">{e.name}</span>
                <span className="text-[9px] text-[var(--text-muted)] tabular-nums">
                  {fmtBytes(e.size)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
