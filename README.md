<div align="center">

# Contas_exe

**Cofre de credenciais para equipes** — organize emails, usuários, senhas e 2FA
de redes sociais em grupos, com login individual e criptografia em repouso.

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)

</div>

---

## Sumário

- [O que é](#o-que-é)
- [Funcionalidades](#funcionalidades)
- [Multiusuário e permissões](#multiusuário-e-permissões)
- [Segurança](#segurança)
- [Uso local](#uso-local)
- [Deploy (equipe)](#deploy-equipe)
- [Stack](#stack)
- [Estrutura](#estrutura)
- [Scripts](#scripts)
- [Documentação](#documentação)

---

## O que é

Um cofre web para **guardar e organizar credenciais de redes sociais** (YouTube,
Instagram, TikTok, Facebook, Kwai e outros) de uma equipe. As contas vivem
dentro de **grupos** (perfis / contextos), cada pessoa entra com seu próprio
login, e os campos sensíveis são **cifrados em repouso** com AES-256-GCM.

Roda como **um único serviço Node**: a mesma API que serve os dados também
entrega o frontend buildado — sem banco externo, sem processo separado. A
persistência é em arquivos JSON num volume persistente.

---

## Funcionalidades

- 🔐 **Login por usuário** com sessão server-side (cookie HttpOnly + 2FA opcional TOTP)
- 👥 **Grupos de contas** — criar, renomear, excluir e alternar entre grupos
- 🧩 **Cadastro guiado** por plataforma e função (postagem, apoio, conta estrela,
  nicho, recuperação, financeiro, administrativo), com email, usuário, senha e 2FA
- 🔎 **Busca, filtros e abas de status** (Ativa, Revisar, Arquivada, Desativada)
- 📋 **Copiar email/senha** com um clique (atrás de reautenticação)
- 💾 **Exportar** (grupo atual) e **importar** (cria grupo novo) — backup JSON
- 🛟 **Backup completo** (admin) de todos os grupos num único arquivo
- 🌐 **Interface em 5 idiomas** — pt · en · es · fr · zh
- 🎨 **2 temas** de alto contraste: Dark e White

---

## Multiusuário e permissões

Cada pessoa tem **login próprio** (usuário + senha). Dois papéis:

| Papel      | Vê                            | Gerencia                                            |
| ---------- | ----------------------------- | --------------------------------------------------- |
| **admin**  | **todos** os grupos           | usuários (criar/remover), backup e tudo dos membros |
| **member** | **apenas os próprios** grupos | só os próprios grupos e contas                      |

- O **admin inicial** é criado automaticamente a partir de `APP_AUTH_USER` /
  `APP_AUTH_PASSWORD` no primeiro start. Os demais são criados pela UI (painel
  **Equipe**, visível só para admin).
- Cada grupo tem um dono (`ownerId`). Um membro só acessa o que é seu — tentativas
  fora disso respondem `404` (a existência do recurso não é revelada).
- Ao remover um usuário, seus grupos são **reatribuídos ao admin** — nada fica órfão.

---

## Segurança

- 🔒 **Criptografia em repouso (AES-256-GCM):** senha, email de recuperação,
  telefone e notas das contas — e os refresh tokens do YouTube — são cifrados no
  disco com uma chave-mestra (`CONTAS_FLOW_ENC_KEY`). Em memória e na API o
  servidor trabalha sempre com texto plano; a cifragem vive só na borda de I/O.
- 🔑 **Senhas dos usuários:** hash **scrypt** com salt por usuário (nunca em texto plano).
- 🛡️ **Endurecimento:** sessão HttpOnly + `SameSite=Strict` (+ `Secure` em HTTPS),
  rate limit no login, headers de segurança (CSP, HSTS, X-Frame-Options, nosniff),
  CORS fechado e limite de tamanho de requisição.
- 🔏 **Reautenticação** para ações críticas (revelar senha, exportar backup, apagar grupo).
- 📋 **Trilha de auditoria** de todas as ações sensíveis, sem gravar segredos.
- 🔐 **2FA (TOTP)** opcional por usuário, ativável em "Minha conta".

> ⚠️ A `CONTAS_FLOW_ENC_KEY` é a **única** forma de decifrar os dados. Se perdida,
> os campos cifrados ficam irrecuperáveis. Guarde-a num cofre separado do volume.
> Veja **[docs/DEPLOY.md](docs/DEPLOY.md)**.

---

## Uso local

```bash
npm install
npm run local
```

O app abre em `http://127.0.0.1:5175` e a API em `http://127.0.0.1:8787`.

No primeiro acesso, defina o admin inicial via variáveis de ambiente (copie
`.env.example` para `.env` e preencha `APP_AUTH_USER` / `APP_AUTH_PASSWORD`).
Depois entre com essas credenciais e crie a equipe pelo painel **Equipe**.

---

## Deploy (equipe)

Produção roda no **Railway** como um único serviço Node (API + frontend), via
Dockerfile multi-stage. O guia completo — variáveis, geração da chave de
criptografia, volume persistente, backup e checklist de go-live — está em
**[docs/DEPLOY.md](docs/DEPLOY.md)**.

---

## Stack

| Camada     | Tecnologia                                                  |
| ---------- | ----------------------------------------------------------- |
| Frontend   | React 18 + TypeScript, Vite 6, Tailwind CSS 3, Lucide React |
| i18n       | react-i18next (pt · en · es · fr · zh)                      |
| Backend    | Node HTTP nativo, sem framework                             |
| Cripto     | AES-256-GCM (`crypto` nativo), scrypt, TOTP RFC 6238        |
| Deploy     | Railway — Dockerfile multi-stage, volume `/data`            |
| Integração | googleapis (YouTube OAuth/upload — em pausa)                |

---

## Estrutura

```text
src/
  components/
    account-vault.tsx       # tela principal do cofre
    local-login.tsx         # tela de login
    register.tsx            # tela de criar conta
    forgot-password.tsx     # recuperação de senha
    lang-terminal.tsx       # seletor de idioma compartilhado
    users-dialog.tsx        # painel "Equipe" (admin)
    platform-icons.tsx      # glyphs de marca
    theme-toggle.tsx        # seletor de tema
    ui/                     # button, input, switch, spinner, toast, ...
  data/credential-records.ts  # tipos e opções de plataformas/funções
  locales/                  # traduções pt · en · es · fr · zh
  theme.ts                  # definição dos temas
server/
  index.mjs                 # API (auth, usuários, grupos, contas, backup) + estáticos
  users.mjs                 # store de usuários + scrypt
  crypto.mjs                # criptografia em repouso (AES-256-GCM)
  sessions.mjs              # sessões server-side revogáveis
  audit.mjs                 # trilha de auditoria
  totp.mjs                  # 2FA TOTP (RFC 6238)
  youtube.mjs               # OAuth + upload YouTube (em pausa)
scripts/
  local-dev.mjs             # sobe API + Vite juntos
storage/                    # JSON gerados em runtime — ignorados pelo git
  users.json                # usuários (logins) + hashes scrypt
  groups.json               # grupos + contas (campos sensíveis cifrados)
  sessions.json             # sessões ativas
  audit.json                # trilha de auditoria
  youtube.json              # tokens OAuth dos canais (cifrados)
docs/                       # ARQUITETURA.md · DEPLOY.md · LGPD.md · YOUTUBE.md
```

---

## Scripts

```bash
npm run local    # app + API local (dev)
npm run dev      # somente frontend (Vite)
npm run api      # somente API
npm run build    # type-check + build de produção
npm run start    # serve a API + build pronto
npm run format   # formata com Prettier
```

---

## Documentação

| Documento                                  | Conteúdo                                              |
| ------------------------------------------ | ----------------------------------------------------- |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Como o sistema funciona por dentro                    |
| [docs/DEPLOY.md](docs/DEPLOY.md)           | Subir em produção no Railway                          |
| [docs/LGPD.md](docs/LGPD.md)               | Controles operacionais de privacidade e LGPD          |
| [docs/YOUTUBE.md](docs/YOUTUBE.md)         | Integração YouTube OAuth/upload (em pausa)            |
| [SECURITY.md](SECURITY.md)                 | Boas práticas e checklist de segurança do repositório |
| [IA.md](IA.md)                             | Contexto rápido para quem for trabalhar no projeto    |

> Os dados ficam em `storage/` (git-ignored). Nunca commite `storage/`, `.env`,
> prints ou backups com credenciais reais.
