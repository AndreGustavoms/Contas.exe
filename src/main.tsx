import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AdminApp from "./admin/AdminApp";
import "./index.css";
import "./i18n";
import { type AppTheme, isAppTheme, THEME_STORAGE_KEY } from "./theme";

const PrivacyPolicy = lazy(() =>
  import("./components/privacy-policy").then((m) => ({
    default: m.PrivacyPolicy,
  })),
);
const TermsOfService = lazy(() =>
  import("./components/terms-of-service").then((m) => ({
    default: m.TermsOfService,
  })),
);

function getTheme(): AppTheme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isAppTheme(stored) ? stored : "white";
}

const pathname = window.location.pathname;

function Root() {
  if (pathname.startsWith("/admin")) return <AdminApp />;
  if (pathname === "/privacy")
    return (
      <Suspense>
        <PrivacyPolicy theme={getTheme()} onBack={() => history.back()} />
      </Suspense>
    );
  if (pathname === "/terms")
    return (
      <Suspense>
        <TermsOfService theme={getTheme()} onBack={() => history.back()} />
      </Suspense>
    );
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
