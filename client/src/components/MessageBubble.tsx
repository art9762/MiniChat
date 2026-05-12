import type { Message } from "../types";

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`py-4 px-4 ${isUser ? "" : "bg-zinc-50 dark:bg-zinc-800/50"}`}>
      <div className="max-w-3xl mx-auto flex gap-4">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-medium ${
            isUser
              ? "bg-blue-600 text-white"
              : "bg-emerald-600 text-white"
          }`}
        >
          {isUser ? "U" : "A"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium mb-1 text-zinc-500">
            {isUser ? "You" : "Assistant"}
          </p>
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap break-words">
            {message.content}
          </div>
        </div>
      </div>
    </div>
  );
}
