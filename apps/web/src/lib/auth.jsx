import React, { createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);
const STORAGE_KEY = 'df_username';

export function AuthProvider({ children }) {
  const [username, setUsername] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState('');

  const loginRequest = useCallback(async (clean) => {
    const data = await api('/auth/dev-login', {
      method: 'POST',
      body: { username: clean },
      username: clean,
    });
    return data.user;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!username) {
        setUser(null);
        setReady(true);
        return;
      }
      setAuthError('');
      try {
        const nextUser = await loginRequest(username);
        if (!cancelled) setUser(nextUser);
      } catch (err) {
        if (!cancelled) {
          // Keep username in the field; only clear session if API rejects the user.
          setUser(null);
          setAuthError(
            err?.message?.includes('fetch') || err?.name === 'TypeError'
              ? 'Cannot reach API at localhost:8787. Run npm run dev:api (or npm run dev).'
              : err.message || 'Login failed'
          );
          // Network / server down — keep localStorage so retry works after API starts.
          if (err?.status && err.status >= 400 && err.status < 500) {
            localStorage.removeItem(STORAGE_KEY);
            setUsername('');
          }
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [username, loginRequest]);

  const value = useMemo(
    () => ({
      ready,
      user,
      username,
      authError,
      clearAuthError: () => setAuthError(''),
      login: async (name) => {
        const clean = String(name || '')
          .trim()
          .toLowerCase();
        setAuthError('');
        try {
          const nextUser = await loginRequest(clean);
          localStorage.setItem(STORAGE_KEY, clean);
          setUsername(clean);
          setUser(nextUser);
          setReady(true);
          return true;
        } catch (err) {
          setAuthError(
            err?.message?.includes('fetch') || err?.name === 'TypeError'
              ? 'Cannot reach API at localhost:8787. Run npm run dev:api (or npm run dev).'
              : err.message || 'Login failed'
          );
          return false;
        }
      },
      logout: () => {
        localStorage.removeItem(STORAGE_KEY);
        setUsername('');
        setUser(null);
        setAuthError('');
      },
    }),
    [ready, user, username, authError, loginRequest]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
