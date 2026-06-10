# Arquitetura do Contas_exe

Cofre de contas/senhas de redes sociais para **equipes**, organizado em
**grupos** com login por usuário e criptografia em repouso. Um único serviço
Node serve a API e o frontend buildado; a persistência é em arquivos JSON.

```
Navegador (React/Vite, :5175 em dev)
        │  fetch /api/*  (Vite faz proxy de /api → :8787 em dev)
        ▼
API Node (server/index.mjs)  ── http nativo, roteamento por regex
        │                         auth de sessão + ownership por grupo
        ▼
storage/  (arquivos JSON, git-ignored)
  ├─ users.json      # usuários (logins) + hashes scrypt
  ├─ groups.json     # grupos + contas (campos sensíveis cifrados)
  └─ youtube.json    # refresh tokens OAuth dos canais (cifrados)
```

Em produção é **um serviço só**: o `server/index.mjs` serve `/api/*` e também o
build estático de `dist/`. `scripts/local-dev.mjs` sobe API + Vite juntos em dev
(`npm run local`).

---

## Modelo de dados

### Usuários — `storage/users.json`

```json
{
  "users": [
    { "id": "uuid", "username": "andre", "role": "admin",
      "passwordHash": "scrypt:N:r:p:saltHex:hashHex", "createdAt": "ISO" }
  ]
}
```

- Papéis: **admin** (vê todos os grupos, gerencia usuários e backup) e **member**
  (vê só os próprios grupos). Ver `server/users.mjs`.
- Senhas: hash **scrypt** com salt por usuário; nunca em texto plano.
- O admin inicial é semeado de `APP_AUTH_USER` / `APP_AUTH_PASSWORD` quando o
  arquivo ainda não existe.

### Grupos e contas — `storage/groups.json`

```json
{
  "groups": [
    { "id": "uuid", "name": "Vitissouls", "ownerId": "uuid",
      "accounts": [ /* AccountRecord[] */ ] }
  ]
}
```

- **Ownership:** cada grupo tem `ownerId`. Um membro só acessa grupos que possui;
  o admin vê todos. O "grupo ativo" é estado **do navegador** (localStorage,
  namespaceado por usuário), não do servidor.
- **Migração automática:** se existir um `storage/accounts.json` antigo (array
  plano), o servidor cria um grupo **"Vitissouls"** com aquelas contas (o arquivo
  antigo é preservado) e o atribui ao admin no startup (`backfillOwners`).
- **Importar** um backup **cria um grupo novo** (não mistura com os existentes).
- **Exportar** salva **apenas o grupo ativo** (`contas-<grupo>-AAAA-MM-DD.json`).
  O **backup completo** (admin) exporta tudo.

`AccountRecord` (ver `src/data/credential-records.ts`): `id, platform, role,
owner, label, email, username, password, recoveryEmail, phone, status,
twoFactor, postDay, niche, notes, updatedAt`. Cifrados em repouso: `password`,
`recoveryEmail`, `phone`, `notes`.

Ordenação das contas: **alfabética por `email`** (chave primária), depois pelos
demais campos como desempate. Ver `sortAccounts` em `account-vault.tsx`.

---

## API (`server/index.mjs`)

Sem framework: um `createServer` com despacho por `URL` + regex. Helpers:
`readDb`/`writeDb`, `normalizeRecord`, `sendJson`, `requireUser`, `canSeeGroup`.

**Gate:** todo `/api/*` exige sessão válida, **exceto** `/api/health`,
`/api/auth/*` e `/api/youtube/callback`. O dispatcher resolve o usuário uma vez
(`requireUser`) e passa adiante. CORS é same-origin por padrão (sem `*`).

### Auth
| Método | Rota | Ação |
| --- | --- | --- |
| POST | `/api/auth/login` | Valida credenciais (scrypt), emite cookie de sessão. Rate-limited. |
| POST | `/api/auth/logout` | Encerra a sessão. |
| GET | `/api/auth/status` | Diz se há sessão e quem é (`{authenticated, user}`). |

### Usuários (admin)
| Método | Rota | Ação |
| --- | --- | --- |
| GET | `/api/users` | Lista usuários (sem hashes). |
| POST | `/api/users` | Cria usuário (`username`, `password`, `role`). |
| DELETE | `/api/users/:id` | Remove usuário (re-atribui os grupos dele ao admin). |
| PUT | `/api/users/:id/password` | Reseta a senha de um usuário. |

### Grupos (ownership-scoped)
| Método | Rota | Ação |
| --- | --- | --- |
| GET | `/api/groups` | Lista grupos **visíveis** (`{id,name,ownerId,count}`). |
| POST | `/api/groups` | Cria grupo (dono = criador). |
| PUT | `/api/groups/:id` | Renomeia grupo. |
| DELETE | `/api/groups/:id` | Exclui grupo. |

