# 🏗️ Arquitetura do Contas_exe

Cofre de credenciais de redes sociais para **equipes**, organizado em **grupos**
com login por usuário e criptografia em repouso. Um único serviço Node serve a
API e o frontend buildado; a persistência é em arquivos JSON.

```
Navegador (React/Vite, :5175 em dev)
        │  fetch /api/*  (Vite faz proxy de /api → :8787 em dev)
        ▼
API Node (server/index.mjs)  ── HTTP nativo, roteamento por regex
        │                         auth de sessão + ownership por grupo
        ▼
storage/  (arquivos JSON, git-ignored)
  ├─ users.json      # usuários (logins) + hashes scrypt
  ├─ groups.json     # grupos + contas (campos sensíveis cifrados)
  ├─ sessions.json   # sessões ativas (revogáveis)
  ├─ audit.json      # trilha de auditoria
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
    {
      "id": "uuid",
      "username": "andre",
      "role": "admin",
      "passwordHash": "scrypt:N:r:p:saltHex:hashHex",
      "createdAt": "ISO"
    }
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
    {
      "id": "uuid",
      "name": "Vitissouls",
      "ownerId": "uuid",
      "accounts": [
        /* AccountRecord[] */
      ]
    }
  ]
}
```

- **Ownership:** cada grupo tem `ownerId`. Um membro só acessa grupos que possui;
  o admin vê todos. O "grupo ativo" é estado **do navegador** (localStorage,
  namespaceado por usuário), não do servidor.
- **Migração automática:** se existir um `storage/accounts.json` antigo (array
  plano), o servidor cria um grupo **"Vitissouls"** com aquelas contas e o atribui
  ao admin no startup (`backfillOwners`).
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
`/api/auth/*` e `/api/youtube/callback`. CORS é same-origin por padrão (sem `*`).

### Auth

| Método | Rota                   | Ação                                                               |
| ------ | ---------------------- | ------------------------------------------------------------------ |
| POST   | `/api/auth/login`      | Valida credenciais (scrypt), emite cookie de sessão. Rate-limited. |
| POST   | `/api/auth/login/totp` | Finaliza login com código TOTP (2FA).                              |
| POST   | `/api/auth/logout`     | Encerra a sessão.                                                  |
| POST   | `/api/auth/reauth`     | Reautenticação para ações críticas (rate-limited).                 |
| GET    | `/api/auth/status`     | Diz se há sessão e quem é (`{authenticated, user}`).               |
| POST   | `/api/auth/register`   | Cria conta (pede aprovação de admin, dependendo da config).        |

### Usuários (admin)

| Método | Rota                             | Ação                                                 |
| ------ | -------------------------------- | ---------------------------------------------------- |
| GET    | `/api/users`                     | Lista usuários (sem hashes).                         |
| POST   | `/api/users`                     | Cria usuário (`username`, `password`, `role`).       |
| DELETE | `/api/users/:id`                 | Remove usuário (re-atribui os grupos dele ao admin). |
| PUT    | `/api/users/:id/password`        | Reseta a senha de um usuário.                        |
| POST   | `/api/users/:id/sessions/revoke` | Revoga todas as sessões de um usuário.               |
| POST   | `/api/users/:id/2fa/reset`       | Admin reseta o 2FA de um usuário trancado.           |

### Sessões

| Método | Rota                | Ação                                    |
| ------ | ------------------- | --------------------------------------- |
| GET    | `/api/sessions`     | Lista sessões ativas do usuário logado. |
| DELETE | `/api/sessions/:id` | Revoga uma sessão específica.           |

### Conta do usuário

| Método | Rota                              | Ação                                     |
| ------ | --------------------------------- | ---------------------------------------- |
| GET    | `/api/account/2fa`                | Status do 2FA do usuário.                |
| POST   | `/api/account/2fa/setup`          | Inicia setup (retorna secret + QR data). |
| POST   | `/api/account/2fa/enable`         | Confirma código e ativa o 2FA.           |
| POST   | `/api/account/2fa/disable`        | Desativa o 2FA (reauth).                 |
| GET    | `/api/account/2fa/recovery-codes` | Lista códigos de recuperação restantes.  |
| POST   | `/api/account/2fa/recovery-codes` | Gera novos códigos (reauth).             |

### Grupos (ownership-scoped)

| Método | Rota              | Ação                                               |
| ------ | ----------------- | -------------------------------------------------- |
| GET    | `/api/groups`     | Lista grupos visíveis (`{id,name,ownerId,count}`). |
| POST   | `/api/groups`     | Cria grupo (dono = criador).                       |
| PUT    | `/api/groups/:id` | Renomeia grupo.                                    |
| DELETE | `/api/groups/:id` | Exclui grupo (reauth).                             |

### Contas (dentro de um grupo)

