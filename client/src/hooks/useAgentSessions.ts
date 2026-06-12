import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AgentSessionDTO } from "../agentTypes";

export function useAgentSessions(enabled: boolean) {
  const [sessions, setSessions] = useState<AgentSessionDTO[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { sessions } = await api.agentSessions();
      setSessions(sessions);
      setActiveId((cur) => cur ?? sessions[0]?.id ?? null);
    } catch {
      /* not authed yet */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  const create = useCallback(async () => {
    const { session } = await api.agentCreateSession();
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
    return session.id;
  }, []);

  const remove = useCallback(
    async (id: string) => {
      await api.agentDeleteSession(id);
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        setActiveId((cur) => (cur === id ? next[0]?.id ?? null : cur));
        return next;
      });
    },
    []
  );

  return { sessions, activeId, setActiveId, loading, refresh, create, remove };
}
