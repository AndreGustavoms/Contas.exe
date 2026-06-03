# Arquitetura do Contas_exe

Cofre local de contas/senhas de redes sociais, organizado em **grupos**. Roda
na própria máquina: frontend Vite + uma API Node simples que persiste em
arquivos JSON.

```
Navegador (React/Vite, :5175)
        │  fetch /api/*  (Vite faz proxy de /api → :8787)
        ▼
API Node (server/index.mjs, :8787)  ── http nativo, roteamento por regex
        │
        ▼
storage/  (arquivos JSON, git-ignored)
  ├─ groups.json     # grupos + contas
  └─ youtube.json    # tokens OAuth dos canais (ver docs/YOUTUBE.md)
```

`scripts/local-dev.mjs` sobe API + Vite juntos (`npm run local`).

---

## Modelo de dados — Grupos

As contas vivem dentro de **grupos** (perfis/contextos). `storage/groups.json`:

```json
{
  "groups": [
    { "id": "uuid", "name": "Vitissouls", "accounts": [ /* AccountRecord[] */ ] }
  ],
  "activeGroupId": "uuid"
}
```

- **Migração automática:** na primeira execução com o formato novo, se existir
  um `storage/accounts.json` antigo (array plano), o servidor cria um grupo
  **"Vitissouls"** com aquelas contas. O arquivo antigo é preservado.
- **Importar** um backup **cria um grupo novo** (não mistura com os existentes).
- **Exportar** salva **apenas o grupo ativo**, identificado pelo nome (arquivo
  `contas-<grupo>-AAAA-MM-DD.json`, com `"group": "<nome>"` dentro).

`AccountRecord` (ver `src/data/credential-records.ts`): `id, platform, role,
owner, label, email, username, password, recoveryEmail, phone, status,
twoFactor, postDay, niche, notes, updatedAt`.

Ordenação das contas: **alfabética por `email`** (chave primária), depois pelos
demais campos como desempate. Ver `sortAccounts` em `account-vault.tsx`.

---

## API local (`server/index.mjs`)

Sem framework: um `createServer` com despacho por `URL` + regex. CORS liberado
(uso local). Helpers: `readDb`/`writeDb`, `normalizeRecord`, `sendJson`.

### Grupos
| Método | Rota | Ação |
| --- | --- | --- |
| GET | `/api/groups` | Lista grupos (`{id,name,count}`) + `activeGroupId`. |
| POST | `/api/groups` | Cria grupo. |
| PUT | `/api/groups/active` | Define o grupo ativo. |
| PUT | `/api/groups/:id` | Renomeia grupo. |
| DELETE | `/api/groups/:id` | Exclui grupo (bloqueia o último). |

### Contas (dentro de um grupo)
| Método | Rota | Ação |
| --- | --- | --- |
| GET | `/api/groups/:groupId/accounts` | Lista contas do grupo. |
| POST | `/api/groups/:groupId/accounts` | Cria conta. |
| POST | `/api/groups/:groupId/accounts/import` | Substitui as contas do grupo (importação). |
| PUT | `/api/groups/:groupId/accounts/:id` | Edita conta. |
| DELETE | `/api/groups/:groupId/accounts/:id` | Remove conta. |

### YouTube
Ver **[docs/YOUTUBE.md](./YOUTUBE.md)**.

### Estáticos
Fora de `/api/`, serve a build de `dist/` (SPA fallback para `index.html`).

---

## Frontend (`src/`)

- `App.tsx` — alterna entre `LocalLogin` (acesso) e `AccountVault` (cofre);
  guarda o tema (localStorage) e a sessão (sessionStorage).
- `components/account-vault.tsx` — **tela principal**: navbar, sidebar
  (seletor de grupo + engrenagem de ações + lista de redes + botão Sair),
  lista de registros, busca/filtro, wizard de cadastro, quick view, e os
  modais (`ModalShell`, `GroupDialog`, `ConfirmDialog` com o "radar").
- `components/local-login.tsx` — tela de acesso local.
- `components/platform-icons.tsx` — glyphs de marca (YouTube, Instagram com
  gradiente, TikTok com glitch ciano/magenta, Kwai oficial, Facebook).
- `components/theme-toggle.tsx` — seletor de tema (ícone + dropdown).
- `data/credential-records.ts` — tipos, `platformOptions`, `roleOptions`.
- `theme.ts` + `index.css` — 3 temas (`andre`, `dark`, `white`) por variáveis
  CSS. Regras importantes:
  - Texto principal de alto contraste por tema; badges de status com cores
    legíveis nos 3 modos (classes `badge-*`).
  - Navbar com glass translúcido (`--navbar-glass` por tema + `backdrop-filter`).
  - Animações `.radar-wave`/`.radar-dot` (pílula "Social access hub") e
    `.balanced-text` (quebra de linha equilibrada).

### Persistência no cliente
`account-vault.tsx` busca os grupos e as contas do grupo ativo via API e
espelha em `localStorage` (`contas_exe.accounts.v1`) como cache. A API é a
fonte da verdade; se ela estiver fora, aparece "API offline".

---

## Segurança / avisos

- Senhas e tokens ficam em **texto plano** nos JSON de `storage/` — prático
  para uso local, **não é criptografia**.
- Nunca commite `storage/`, `.env`, prints ou mensagens com dados reais.
- Ao subir para um domínio: HTTPS obrigatório, considerar autenticação real e
  criptografia dos segredos em repouso.

### O que o `.gitignore` protege (e por quê)

Tudo que é sensível fica **fora do versionamento**. Regras principais:

| Padrão | Cobre | Motivo |
| --- | --- | --- |
| `.env`, `.env.*` (exceto `.env.example`) | Client ID/Secret da Google | segredos OAuth |
| `client_secret*.json`, `credentials*.json`, `*.pem`, `*.key` | credenciais baixadas | nunca devem ir ao repo |
| `storage/*` (exceto `storage/.gitkeep`) | `groups.json`, `accounts.json`, `youtube.json`, backups | **senhas reais e refresh tokens** |
| `*.backup.json`, `contas-*.json`, `backups/` | exports do app | contêm senhas |
| `*.log` (dev/api/local) | logs locais | podem vazar dados |

O `storage/.gitkeep` (arquivo vazio) é o **único** de `storage/` rastreado, só
para a pasta existir no repositório. Auditoria de 2026-06-02: o histórico do
Git nunca conteve nenhum arquivo sensível.

Para conferir a qualquer momento que um arquivo está ignorado:
```bash
git check-ignore -v storage/groups.json   # deve apontar a regra do .gitignore
git ls-files storage/                      # deve listar apenas storage/.gitkeep
```
