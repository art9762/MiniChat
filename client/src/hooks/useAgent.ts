import { useCallback, useEffect, useRef, useState } from "react";
import { openAgentSocket, type AgentSocket, api } from "../lib/api";
import type { AgentServerMessage } from "../agentTypes";

// ── Render items: a flattened, ordered list the AgentView can map over ───────
export type AgentItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant_text"; id: string; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; id: string; toolUseId: string; content: string; isError?: boolean }
  | { kind: "status"; id: string; status: string; detail?: string }
  | {
      kind: "result";
      id: string;
      costUnits: number;
      balance: number;
      inputTokens: number;
      outputTokens: number;
      durationMs?: number;
    }
  | { kind: "error"; id: string; message: string; code?: number };

let _seq = 0;
const nextId = () => `it_${Date.now()}_${_seq++}`;

function applyServerMessage(items: AgentItem[], msg: AgentServerMessage): AgentItem[] {
  switch (msg.type) {
    case "assistant_text": {
      // Coalesce consecutive assistant_text chunks into the trailing block.
      const last = items[items.length - 1];
      if (last && last.kind === "assistant_text") {
        return [
          ...items.slice(0, -1),
          { ...last, text: last.text + msg.text },
        ];
      }
      return [...items, { kind: "assistant_text", id: nextId(), text: msg.text }];
    }
    case "tool_use":
      return [...items, { kind: "tool_use", id: msg.id, name: msg.name, input: msg.input }];
    case "tool_result":
      return [
        ...items,
        {
          kind: "tool_result",
          id: nextId(),
          toolUseId: msg.id,
          content: msg.content,
          isError: msg.isError,
        },
      ];
    case "status":
      // Drop redundant trailing status updates (keep only the latest).
      return [
        ...items.filter((it) => it.kind !== "status"),
        { kind: "status", id: nextId(), status: msg.status, detail: msg.detail },
      ];
    case "result":
      return [
        ...items.filter((it) => it.kind !== "status"),
        {
          kind: "result",
          id: nextId(),
          costUnits: msg.costUnits,
          balance: msg.balance,
          inputTokens: msg.inputTokens,
          outputTokens: msg.outputTokens,
          durationMs: msg.durationMs,
        },
      ];
    case "error":
      return [...items, { kind: "error", id: nextId(), message: msg.message, code: msg.code }];
    default:
      return items;
  }
}

interface UseAgentOpts {
  sessionId: string | null;
  onBalance?: (balance: number) => void;
}

export function useAgent({ sessionId, onBalance }: UseAgentOpts) {
  const [items, setItems] = useState<AgentItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sockRef = useRef<AgentSocket | null>(null);
  const pendingRef = useRef<{ text: string; model?: string } | null>(null);
  const onBalanceRef = useRef(onBalance);
  onBalanceRef.current = onBalance;

  // Load persisted history + (re)open socket whenever the session changes.
  useEffect(() => {
    sockRef.current?.close();
    sockRef.current = null;
    pendingRef.current = null;
    setItems([]);
    setIsRunning(false);
    setConnected(false);
    setError(null);

    if (!sessionId) return;

    let cancelled = false;

    // 1. Replay persisted events for context.
    api
      .agentSessionEvents(sessionId)
      .then(({ events }) => {
        if (cancelled) return;
        setItems((prev) => events.reduce(applyServerMessage, prev));
      })
      .catch(() => {});

    // 2. Open the live socket.
    const sock = openAgentSocket(sessionId, {
      onOpen: () => {
        if (cancelled) return;
        setConnected(true);
        // Flush a prompt that was queued before the socket was ready.
        // The user item was already appended by send(); just transmit.
        const pending = pendingRef.current;
        if (pending) {
          pendingRef.current = null;
          sock.send({ type: "prompt", text: pending.text, model: pending.model });
        }
      },
      onClose: () => {
        if (cancelled) return;
        setConnected(false);
        setIsRunning(false);
      },
      onError: () => !cancelled && setError("Соединение с агентом прервано"),
      onMessage: (msg) => {
        if (cancelled) return;
        setItems((prev) => applyServerMessage(prev, msg));
        if (msg.type === "status") {
          setIsRunning(msg.status === "starting" || msg.status === "running");
          if (msg.status === "error") setError(msg.detail ?? "Ошибка агента");
        } else if (msg.type === "result") {
          setIsRunning(false);
          onBalanceRef.current?.(msg.balance);
        } else if (msg.type === "error") {
          setIsRunning(false);
          setError(msg.message);
        }
      },
    });
    sockRef.current = sock;

    return () => {
      cancelled = true;
      sock.close();
    };
  }, [sessionId]);

  const send = useCallback(
    (text: string, model?: string) => {
      if (!text.trim()) return;
      const sock = sockRef.current;
      // Socket not open yet (e.g. just-created session): queue and flush onOpen.
      if (!sock || sock.socket.readyState !== WebSocket.OPEN) {
        pendingRef.current = { text, model };
        setItems((prev) => [...prev, { kind: "user", id: nextId(), text }]);
        setIsRunning(true);
        return;
      }
      setError(null);
      setItems((prev) => [...prev, { kind: "user", id: nextId(), text }]);
      setIsRunning(true);
      sock.send({ type: "prompt", text, model });
    },
    []
  );

  const cancel = useCallback(() => {
    sockRef.current?.send({ type: "cancel" });
  }, []);

  return { items, isRunning, connected, error, send, cancel };
}
