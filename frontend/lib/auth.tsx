import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, storage } from './storage';
import type { AuthTokens, User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, name: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function persistTokens(tokens: AuthTokens) {
  await storage.set(ACCESS_TOKEN_KEY, tokens.access_token);
  await storage.set(REFRESH_TOKEN_KEY, tokens.refresh_token);
}

async function clearTokens() {
  await storage.remove(ACCESS_TOKEN_KEY);
  await storage.remove(REFRESH_TOKEN_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api<User>('/api/users/me');
      setUser(me);
    } catch {
      setUser(null);
      await clearTokens();
    }
  }, []);

  useEffect(() => {
    (async () => {
      const token = await storage.get(ACCESS_TOKEN_KEY);
      if (token) await refreshUser();
      setLoading(false);
    })();
  }, [refreshUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    const tokens = await api<AuthTokens>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    await persistTokens(tokens);
    await refreshUser();
  }, [refreshUser]);

  const signUp = useCallback(async (email: string, name: string, password: string) => {
    await api('/api/auth/signup', {
      method: 'POST',
      body: { email, name, password },
      auth: false,
    });
    const tokens = await api<AuthTokens>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    await persistTokens(tokens);
    await refreshUser();
  }, [refreshUser]);

  const signOut = useCallback(async () => {
    await clearTokens();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut }),
    [user, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
