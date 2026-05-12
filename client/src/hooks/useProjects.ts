import { useState, useCallback, useEffect } from "react";
import { api } from "../lib/api";
import type { Project } from "../types";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listProjects();
      setProjects(data as Project[]);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (name: string, description?: string) => {
    const p = await api.createProject({ name, description });
    setProjects((prev) => [p as Project, ...prev]);
    return p as Project;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const update = useCallback(async (id: string, patch: Record<string, string | null>) => {
    const updated = await api.updateProject(id, patch);
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...(updated as Project) } : p)));
    return updated as Project;
  }, []);

  return { projects, loading, error, refresh, create, remove, update };
}
