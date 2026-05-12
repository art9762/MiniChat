import { useState, useCallback, useRef } from "react";
import { streamChat } from "../lib/api";
import type { Message, Settings } from "../types";

export function useChat(
  messages: Message[],
  model: string,
  settings: Settings,
  onUpdate: (msgs: Message[]) => void
) {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      };
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
      };

      const updated = [...messages, userMsg, assistantMsg];
      onUpdate(updated);
      setIsStreaming(true);

      try {
        const apiMessages = updated
          .filter((m) => m.content || m.role === "assistant")
          .slice(0, -1) // exclude empty assistant
          .map((m) => ({ role: m.role, content: m.content }));

        let content = "";
        for await (const chunk of streamChat({
          messages: apiMessages,
          model,
          temperature: settings.temperature,
          systemPrompt: settings.systemPrompt || undefined,
        })) {
          content += chunk;
          const newMsgs = updated.map((m) =>
            m.id === assistantMsg.id ? { ...m, content } : m
          );
          onUpdate(newMsgs);
        }
      } catch (err: any) {
        const newMsgs = updated.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: `Error: ${err.message}` }
            : m
        );
        onUpdate(newMsgs);
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, model, settings, onUpdate]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, stop, isStreaming };
}