### Contas (dentro de um grupo)
| Método | Rota | Ação |
| --- | --- | --- |
| GET | `/api/groups/:groupId/accounts` | Lista contas do grupo. |
| POST | `/api/groups/:groupId/accounts` | Cria conta. |
| POST | `/api/groups/:groupId/accounts/import` | Substitui as contas do grupo (importação). |
| PUT | `/api/groups/:groupId/accounts/:id` | Edita conta. |
| DELETE | `/api/groups/:groupId/accounts/:id` | Remove conta. |

Em todas as rotas de grupo/conta, um recurso que o usuário não pode ver responde
**404** (não revela existência). Ver `canSeeGroup`/`resolveOwnedGroup`.

### Backup (admin)
| Método | Rota | Ação |
| --- | --- | --- |
| GET | `/api/admin/backup` | Baixa todos os grupos/contas (texto plano, sem hashes de senha). |

### YouTube
OAuth em pausa; o endpoint de upload está **desativado** (503) por segurança.
Ver **[docs/YOUTUBE.md](./YOUTUBE.md)**.

### Estáticos
Fora de `/api/`, serve a build de `dist/` (SPA fallback para `index.html`).

---

## Frontend (`src/`)

- `App.tsx` — alterna entre `LocalLogin` e `AccountVault`; consulta
  `/api/auth/status` no mount e guarda o usuário logado (`{username, role}`) e o
  tema (localStorage). O papel do usuário dirige as features de admin.
- `components/account-vault.tsx` — **tela principal**: navbar, sidebar
  (seletor de grupo + engrenagem de ações + lista de redes + **Equipe** (admin) +
  Sair), lista de registros, busca/filtro, wizard de cadastro, quick view, e os
  modais (`ModalShell`, `GroupDialog`, `ConfirmDialog`).
- `components/users-dialog.tsx` — painel **Equipe** (só admin): criar/remover
  usuários e baixar o backup completo.
- `components/local-login.tsx` — tela de login.
- `components/platform-icons.tsx` — glyphs de marca (YouTube, Instagram, TikTok,
  Kwai, Facebook).
- `components/theme-toggle.tsx` — seletor de tema.
- `components/ui/` — `button` (com variante `neon`), `input`, `switch`,
  `spinner`, `toast`, `card`, `badge`.
- `data/credential-records.ts` — tipos, `platformOptions`, `roleOptions`.
- `theme.ts` + `index.css` — 3 temas (`andre`, `dark`, `white`) por variáveis
  CSS. Os componentes "uiverse" (borda neon, label flutuante, switch, spinner,
  toast, spotlight) são todos tingidos por essas variáveis, então funcionam nos 3
  temas. Tudo respeita `prefers-reduced-motion`.

### Persistência no cliente
`account-vault.tsx` busca os grupos e as contas do grupo ativo via API a cada
montagem. **As contas NUNCA são guardadas no navegador** — elas carregam
segredos (senha, email de recuperação, telefone, notas) e persistir em
`localStorage` os vazaria para quem tivesse acesso à máquina. A única coisa
guardada localmente é o **id do grupo ativo** (`contas_exe.activeGroup.v1:<username>`,
namespaceado por usuário), que não é segredo. A API é a fonte da verdade; se ela
estiver fora, aparece "API offline". A senha nem vem na listagem: ao revelar ou
copiar, o front a busca sob demanda no endpoint `/secret` (que exige reauth),
mantém o valor só em memória, reoculta após ~15s e limpa o clipboard após ~20s
(best-effort). Uma ação crítica que receba `403 reauth_required` abre o modal de
reautenticação e é refeita automaticamente após o usuário confirmar a senha.

---

## Segurança / avisos

- **Criptografia em repouso (AES-256-GCM):** com `CONTAS_FLOW_ENC_KEY` definida,
  os campos sensíveis das contas (`password`, `recoveryEmail`, `phone`, `notes`)
  e os refresh tokens do YouTube são cifrados no disco (formato `enc:v1:...`),
  com IV aleatório por valor e tag de autenticação (detecta adulteração). Em
  memória e na API o servidor sempre usa texto plano; a cifragem vive só na
  borda de I/O (`readDb`/`writeDb`, `readTokens`/`writeTokens`). Ver
  `server/crypto.mjs`. **Sem a chave**, esses campos ficam em texto plano (uso
  local). A migração de um arquivo antigo (texto plano) para cifrado é
  automática e idempotente: ao subir com a chave, o servidor re-grava o store
  cifrado no startup.
  - A chave é a **única** forma de decifrar: se perdida, os campos cifrados são
    irrecuperáveis. Guarde-a separada do volume de dados.
