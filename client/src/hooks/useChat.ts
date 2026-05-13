import { useState, useCallback, useRef } from "react";
import { streamChat } from "../lib/api";
import type { Message, Settings, ChatAttachment, ChatSettings, ToolEvent } from "../types";

const NAVIGATION_TOOLS = new Set(["web_search", "url_fetch"]);

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
    async (
      text: string,
      chatId?: string | null,
      attachments?: ChatAttachment[],
      chatSettings?: ChatSettings,
      projectId?: string | null,
    ) => {
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
        const toolEvents: ToolEvent[] = [];

        const imageQuality = chatSettings?.imageQuality ?? "medium";
        const attachmentIds = (attachments ?? []).map((a) =>
          a.mimeType.startsWith("image/") ? { id: a.id, resolution: imageQuality } : a.id,
        );

        const commit = () => {
          const newMsgs = updated.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content, sources, searchQuery, fetchedUrl, codeOutput, toolEvents: toolEvents.length ? [...toolEvents] : undefined }
              : m,
          );
          onUpdate(newMsgs);
        };

        for await (const chunk of streamChat({
          messages: apiMessages,
          model,
          temperature: settings.temperature,
          systemPrompt: settings.systemPrompt || undefined,
          chatId: chatId ?? undefined,
          attachmentIds,
          projectId: projectId ?? undefined,
          webSearch: chatSettings?.webSearch || undefined,
          urlFetch: chatSettings?.urlFetch || undefined,
          codeExec: chatSettings?.codeExec || undefined,
        })) {
          if ("content" in chunk) {
            content += chunk.content;
            commit();
          } else if ("usage" in chunk) {
            onBalance?.(chunk.usage.balance);
          } else if ("error" in chunk) {
            throw new Error(chunk.error);
          } else if ("toolUse" in chunk) {
            const name = chunk.toolUse.name;
            // Web/url legacy: still surface in compact header (searchQuery)
            if (NAVIGATION_TOOLS.has(name)) {
              searchQuery = chunk.toolUse.query;
            }
            toolEvents.push({
              key: `${name}-${toolEvents.length}-${Date.now()}`,
              name,
              query: chunk.toolUse.query,
              status: "running",
            });
            commit();
          } else if ("toolResult" in chunk) {
            const name = chunk.toolResult.name;
            const results = chunk.toolResult.results;
            // Legacy web_search/url_fetch: also populate sources for compact rendering
            if (NAVIGATION_TOOLS.has(name)) {
              sources = results;
            }
            // Update the most recent matching running event
            for (let i = toolEvents.length - 1; i >= 0; i--) {
              if (toolEvents[i].name === name && toolEvents[i].status === "running") {
                toolEvents[i] = { ...toolEvents[i], status: "done", results };
                break;
              }
            }
            commit();
          } else if ("urlFetch" in chunk) {
            fetchedUrl = chunk.urlFetch.url;
            commit();
          } else if ("codeExec" in chunk) {
            codeOutput = chunk.codeExec;
            commit();
          }
        }
      } catch (err: any) {
        const newMsgs = updated.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: `Error: ${err.message}` }
            : m,
        );
        onUpdate(newMsgs);
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, model, settings, onUpdate, onBalance],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, stop, isStreaming };
}
