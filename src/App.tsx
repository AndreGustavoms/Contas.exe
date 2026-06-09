import { useEffect, useState } from "react";
import { AccountVault } from "./components/account-vault";
import { LocalLogin } from "./components/local-login";
import { type AppTheme, isAppTheme, THEME_STORAGE_KEY } from "./theme";

// The logged-in user, as reported by /api/auth. role drives admin-only UI.
export type SessionUser = { username: string; role: "admin" | "member" };

export default function App() {
  // null = still checking the server for an existing session.
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof window === "undefined") {
      return "andre";
    }

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

    return isAppTheme(storedTheme) ? storedTheme : "andre";
  });

  // Ask the server whether the session cookie is still valid, and who we are.
  useEffect(() => {
    let active = true;

    fetch("/api/auth/status")
      .then((response) =>
        response.ok ? response.json() : { authenticated: false, user: null },
      )
      .then((data: { authenticated?: boolean; user?: SessionUser | null }) => {
        if (!active) return;
        setUnlocked(Boolean(data.authenticated));
        setUser(data.user ?? null);
      })
      .catch(() => {
        if (active) setUnlocked(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function changeTheme(nextTheme: AppTheme) {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  }

  function unlock(loggedIn: SessionUser) {
    setUser(loggedIn);
    setUnlocked(true);
  }

  function lock() {
    // Drop the server session, then return to the login screen regardless.
    fetch("/api/auth/logout", { method: "POST" }).finally(() => {
      setUnlocked(false);
      setUser(null);
    });
  }

  if (unlocked === null) {
    return null;
  }

  return unlocked ? (
    <AccountVault
      theme={theme}
      user={user}
      onLock={lock}
      onThemeChange={changeTheme}
    />
  ) : (
    <LocalLogin theme={theme} onThemeChange={changeTheme} onUnlock={unlock} />
  );
}
