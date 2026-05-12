import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import type { User } from "../types";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>;
  register: (u: string, p: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  setBalance: (n: number) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (username: string, password: string) => {
    const { user } = await api.login(username, password);
    setUser(user);
  };
  const register = async (username: string, password: string, code: string) => {
    const { user } = await api.register(username, password, code);
    setUser(user);
  };
  const logout = async () => {
    await api.logout();
    setUser(null);
  };
  const setBalance = (n: number) =>
    setUser((u) => (u ? { ...u, token_balance: n } : u));

  return (
    <Ctx.Provider value={{ user, loading, refresh, login, register, logout, setBalance }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
