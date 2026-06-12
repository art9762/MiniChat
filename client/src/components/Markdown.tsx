import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { ComponentProps } from "react";

interface Props {
  children: string;
}

// Shared markdown renderer with syntax-highlighted code fences.
export function Markdown({ children }: Props) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words text-[var(--text-primary)] leading-relaxed text-[13px]">
      <ReactMarkdown
        components={{
          code({ className, children, ...props }: ComponentProps<"code"> & { inline?: boolean }) {
            const match = /language-(\w+)/.exec(className || "");
            const isBlock = !props.inline && (match || String(children).includes("\n"));
            if (isBlock) {
              return (
                <SyntaxHighlighter
                  style={oneDark as any}
                  language={match?.[1] || "text"}
                  PreTag="div"
                  customStyle={{ margin: 0, background: "transparent", fontSize: "0.8em" }}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
