import { useEffect, useMemo, useRef, useState } from "react";
import {
  Terminal,
  ChevronRight,
  ChevronDown,
  FileText,
  Pencil,
  Eye,
  Search,
  Wrench,
  AlertCircle,
  Bot,
  Square,
  ArrowUp,
  Loader,
} from "lucide-react";
import { Markdown } from "../Markdown";
import type { AgentItem } from "../../hooks/useAgent";

interface Props {
  items: AgentItem[];
  isRunning: boolean;
  connected: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function AgentView({
  items,
  isRunning,
  connected,
  error,
  onSend,
  onCancel,
  disabled,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  // Map tool_use id → its result (rendered inline in the tool card).
  const resultsByToolId = useMemo(() => {
    const m = new Map<string, AgentItem & { kind: "tool_result" }>();
    for (const it of items) {
      if (it.kind === "tool_result") m.set(it.toolUseId, it);
    }
    return m;
  }, [items]);

  const latestResult = useMemo(
    () => [...items].reverse().find((it) => it.kind === "result") as
      | (AgentItem & { kind: "result" })
      | undefined,
    [items]
  );

  const hasContent = items.some(
    (it) => it.kind !== "status" && it.kind !== "tool_result"
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto">
        <div className="chat-col px-4 py-6 space-y-4">
          {!hasContent && (
            <div className="flex flex-col items-center justify-center text-center py-20">
              <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)] mb-4">
                <Bot size={20} className="text-[var(--text-muted)]" />
              </div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                Agent workspace
              </h2>
              <p className="text-xs text-[var(--text-muted)] max-w-xs">
                Опиши задачу — агент выполнит её в твоём контейнере: создаст
                файлы, запустит команды, склонирует репозитории.
              </p>
            </div>
          )}

          {items.map((it) => {
            if (it.kind === "tool_result") return null; // rendered inside tool_use card
            if (it.kind === "status") return null; // shown in footer
            if (it.kind === "user") {
              return (
                <div key={it.id} className="flex justify-end">
                  <div className="msg-user-bubble text-[13px] text-[var(--text-primary)] whitespace-pre-wrap break-words">
                    {it.text}
                  </div>
                </div>
              );
            }
            if (it.kind === "assistant_text") {
              return (
                <div key={it.id} className="flex gap-3">
                  <div className="w-6 h-6 rounded-md bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center shrink-0 mt-0.5">
                    <Bot size={12} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Markdown>{it.text}</Markdown>
                  </div>
                </div>
              );
            }
            if (it.kind === "tool_use") {
              return (
                <ToolCard
                  key={it.id}
                  name={it.name}
                  input={it.input}
                  result={resultsByToolId.get(it.id)}
                />
              );
            }
            if (it.kind === "error") {
              return (
                <div
                  key={it.id}
                  className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
                >
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span className="break-words">
                    {it.message}
                    {it.code === 402 && " — пополни баланс, чтобы продолжить."}
                  </span>
                </div>
              );
            }
            return null;
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <div className="chat-col px-4">
          <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 mb-1">
            <AlertCircle size={13} className="shrink-0" />
            {error}
          </div>
        </div>
      )}

      <AgentComposer
        isRunning={isRunning}
        connected={connected}
        disabled={disabled}
        onSend={onSend}
        onCancel={onCancel}
        result={latestResult}
      />
    </div>
  );
}

// ── Tool card ────────────────────────────────────────────────────────────────

const COMPACT_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "WebFetch", "TodoWrite"]);

function ToolCard({
  name,
  input,
  result,
}: {
  name: string;
  input: unknown;
  result?: AgentItem & { kind: "tool_result" };
}) {
  const inp = (input ?? {}) as Record<string, any>;

  // Compact one-liners for read-only / lookup tools.
  if (COMPACT_TOOLS.has(name)) {
    const detail =
      inp.file_path || inp.path || inp.pattern || inp.query || inp.url || "";
    const Icon = name === "Grep" ? Search : name === "Read" ? Eye : FileText;
    return (
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] pl-9">
        <Icon size={12} className="shrink-0" />
        <span className="font-medium text-[var(--text-secondary)]">{name}</span>
        {detail && <span className="font-mono truncate">{String(detail)}</span>}
        {result?.isError && <span className="text-red-400">error</span>}
      </div>
    );
  }

  if (name === "Bash") {
    return (
      <BashCard
        command={String(inp.command ?? "")}
        description={inp.description ? String(inp.description) : undefined}
        result={result}
      />
    );
  }

  if (name === "Write" || name === "Edit" || name === "MultiEdit") {
    return <WriteCard name={name} input={inp} result={result} />;
  }

  // Generic fallback card.
  return (
    <div className="tool-card pl-0 ml-9">
      <div className="flex items-center gap-2 px-3 py-2 text-[11px]">
        <Wrench size={12} className="text-[var(--text-muted)]" />
        <span className="font-medium text-[var(--text-secondary)]">{name}</span>
      </div>
      {result && <ToolOutput content={result.content} isError={result.isError} />}
    </div>
  );
}