| Método | Rota                                   | Ação                                       |
| ------ | -------------------------------------- | ------------------------------------------ |
| GET    | `/api/groups/:gid/accounts`            | Lista contas do grupo (senha mascarada).   |
| GET    | `/api/groups/:gid/accounts/:id/secret` | Retorna a senha real (reauth + auditoria). |
| POST   | `/api/groups/:gid/accounts`            | Cria conta.                                |
| POST   | `/api/groups/:gid/accounts/import`     | Substitui as contas do grupo (importação). |
| PUT    | `/api/groups/:gid/accounts/:id`        | Edita conta.                               |
| DELETE | `/api/groups/:gid/accounts/:id`        | Remove conta.                              |

Em todas as rotas de grupo/conta, um recurso que o usuário não pode ver responde
**404** (não revela existência). Ver `canSeeGroup`/`resolveOwnedGroup`.

### Backup (admin)

| Método | Rota                | Ação                                                             |
| ------ | ------------------- | ---------------------------------------------------------------- |
| GET    | `/api/admin/backup` | Baixa todos os grupos/contas (texto plano, sem hashes de senha). |

### Auditoria (admin)

| Método | Rota         | Ação                                               |
| ------ | ------------ | -------------------------------------------------- |
| GET    | `/api/audit` | Retorna os últimos eventos da trilha de auditoria. |

### YouTube

OAuth em pausa; o endpoint de upload está **desativado** (503) por segurança.
Ver **[docs/YOUTUBE.md](./YOUTUBE.md)**.

### Estáticos

Fora de `/api/`, serve a build de `dist/` (SPA fallback para `index.html`).

---

## Frontend (`src/`)

- **`App.tsx`** — alterna entre `LocalLogin` e `AccountVault`; consulta
  `/api/auth/status` no mount e guarda o usuário logado (`{username, role}`) e o
  tema (localStorage). O papel do usuário dirige as features de admin.
- **`components/account-vault.tsx`** — tela principal: navbar, sidebar
  (seletor de grupo + engrenagem de ações + lista de redes + **Equipe** (admin) +
  Sair), lista de registros, busca/filtro, wizard de cadastro, quick view, e os
  modais (`ModalShell`, `GroupDialog`, `ConfirmDialog`).
- **`components/users-dialog.tsx`** — painel **Equipe** (só admin): criar/remover
  usuários, sessões ativas, trilha de auditoria e backup completo.
- **`components/local-login.tsx`** — tela de login (usuário + senha + TOTP).
- **`components/register.tsx`** — tela de criar conta (campos, validação, i18n).
- **`components/forgot-password.tsx`** — tela de recuperação de senha.
- **`components/lang-terminal.tsx`** — seletor de idioma compartilhado entre as
  telas de login, registro e recuperação.
- **`components/platform-icons.tsx`** — glyphs de marca (YouTube, Instagram, TikTok,
  Kwai, Facebook).
- **`components/theme-toggle.tsx`** — seletor de tema (Dark / White).
- **`components/ui/`** — `button` (com variante `neon`), `input`, `switch`,
  `spinner`, `toast`, `card`, `badge`, `form-alert`.
- **`data/credential-records.ts`** — tipos, `platformOptions`, `roleOptions`.
- **`theme.ts`** + **`index.css`** — 2 temas (`dark`, `white`) por variáveis CSS.
  Cor de acento verde: `#22c55e` (dark) / `#16a34a` (white). Os componentes
  uiverse (borda neon, label flutuante, switch, spinner, toast, spotlight) são
  todos tingidos por essas variáveis. Tudo respeita `prefers-reduced-motion`.
- **`locales/`** — traduções em `pt.json`, `en.json`, `es.json`, `fr.json`, `zh.json`
  (login, registro, vault, equipe, conta, plataformas, funções, status).

### Persistência no cliente

`account-vault.tsx` busca os grupos e as contas do grupo ativo via API a cada
montagem. **As contas nunca são guardadas no navegador** — elas carregam segredos
e persistir em `localStorage` os vazaria para quem tivesse acesso à máquina. A
única coisa guardada localmente é o **id do grupo ativo**
(`contas_exe.activeGroup.v1:<username>`, namespaceado por usuário), que não é
segredo. A API é a fonte da verdade.

A senha nem vem na listagem: ao revelar ou copiar, o front a busca sob demanda
em `/secret` (reauth), mantém o valor só em memória, reoculta após ~15s e limpa
o clipboard após ~20s. Uma ação crítica que receba `403 reauth_required` abre o
modal de reautenticação e é refeita automaticamente após confirmação.

---

## Segurança

### Criptografia em repouso (AES-256-GCM)

Com `CONTAS_FLOW_ENC_KEY` definida, os campos sensíveis das contas (`password`,
`recoveryEmail`, `phone`, `notes`) e os refresh tokens do YouTube são cifrados
no disco (formato `enc:v1:...`), com IV aleatório por valor e tag de autenticação.
Em memória e na API o servidor sempre usa texto plano; a cifragem vive só na
borda de I/O (`readDb`/`writeDb`, `readTokens`/`writeTokens`). Ver `server/crypto.mjs`.

