import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AdminApp from "./admin/AdminApp";
import "./index.css";
import "./i18n";

// Roteamento de topo: a rota /admin monta um app SEPARADO (painel superadmin),
// com seu próprio gate. Qualquer outra rota é o app normal. A barreira de acesso
// real é o servidor (papel superadmin + reauth em /api/admin-panel/*); aqui só
// decidimos qual árvore React renderizar.
const isAdminRoute = window.location.pathname.startsWith("/admin");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isAdminRoute ? <AdminApp /> : <App />}</React.StrictMode>,
);
