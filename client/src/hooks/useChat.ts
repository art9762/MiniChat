import { useState, useCallback, useRef } from "react";
import { streamChat } from "../lib/api";
import type { Message, Settings, ChatAttachment, ChatSettings } from "../types";

export function useChat(
  messages: Message[],
  model: string,
  settings: Settings,
  onUpdate: (msgs: Message[]) => void,
  onBalance?: (balance: number) => void
) {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string, chatId?: string | null, attachments?: ChatAttachment[], chatSettings?: ChatSettings) => {
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
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
          .slice(0, -1)
          .map((m) => ({ role: m.role, content: m.content }));

        let content = "";
        let sources: { url: string; title: string }[] | undefined;
        let searchQuery: string | undefined;
        let fetchedUrl: string | undefined;
        let codeOutput: { stdout: string; stderr?: string } | undefined;

        for await (const chunk of streamChat({
          messages: apiMessages,
          model,
          temperature: settings.temperature,
          systemPrompt: settings.systemPrompt || undefined,
          chatId: chatId ?? undefined,
          attachmentIds: attachments?.map((a) => a.id),
          webSearch: chatSettings?.webSearch || undefined,
          urlFetch: chatSettings?.urlFetch || undefined,
          codeExec: chatSettings?.codeExec || undefined,
        })) {
          if ("content" in chunk) {
            content += chunk.content;
            const newMsgs = updated.map((m) =>
              m.id === assistantMsg.id ? { ...m, content, sources, searchQuery, fetchedUrl, codeOutput } : m
            );
            onUpdate(newMsgs);
          } else if ("usage" in chunk) {
            onBalance?.(chunk.usage.balance);
          } else if ("error" in chunk) {
            throw new Error(chunk.error);
          } else if ("toolUse" in chunk) {
            searchQuery = chunk.toolUse.query;
            const newMsgs = updated.map((m) =>
              m.id === assistantMsg.id ? { ...m, content, searchQuery } : m
            );
            onUpdate(newMsgs);
          } else if ("toolResult" in chunk) {
            sources = chunk.toolResult.results;
            const newMsgs = updated.map((m) =>
              m.id === assistantMsg.id ? { ...m, content, sources, searchQuery } : m
            );
            onUpdate(newMsgs);
          } else if ("urlFetch" in chunk) {
            fetchedUrl = chunk.urlFetch.url;
            const newMsgs = updated.map((m) =>
              m.id === assistantMsg.id ? { ...m, content, fetchedUrl } : m
            );
            onUpdate(newMsgs);
          } else if ("codeExec" in chunk) {
            codeOutput = chunk.codeExec;
            const newMsgs = updated.map((m) =>
              m.id === assistantMsg.id ? { ...m, content, codeOutput } : m
            );
            onUpdate(newMsgs);
          }
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
    [messages, model, settings, onUpdate, onBalance]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, stop, isStreaming };
}
