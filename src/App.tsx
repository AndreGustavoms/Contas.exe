import { useEffect, useState } from "react";
import { AccountVault } from "./components/account-vault";
import { ForgotPassword } from "./components/forgot-password";
import { LocalLogin } from "./components/local-login";
import { Register } from "./components/register";
import { ResetPassword } from "./components/reset-password";
import { ThemeToggle } from "./components/theme-toggle";
import { type AppTheme, isAppTheme, THEME_STORAGE_KEY } from "./theme";

// The logged-in user, as reported by /api/auth. role drives admin-only UI.
export type SessionUser = { username: string; role: "admin" | "member" };

type View = "login" | "forgot" | "reset" | "register";

function getInitialView(): { view: View; resetToken: string } {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token && window.location.pathname === "/reset-password") {
    return { view: "reset", resetToken: token };
  }
  return { view: "login", resetToken: "" };
}

export default function App() {
  // null = still checking the server for an existing session.
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const initial = getInitialView();
  const [view, setView] = useState<View>(initial.view);
  const [resetToken] = useState(initial.resetToken);
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof window === "undefined") {
      return "white";
    }

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

    return isAppTheme(storedTheme) ? storedTheme : "white";
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

  // O servidor é a fonte da verdade: ao voltar para a aba (ou focar a janela),
  // reconsulta o status. Se a sessão caiu nesse meio-tempo — expirou por
  // inatividade, senha trocada em outro lugar, admin revogou — volta ao login
  // em vez de deixar uma UI "logada" que só falharia na próxima ação.
  useEffect(() => {
    if (!unlocked) return;

    let lastCheck = 0;
    function revalidate() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheck < 30_000) return; // no máximo 1 consulta a cada 30s
      lastCheck = now;
      fetch("/api/auth/status")
        .then((response) =>
          response.ok ? response.json() : { authenticated: false },
        )
        .then((data: { authenticated?: boolean }) => {
          if (!data.authenticated) {
            setUnlocked(false);
            setUser(null);
          }
        })
        .catch(() => {
          // Rede fora do ar não desloga: a próxima ação real vai falhar e tratar.
        });
    }

    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => {
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
    };
  }, [unlocked]);

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

  if (unlocked === null && view !== "reset") {
    return null;
  }

  const floatingToggle = (
    <div className="floating-theme-toggle fixed right-4 top-4 z-[100]">
      <ThemeToggle value={theme} onChange={changeTheme} />
    </div>
  );

  if (view === "reset") {
    return (
      <>
        {floatingToggle}
        <ResetPassword
          token={resetToken}
          theme={theme}
          onDone={() => setView("login")}
        />
      </>
    );
  }

  if (view === "forgot") {
    return (
      <>
        {floatingToggle}
        <ForgotPassword theme={theme} onBack={() => setView("login")} />
      </>
    );
  }

  if (view === "register") {
    return (
      <>
        {floatingToggle}
        <Register
          theme={theme}
          onBack={() => setView("login")}
          onDone={() => setView("login")}
        />
      </>
    );
  }

  return unlocked ? (
    <AccountVault
      theme={theme}
      user={user}
      onLock={lock}
      onThemeChange={changeTheme}
    />
  ) : (
    <>
      {floatingToggle}
      <LocalLogin
        theme={theme}
        onUnlock={unlock}
        onForgotPassword={() => setView("forgot")}
        onRegister={() => setView("register")}
      />
    </>
  );
}