**Sem a chave**, esses campos ficam em texto plano (uso local). A migração de
texto plano para cifrado é automática e idempotente: ao subir com a chave, o
servidor re-grava o store cifrado no startup. A chave é a **única** forma de
decifrar: se perdida, os campos cifrados são irrecuperáveis.

### Login e sessões

Multiusuário com hash **scrypt** (salt por usuário) em `users.json`; sessão via
cookie HttpOnly + `SameSite=Strict` + `Path=/` (+ `Secure` em HTTPS), `Max-Age`
de 3 dias. Estado das sessões em `storage/sessions.json` (`server/sessions.mjs`):
sobrevive a redeploy, pode ser revogado. Dois prazos independentes (OWASP):
**3h de inatividade** (`lastSeenAt`) e **teto absoluto de 3 dias** (`expiresAt`,
nunca estendido). `ipHash` (SHA-256 do IP) e `userAgent` são cifrados em repouso.

### 2FA (TOTP)

Cada usuário ativa/desativa o seu em "Minha conta": adiciona a chave no app
autenticador, confirma um código de 6 dígitos para ligar e recebe **8 códigos de
recuperação** (uso único, mostrados uma vez). Implementado com `crypto` nativo,
RFC 6238 (`server/totp.mjs`). Com 2FA ativo, o login é em duas etapas:
`/api/auth/login` responde `{ twoFactorRequired: true }` (sem cookie) e o cliente
finaliza em `POST /api/auth/login/totp`. O secret e os hashes dos códigos de
recuperação são cifrados em repouso em `users.json`.

### Reautenticação e senha sob demanda

Revelar/copiar senha, exportar backup, trocar senha, criar/remover admin, apagar
grupo e "sair de todos os dispositivos" exigem que o usuário **redigite a senha**
(`POST /api/auth/reauth`, rate-limited). O sucesso grava `reauthAt` na sessão e
libera essas ações por **5 min** (`hasRecentReauth`). A listagem NÃO traz a senha
— o valor real é buscado por `GET /api/groups/:gid/accounts/:aid/secret`, atrás
de reauth, e registrado na auditoria. Editar uma conta sem mexer na senha não a
apaga (senha vazia = "inalterada").

### Auditoria

`storage/audit.json` (`server/audit.mjs`) registra eventos sensíveis (login/logout,
reauth, ver/copiar senha, exportar backup, trocar senha, criar/remover usuário,
apagar grupo, revogar sessões) com `{ ts, userId, username, action, target, ipHash }`.
**Nunca** grava senha, valor copiado ou token. Rotação: mantém os últimos 5000.
O admin vê os últimos eventos no painel Equipe (`GET /api/audit`).

### Endurecimento HTTP/API

Login rate-limited em memória por IP (10 tentativas/10 min; sucesso limpa o
contador). O IP vem do socket por padrão; `X-Forwarded-For` só é aceito quando
`CONTAS_FLOW_TRUSTED_PROXIES` informa quantos proxies confiáveis existem (Railway = `1`).
Todas as respostas recebem headers de segurança (CSP, HSTS quando cookie `Secure`,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`).
Corpos limitados a **1 MB**. Erros internos são logados no servidor e viram apenas
`{ error: "server_error" }` para o cliente.

### Proteção contra perda de dados

`readDb` nunca sobrescreve `groups.json` em caso de erro de leitura, JSON
corrompido ou falha de decifragem. Só `ENOENT` (arquivo inexistente) dispara
a migração/criação inicial. Uma `CONTAS_FLOW_ENC_KEY` errada, ausente ou perdida
faz o servidor **falhar alto** e preservar o arquivo no disco.

---

## .gitignore — o que está protegido e por quê

| Padrão                                                       | Cobre                                                   | Motivo                            |
| ------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------- |
| `.env`, `.env.*` (exceto `.env.example`)                     | Client ID/Secret da Google                              | segredos OAuth                    |
| `client_secret*.json`, `credentials*.json`, `*.pem`, `*.key` | credenciais baixadas                                    | nunca devem ir ao repo            |
| `storage/*` (exceto `storage/.gitkeep`)                      | `groups.json`, `accounts.json`, `youtube.json`, backups | **senhas reais e refresh tokens** |
| `*.backup.json`, `contas-*.json`, `backups/`                 | exports do app                                          | contêm senhas                     |
| `*.log`                                                      | logs locais                                             | podem vazar dados                 |

O `storage/.gitkeep` (arquivo vazio) é o **único** de `storage/` rastreado, só
para a pasta existir no repositório.

```bash
git check-ignore -v storage/groups.json   # deve apontar a regra do .gitignore
git ls-files storage/                      # deve listar apenas storage/.gitkeep
```