function BashCard({
  command,
  description,
  result,
}: {
  command: string;
  description?: string;
  result?: AgentItem & { kind: "tool_result" };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-card ml-9">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
        <Terminal size={12} className="text-emerald-400 shrink-0" />
        <code className="text-[12px] font-mono text-[var(--text-primary)] truncate flex-1">
          {command}
        </code>
        {result && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
            title={open ? "Скрыть вывод" : "Показать вывод"}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        )}
      </div>
      {description && (
        <div className="px-3 py-1 text-[10px] text-[var(--text-muted)] italic">
          {description}
        </div>
      )}
      {result && open && <ToolOutput content={result.content} isError={result.isError} />}
    </div>
  );
}

function WriteCard({
  name,
  input,
  result,
}: {
  name: string;
  input: Record<string, any>;
  result?: AgentItem & { kind: "tool_result" };
}) {
  const [open, setOpen] = useState(false);
  const path = input.file_path || input.path || "";
  const body =
    name === "Write"
      ? String(input.content ?? "")
      : input.new_string != null
      ? `- ${String(input.old_string ?? "")}\n+ ${String(input.new_string)}`
      : "";
  return (
    <div className="tool-card ml-9">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors"
      >
        <Pencil size={12} className="text-amber-400 shrink-0" />
        <span className="text-[11px] font-medium text-[var(--text-secondary)]">{name}</span>
        <code className="text-[12px] font-mono text-[var(--text-primary)] truncate flex-1">
          {String(path)}
        </code>
        {body && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
      </button>
      {open && body && (
        <pre className="px-3 py-2 text-[11px] font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap break-words border-t border-[var(--border)] max-h-72 overflow-y-auto">
          {body}
        </pre>
      )}
      {result?.isError && (
        <ToolOutput content={result.content} isError />
      )}
    </div>
  );
}

function ToolOutput({ content, isError }: { content: string; isError?: boolean }) {
  return (
    <pre
      className={`px-3 py-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-72 overflow-y-auto ${
        isError ? "text-red-400" : "text-[var(--text-secondary)]"
      }`}
    >
      {content || "(нет вывода)"}
    </pre>
  );
}

// ── Composer + status/cost footer ────────────────────────────────────────────

function AgentComposer({
  isRunning,
  connected,
  disabled,
  onSend,
  onCancel,
  result,
}: {
  isRunning: boolean;
  connected: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  result?: AgentItem & { kind: "result" };
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t || isRunning || disabled) return;
    onSend(t);
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  };

  return (
    <div className="px-3 pb-3 pt-1">
      <div className="composer-wrap mb-1.5 flex items-center justify-between px-2 text-[10px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          {isRunning ? (
            <>
              <Loader size={11} className="spin text-[var(--accent)]" />
              <span className="text-[var(--accent)]">Агент работает…</span>
            </>
          ) : (
            <span className={connected ? "text-emerald-500/70" : "text-[var(--text-muted)]"}>
              {connected ? "● готов" : "○ не подключён"}
            </span>
          )}
        </span>
        {result && (
          <span className="flex items-center gap-3 tabular-nums">
            <span>
              {result.inputTokens.toLocaleString()}↑ {result.outputTokens.toLocaleString()}↓
            </span>
            <span className="text-[var(--text-secondary)]">−{result.costUnits} ед.</span>
            <span>⚡ {result.balance.toLocaleString()}</span>
          </span>
        )}
      </div>
      <div className="composer-wrap">
        <div className="composer flex items-end px-3 py-2.5">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={disabled}
            placeholder={disabled ? "Недоступно" : "Дай задачу агенту…"}
            rows={1}
            className="flex-1 resize-none bg-transparent text-[13px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none min-h-[22px] max-h-[200px] leading-relaxed"
            style={{ height: "auto", overflow: "hidden" }}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 200) + "px";
            }}
          />
          <button
            onClick={isRunning ? onCancel : submit}
            disabled={disabled || (!isRunning && !text.trim())}
            className="shrink-0 w-8 h-8 ml-2 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-muted)] flex items-center justify-center transition-colors text-white"
            title={isRunning ? "Остановить" : "Отправить"}
          >
            {isRunning ? <Square size={11} /> : <ArrowUp size={15} />}
          </button>
        </div>
        <p className="text-[10px] text-[var(--text-muted)] text-center mt-1.5">
          Агент выполняет команды в изолированном контейнере. Shift+Enter — новая строка.
        </p>
      </div>
    </div>
  );
}
