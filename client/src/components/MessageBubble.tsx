import { Sparkles, Copy, Check, User as UserIcon, FileText, Image as ImageIcon, File } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Message, ChatAttachment } from "../types";

interface Props {
  message: Message;
  isLast?: boolean;
  isStreaming?: boolean;
}

function AttachmentCard({ att }: { att: ChatAttachment }) {
  const isImage = att.mimeType.startsWith("image/");
  const isPdf = att.mimeType === "application/pdf";
  const Icon = isImage ? ImageIcon : isPdf ? FileText : File;
  const downloadUrl = `/api/chats/${att.chatId}/attachments/${att.id}/download`;

  if (isImage) {
    return (
      <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={downloadUrl}
          alt={att.name}
          className="max-h-48 max-w-xs rounded-lg object-cover border border-[var(--border-subtle)]"
          loading="lazy"
        />
      </a>
    );
  }

  return (
    <a
      href={downloadUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] px-3 py-2 rounded-lg text-[13px] text-[var(--text-secondary)] transition-colors w-fit max-w-[240px]"
    >
      <Icon size={14} className="shrink-0 text-[var(--text-muted)]" />
      <span className="truncate">{att.name}</span>
    </a>
  );
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="code-block group/code">
      <div className="code-header">
        <span className="code-lang">{language || "text"}</span>
        <button onClick={handleCopy} className="code-copy" title="Copy code">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark as any}
        customStyle={{
          margin: 0,
          padding: "12px 14px",
          background: "transparent",
          fontSize: "12.5px",
          lineHeight: 1.55,
        }}
        codeTagProps={{ style: { fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace" } }}
        PreTag="div"
      >
        {value.replace(/\n$/, "")}
      </SyntaxHighlighter>
    </div>
  );
}

export function MessageBubble({ message, isLast, isStreaming }: Props) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const showCursor = !isUser && isLast && isStreaming && !message.content;

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isUser) {
    return (
      <div className="group flex gap-3 mb-6 justify-end">
        <div className="max-w-[85%]">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 justify-end">
              {message.attachments.map((att) => (
                <AttachmentCard key={att.id} att={att} />
              ))}
            </div>
          )}
          {message.content && (
            <div className="bg-[var(--bg-tertiary)] rounded-2xl rounded-tr-md px-4 py-2.5 text-[14px] text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </div>
          )}
        </div>
        <div className="w-7 h-7 rounded-full bg-[var(--bg-active)] flex items-center justify-center shrink-0 mt-0.5 text-[var(--text-secondary)]">
          <UserIcon size={14} />
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-3 mb-6">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#8ab4f8] to-[#c58af9] flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles size={13} className="text-[#1f1f1f]" strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="md-content text-[var(--text-primary)] leading-[1.65] text-[14px]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || "");
                const value = String(children ?? "");
                if (!inline && (match || value.includes("\n"))) {
                  return <CodeBlock language={match?.[1] ?? ""} value={value} />;
                }
                return (
                  <code className="md-inline-code" {...props}>
                    {children}
                  </code>
                );
              },
              a({ children, href, ...props }: any) {
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                    {children}
                  </a>
                );
              },
              table({ children }: any) {
                return (
                  <div className="md-table-wrap">
                    <table>{children}</table>
                  </div>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
          {showCursor && <span className="cursor-blink" />}
        </div>
        {message.content && (
          <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
              title="Copy"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