- **Login:** multiusuário com hash **scrypt** (salt por usuário) em
  `users.json`; sessão via cookie HttpOnly + `SameSite=Strict` + `Path=/`
  (+ `Secure` em HTTPS), `Max-Age` de 3 dias. Ver `server/users.mjs`.
- **Sessões (server-side, revogáveis):** o cookie carrega só um token opaco; o
  estado fica em `storage/sessions.json` (ver `server/sessions.mjs`), então
  sobrevive a redeploy e pode ser **revogado**. Dois prazos independentes
  (OWASP): **3h de inatividade** (`lastSeenAt`) e **teto absoluto de 3 dias**
  (`expiresAt`, nunca estendido — mesmo usando todo dia, relogin após 3 dias).
  `lastSeenAt` só renova em request autenticado real (aba parada não renova; o
  front não fica fazendo polling). `ipHash` (SHA-256 do IP, nunca o IP cru) e
  `userAgent` são cifrados em repouso com o mesmo `crypto.mjs`. O admin vê e
  encerra sessões (uma específica ou "sair de todos os dispositivos") pelo painel
  Equipe; logout revoga server-side. Rotas: `GET /api/sessions`,
  `DELETE /api/sessions/:id`, `POST /api/users/:id/sessions/revoke`.
- **Reautenticação para ações críticas:** revelar/copiar uma senha, exportar
  backup, trocar senha, criar/remover admin, apagar grupo e "sair de todos os
  dispositivos" exigem que o usuário **redigite a senha** (`POST /api/auth/reauth`,
  rate-limited como o login). O sucesso grava `reauthAt` na sessão e libera essas
  ações por **5 min** (`hasRecentReauth`); depois pede de novo. Sem reauth recente
  o servidor responde `403 reauth_required` e o front abre o modal e refaz a ação.
- **Senha sob demanda:** a listagem de contas NÃO traz mais a senha (campo
  mascarado + `hasPassword`); o valor real é buscado por
  `GET /api/groups/:gid/accounts/:aid/secret`, atrás de reauth, e registrado na
  auditoria. Editar uma conta sem mexer na senha não a apaga (senha vazia =
  "inalterada"). O backup (admin) ainda exporta as senhas em claro — mas só atrás
  de reauth.
- **Auditoria:** `storage/audit.json` (ver `server/audit.mjs`) registra os eventos
  sensíveis (login/ logout, reauth, ver/copiar senha, exportar backup, trocar
  senha, criar/remover usuário, apagar grupo, revogar sessões) com
  `{ ts, userId, username, action, target, ipHash }`. **Nunca** grava senha, valor
  copiado ou token. O admin vê os últimos eventos no painel Equipe
  (`GET /api/audit`). Rotação simples: mantém os últimos 5000.
- **Endurecimento HTTP/API:** login rate-limited em memória por IP
  (10 tentativas/10 min; sucesso limpa o contador). O IP vem do socket por padrão;
  `X-Forwarded-For` só é aceito quando `CONTAS_FLOW_TRUSTED_PROXIES` informa
  quantos proxies confiáveis existem na frente do app (Railway = `1`). Todas as
  respostas recebem headers de segurança (`Content-Security-Policy`,
  `Strict-Transport-Security` quando o cookie é `Secure`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`). Corpos de
  requisição são limitados a **1 MB**; excesso responde `413 payload_too_large`.
  Erros internos são logados no servidor e viram apenas `{ error: "server_error" }`
  para o cliente.
- **Proteção contra perda de dados:** `readDb` nunca sobrescreve `groups.json` em
  caso de erro de leitura, JSON corrompido ou falha de decifragem. Só `ENOENT`
  (arquivo inexistente) dispara a migração/criação inicial. Uma
  `CONTAS_FLOW_ENC_KEY` errada, ausente ou perdida faz o servidor **falhar alto**
  e preservar o arquivo no disco em vez de gravar um store vazio por cima.
- Nunca commite `storage/`, `.env`, prints ou mensagens com dados reais.
- Em produção: HTTPS (cookie `Secure`), `CONTAS_FLOW_ENC_KEY` definida,
  `CONTAS_FLOW_TRUSTED_PROXIES` correto, e CORS fechado (same-origin por padrão).
- **LGPD:** o sistema aplica controles técnicos de minimização, segregação por
  usuário/grupo, criptografia, sessões revogáveis com duplo timeout, ausência de
  segredos no navegador, reautenticação para ações críticas, trilha de auditoria
  e proteção de backups, mas
  a base legal, aviso de privacidade, canal do titular, retenção e resposta a
  incidentes dependem do controlador. Ver **[docs/LGPD.md](./LGPD.md)**.

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
