import { writeFileSync } from "fs";

const README = `<div align="center">

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

- O **admin inicial** é criado automaticamente a partir de \`APP_AUTH_USER\` /
  \`APP_AUTH_PASSWORD\` no primeiro start. Os demais são criados pela UI (painel
  **Equipe**, visível só para admin).
- Cada grupo tem um dono (\`ownerId\`). Um membro só acessa o que é seu — tentativas
  fora disso respondem \`404\` (a existência do recurso não é revelada).
- Ao remover um usuário, seus grupos são **reatribuídos ao admin** — nada fica órfão.

---

## Segurança

- 🔒 **Criptografia em repouso (AES-256-GCM):** senha, email de recuperação,
  telefone e notas das contas — e os refresh tokens do YouTube — são cifrados no
  disco com uma chave-mestra (\`CONTAS_FLOW_ENC_KEY\`). Em memória e na API o
  servidor trabalha sempre com texto plano; a cifragem vive só na borda de I/O.
- 🔑 **Senhas dos usuários:** hash **scrypt** com salt por usuário (nunca em texto plano).
- 🛡️ **Endurecimento:** sessão HttpOnly + \`SameSite=Strict\` (+ \`Secure\` em HTTPS),
  rate limit no login, headers de segurança (CSP, HSTS, X-Frame-Options, nosniff),
  CORS fechado e limite de tamanho de requisição.
- 🔏 **Reautenticação** para ações críticas (revelar senha, exportar backup, apagar grupo).
- 📋 **Trilha de auditoria** de todas as ações sensíveis, sem gravar segredos.
- 🔐 **2FA (TOTP)** opcional por usuário, ativável em "Minha conta".

> ⚠️ A \`CONTAS_FLOW_ENC_KEY\` é a **única** forma de decifrar os dados. Se perdida,
> os campos cifrados ficam irrecuperáveis. Guarde-a num cofre separado do volume.
> Veja **[docs/DEPLOY.md](docs/DEPLOY.md)**.

---

## Uso local

\`\`\`bash
npm install
npm run local
\`\`\`

O app abre em \`http://127.0.0.1:5175\` e a API em \`http://127.0.0.1:8787\`.

No primeiro acesso, defina o admin inicial via variáveis de ambiente (copie
\`.env.example\` para \`.env\` e preencha \`APP_AUTH_USER\` / \`APP_AUTH_PASSWORD\`).
Depois entre com essas credenciais e crie a equipe pelo painel **Equipe**.

---

## Deploy (equipe)

Produção roda no **Railway** como um único serviço Node (API + frontend), via
Dockerfile multi-stage. O guia completo — variáveis, geração da chave de
criptografia, volume persistente, backup e checklist de go-live — está em
**[docs/DEPLOY.md](docs/DEPLOY.md)**.

---

## Stack

| Camada     | Tecnologia                                                   |
| ---------- | ------------------------------------------------------------ |
| Frontend   | React 18 + TypeScript, Vite 6, Tailwind CSS 3, Lucide React  |
| i18n       | react-i18next (pt · en · es · fr · zh)                       |
| Backend    | Node HTTP nativo, sem framework                              |
| Cripto     | AES-256-GCM (\`crypto\` nativo), scrypt, TOTP RFC 6238         |
| Deploy     | Railway — Dockerfile multi-stage, volume \`/data\`             |
| Integração | googleapis (YouTube OAuth/upload — em pausa)                 |

---

## Estrutura

\`\`\`text
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
\`\`\`

---

## Scripts

\`\`\`bash
npm run local    # app + API local (dev)
npm run dev      # somente frontend (Vite)
npm run api      # somente API
npm run build    # type-check + build de produção
npm run start    # serve a API + build pronto
npm run format   # formata com Prettier
\`\`\`

---

## Documentação

| Documento | Conteúdo |
| --------- | -------- |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Como o sistema funciona por dentro |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Subir em produção no Railway |
| [docs/LGPD.md](docs/LGPD.md) | Controles operacionais de privacidade e LGPD |
| [docs/YOUTUBE.md](docs/YOUTUBE.md) | Integração YouTube OAuth/upload (em pausa) |
| [SECURITY.md](SECURITY.md) | Boas práticas e checklist de segurança do repositório |
| [IA.md](IA.md) | Contexto rápido para quem for trabalhar no projeto |

> Os dados ficam em \`storage/\` (git-ignored). Nunca commite \`storage/\`, \`.env\`,
> prints ou backups com credenciais reais.
`;

const SECURITY = `# 🔒 Segurança e proteção de dados sensíveis

> **Este repositório é PÚBLICO.** Tudo que for commitado fica visível para
> qualquer pessoa — inclusive no histórico do git, mesmo depois de "apagado".
> Antes de cada commit, garanta que **nenhum dado sensível** está sendo versionado.

---

## O que nunca pode ir para o repositório

- **Senhas, PINs e credenciais** de qualquer conta (login do app, redes sociais, e-mail).
- **Chaves de API e segredos** (\`YOUTUBE_CLIENT_ID\`, \`YOUTUBE_CLIENT_SECRET\`, tokens OAuth, etc.).
- **Arquivos de credenciais do Google** (\`client_secret*.json\`, \`credentials*.json\`, \`service-account*.json\`).
- **Dados reais de contas**: e-mails, usuários, telefones, e-mails de recuperação.
- **Backups exportados pelo app** (contêm senhas em texto plano).
- **Conteúdo de \`storage/\`** (\`groups.json\`, \`accounts.json\`, \`youtube.json\`).
- **Chaves privadas** (\`*.pem\`, \`*.key\`, \`*.p12\`).

---

## Onde esses dados devem ficar

| Tipo de dado | Onde guardar | No git? |
| ------------ | ------------ | ------- |
| Login local do app | \`.env\` → \`APP_AUTH_USER\` / \`APP_AUTH_PASSWORD\` | ❌ ignorado |
| Credenciais do YouTube/OAuth | \`.env\` → \`YOUTUBE_*\` | ❌ ignorado |
| Chave de criptografia | \`.env\` → \`CONTAS_FLOW_ENC_KEY\` | ❌ ignorado |
| Contas, senhas, grupos | \`storage/*.json\` (criados em runtime) | ❌ ignorado |
| Backups exportados | \`*.backup.json\`, \`contas_exe-backup-*.json\` | ❌ ignorado |
| Estrutura/exemplo (sem valores) | \`.env.example\` | ✅ versionado (em branco) |

Todas as regras acima estão refletidas no [\`.gitignore\`](.gitignore).

---

## Como configurar localmente (sem vazar nada)

1. Copie o modelo: \`cp .env.example .env\`
2. Preencha o \`.env\` com os **valores reais** (o \`.env\` é ignorado pelo git).
3. Nunca coloque valores reais no \`.env.example\` — ele é público.

---

## Checklist antes de cada commit

\`\`\`bash
# 1. Veja exatamente o que será commitado
git status
git diff --staged

# 2. Garanta que arquivos sensíveis estão ignorados
git check-ignore .env storage/groups.json

# 3. Procure segredos no que está rastreado
git grep -nIE "(senha|password|secret|token|AIza|GOCSPX-|ya29\\.|-----BEGIN)" -- $(git ls-files)
\`\`\`

Se aparecer qualquer credencial real no resultado, **não commite** — mova o
valor para o \`.env\`.

---

## LGPD e dados pessoais

Dados reais de contas (email, usuário, telefone, email de recuperação, notas,
senhas, tokens e backups) também são dados pessoais ou segredos associados a
pessoas identificáveis. Além de não versionar, opere o app conforme
[docs/LGPD.md](docs/LGPD.md): colete só o necessário, restrinja admins, proteja
backups, defina retenção e tenha fluxo para direitos do titular e incidentes.

O app aplica controles de acesso server-side: reautenticação (redigitar a senha)
para ações críticas — revelar/copiar senha, exportar backup, trocar senha,
criar/remover admin, apagar grupo — e uma trilha de auditoria (sem segredos) do
que cada um fez. A senha não trafega na listagem; é buscada sob demanda atrás de
reauth. Há ainda **2FA opcional (TOTP)** por usuário, ativável em "Minha conta";
o secret e os códigos de recuperação ficam cifrados em repouso. Ver
[docs/ARQUITETURA.md](docs/ARQUITETURA.md).

---

## Se um segredo vazar mesmo assim

1. **Considere o segredo comprometido** e **troque/revogue imediatamente**
   (senha do app, client secret do Google, tokens). Reescrever o histórico
   **não** desfaz o vazamento — o dado já pode ter sido visto, clonado ou indexado.
2. Remova o segredo do código e mova para o \`.env\`.
3. Reescreva o histórico para apagá-lo dos commits antigos (\`git filter-repo\`),
   expire o reflog (\`git reflog expire --expire=now --all\`), rode
   \`git gc --prune=now\` e faça \`git push --force\`.
4. Avise quem tiver clonado o repositório para refazer o clone.

---

## E-mail do autor nos commits

O e-mail configurado no git aparece **publicamente** em cada commit. Para não
expor o e-mail pessoal, este repositório usa o **e-mail privado do GitHub**:

\`\`\`bash
git config user.name  "AndreGustavoms"
git config user.email "133678902+AndreGustavoms@users.noreply.github.com"
\`\`\`

Ative também, em **GitHub → Settings → Emails → "Keep my email addresses private"**
e **"Block command line pushes that expose my email"**, para o GitHub recusar
pushes que vazariam o e-mail real.

---

## Auditoria de histórico (2026-06-03)

Foi feita uma revisão de **100% dos commits e blobs** (12 commits, 137 objetos,
todas as refs e versões deletadas). Resultado:

- ✅ Nenhuma chave de API, token OAuth ou chave privada em commit algum.
- ✅ A senha de login que estava hardcoded foi removida de todo o histórico
  (agora vem do \`.env\`).
- ✅ O e-mail pessoal do autor foi removido de todos os commits do histórico
  (substituído pelo e-mail privado do GitHub \`...@users.noreply.github.com\`).
- ✅ \`initialAccounts\` vazio em todas as versões; \`.env.example\` sempre em branco.
- ✅ \`.env\`, \`storage/*.json\`, \`seed-accounts.mjs\`, \`client_secret*.json\` e backups
  **nunca** existiram no histórico.
- ✅ Nenhum telefone, CPF ou cartão; URLs/números encontrados eram placeholders
  de UI, coordenadas de ícones SVG e exemplos de documentação.

### Como reauditar

\`\`\`bash
# Segredos em todos os blobs de todos os commits
for c in $(git rev-list --all); do
  git ls-tree -r --name-only "$c" | while read f; do
    git show "$c:$f" 2>/dev/null | grep -nIaE \\
      "(AIza[0-9A-Za-z_-]{15,}|ya29\\.|GOCSPX-|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)" \\
      && echo "  ^ em $f @ \${c:0:7}"
  done
done

# E-mails reais de autor no histórico
git log --all --format="%ae %ce" | sort -u
\`\`\`
`;

const IA = `# IA — Contexto Operacional

Resumo rápido para quem (humano ou IA) for trabalhar no projeto.
Para detalhes completos, ver \`README.md\`, \`docs/ARQUITETURA.md\` e \`docs/DEPLOY.md\`.

---

## Projeto

**Contas_exe** — cofre de credenciais de redes sociais para uma **equipe**,
organizado em **grupos**. Era um organizador local pessoal; evoluiu para um app
multiusuário com login por pessoa, criptografia em repouso e deploy no Railway.

---

## O que mudou em relação à versão antiga

- **Multiusuário:** cada pessoa tem login próprio (\`users.json\`, hashes scrypt),
  com papéis admin/member. Não existe mais o login único "Vitissouls".
- **Ownership:** cada grupo tem dono; membro vê só os seus, admin vê todos.
- **Criptografia em repouso (AES-256-GCM):** senha, recovery, telefone e notas
  das contas (e os refresh tokens do YouTube) são cifrados no disco com
  \`CONTAS_FLOW_ENC_KEY\`. O backup manual JSON ainda existe, em texto plano.
- **Persistência:** \`storage/groups.json\` (não mais \`accounts.json\` plano) +
  \`storage/users.json\` + \`storage/sessions.json\` + \`storage/audit.json\`.
  O \`localStorage\` guarda só preferência de tema e id do grupo ativo (por usuário).
- **Endurecimento:** sessão server-side revogável, rate limit, reauth para ações
  críticas, headers de segurança, CORS fechado, trilha de auditoria.
- **2FA (TOTP):** opcional por usuário, implementado com \`crypto\` nativo (RFC 6238).
- **i18n:** todas as telas em pt · en · es · fr · zh via react-i18next.
- **Deploy:** Dockerfile multi-stage no Railway (era Nixpacks, migrado para mais
  controle e builds mais rápidos ~2 min vs ~17 min).
- **Identidade visual:** verde (#22c55e dark / #16a34a light) como cor de acento
  — sem vermelho como cor de marca, sem cyan/azul.

---

## Decisões técnicas

- Frontend React 18 + TypeScript (Vite 6, Tailwind CSS 3, Lucide).
- API Node HTTP nativa (sem framework); serve \`/api/*\` e o build estático.
- 2 temas: Dark (verde neon) e White (verde escuro). Sem tema "Andre".
- Estado inicial vazio (nunca credenciais reais no código).
- YouTube (OAuth/upload) está **em pausa**; o endpoint de upload está desativado.
- Senhas não vêm na listagem — buscadas sob demanda em \`/secret\` (atrás de reauth).

---

## Regras de segurança

- Nunca commitar \`storage/\`, \`.env\`, prints ou backups com dados reais.
- \`CONTAS_FLOW_ENC_KEY\` é a única forma de decifrar — guardar em cofre separado
  do volume. Perdê-la = dados cifrados irrecuperáveis.
- O backup JSON exportado contém senhas em texto plano: tratar como segredo.
- Repositório público: tudo que for commitado é visível para qualquer pessoa.

---

## Verificações

\`\`\`bash
npm run build    # type-check + build de produção
git check-ignore .env storage/groups.json   # deve retornar as regras do .gitignore
\`\`\`
`;

const DEPLOY = `# 🚀 Deploy (Railway) — app multiusuário

Guia para subir o Contas_exe em produção no **Railway**, já no modelo de
**equipe** (logins individuais + criptografia em repouso). O repositório é
**público**, então **nenhum segredo vai no código** — tudo via *Variables* do Railway.

> **Resumo da arquitetura em prod:** 1 serviço Node. O \`server/index.mjs\` serve
> a API \`/api/*\` **e** o front buildado (\`dist/\`). O front usa fetch relativo,
> então não há URL de API para configurar. Build: Dockerfile multi-stage
> (\`npm run build\`); start: \`node server/index.mjs\`; healthcheck: \`/api/health\`.

---

## 1. Variables (Railway → Settings → Variables)

| Variável | Valor | Obrigatória? |
| -------- | ----- | ------------ |
| \`APP_AUTH_USER\` | usuário do **admin inicial** | sim (no 1º deploy) |
| \`APP_AUTH_PASSWORD\` | senha forte do admin inicial | sim (no 1º deploy) |
| \`CONTAS_FLOW_ENC_KEY\` | chave de 32 bytes (64 hex) — ver passo 2 | **sim em prod** |
| \`CONTAS_FLOW_STORAGE_DIR\` | \`/data\` | sim (senão os dados somem) |
| \`CONTAS_FLOW_TRUSTED_PROXIES\` | \`1\` | **sim no Railway** (1 proxy na frente) |
| \`CONTAS_FLOW_ALLOWED_ORIGIN\` | em branco | não (só se a API for consumida de outra origem) |

**Notas importantes:**

- \`APP_AUTH_USER\` / \`APP_AUTH_PASSWORD\` só semeiam o admin inicial quando
  \`users.json\` ainda não existe. Depois disso, mudá-las **não afeta** usuários
  já criados. Os colegas são criados **pela UI** (painel **Equipe**, só admin).
- **Não** setar \`PORT\` / \`HOST\`: o servidor vai para \`0.0.0.0\` sozinho quando o
  Railway injeta \`PORT\`. O cookie de sessão vira \`Secure\` automaticamente em
  produção.
- \`CONTAS_FLOW_TRUSTED_PROXIES=1\` é obrigatório no Railway: sem isso, o rate
  limit do login usa o IP do socket (o do proxy do Railway, igual para todos) e
  um atacante poderia forjar \`X-Forwarded-For\`. Com \`1\`, o app pega o IP real
  que o proxy observou. Em uso local, deixe em branco.
- \`YOUTUBE_*\` só quando for ativar OAuth em prod (integração em pausa).

---

## 2. Gerar a chave de criptografia (\`CONTAS_FLOW_ENC_KEY\`)

Cifra em repouso (AES-256-GCM) os campos sensíveis das contas (senha, email de
recuperação, telefone, notas) e os refresh tokens do YouTube.

\`\`\`bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
\`\`\`

Cole o valor em \`CONTAS_FLOW_ENC_KEY\` no Railway.

> ⚠️ **A chave é a única forma de decifrar os dados.** Se você perdê-la, os
> campos cifrados ficam **irrecuperáveis**. Guarde-a em um gerenciador de senhas
> ou cofre, **separada** do volume de dados. Defina-a **uma vez** e não troque
> (trocar depois de ter dados cifrados exige re-migração, não implementada).

---

## 3. Volume persistente

Railway → **Settings → Volumes → Mount path \`/data\`** (deve bater com
\`CONTAS_FLOW_STORAGE_DIR\`). É onde vivem \`users.json\`, \`groups.json\` (cifrado),
\`sessions.json\` e \`audit.json\`. Sem o volume, os dados somem a cada redeploy.

---

## 4. Domínio

Railway → **Settings → Networking → Generate Domain** (\`*.up.railway.app\`).
Confira que a porta do domínio aponta para a porta que o app escuta (o Railway
injeta \`PORT\`; ajuste em *Networking* se der 502).

---

## 5. Primeiro acesso e criação da equipe

1. Acesse a URL pública e faça login com \`APP_AUTH_USER\` / \`APP_AUTH_PASSWORD\`
   (o admin inicial).
2. Abra o painel **Equipe** (ícone na barra lateral, só admin).
3. Crie um login para cada colega (usuário + senha; marque "admin" só para quem
   precisar ver tudo). Cada colega vê **apenas os próprios grupos**; o admin vê todos.

---

## 6. Backup do volume \`/data\`

Use as duas formas:

- **No app (recomendado, regular):** painel **Equipe → Backup completo → Baixar**.
  Baixa \`contas-backup-AAAA-MM-DD.json\` com todos os grupos e contas em texto
  plano e a lista de usuários (sem as senhas). Guarde em local seguro.
- **Snapshot do volume (infra):** pelo painel/CLI do Railway, faça snapshot do
  volume \`/data\` periodicamente. O \`groups.json\` permanece **cifrado** — só é
  legível com a \`CONTAS_FLOW_ENC_KEY\`.

> O backup do app contém senhas em texto plano: trate com o mesmo cuidado das
> senhas reais. Não compartilhe nem suba a lugar nenhum.

---

## Checklist de go-live

- [ ] \`CONTAS_FLOW_ENC_KEY\` gerada e salva em cofre (separada do volume).
- [ ] Variables setadas no Railway (tabela do passo 1).
- [ ] Volume montado em \`/data\`.
- [ ] Domínio gerado e respondendo (\`/api/health\` → \`{ "ok": true }\`).
- [ ] Login do admin funciona; senha do admin é forte.
- [ ] Logins dos colegas criados pela UI.
- [ ] Backup baixado e guardado pelo menos uma vez.
- [ ] Checklist LGPD revisado: controlador/canal, base legal, aviso interno,
      retenção, backup e incidente. Ver [LGPD.md](./LGPD.md).
`;

const LGPD = `# ⚖️ LGPD — controles operacionais

Este documento registra como o Contas_exe deve ser operado para reduzir o risco
de tratamento inadequado de dados pessoais. Ele **não substitui avaliação
jurídica**: o controlador precisa definir base legal, aviso de privacidade,
encarregado/canal de atendimento e políticas internas.

---

## Escopo de dados pessoais

| Categoria | Onde aparece | Observação LGPD |
| --------- | ------------ | --------------- |
| Usuários do app | \`storage/users.json\` | \`username\`, papel, data de criação e hash scrypt da senha. |
| Contas armazenadas | \`storage/groups.json\` | email, usuário, telefone, email de recuperação, notas e outros metadados podem identificar pessoas. |
| Credenciais | \`storage/groups.json\`, backups | senhas, 2FA e tokens são dados de alto risco; tratar como sigilo máximo. |
| Sessão | cookie HttpOnly | usado apenas para autenticação; \`ipHash\` e \`userAgent\` cifrados em repouso. |
| Backups/exportações | arquivos baixados pelo admin/usuário | podem conter dados pessoais e senhas em texto plano. |
| Logs | console/plataforma de deploy | não devem conter senhas, tokens, dumps de request ou backups. |

O sistema não deve coletar CPF, documentos, dados bancários, dados de saúde,
biometria ou dados de crianças/adolescentes. Se isso virar necessário, faça nova
avaliação de necessidade, base legal, retenção e segurança antes de coletar.

---

## Finalidade e minimização

- **Finalidade principal:** organizar e proteger credenciais de redes sociais
  usadas pela equipe.
- **Coleta mínima:** manter apenas os campos necessários para acesso, recuperação
  e operação da conta. Notas não devem receber dados pessoais livres sem necessidade.
- Sem analytics, pixels, publicidade comportamental ou compartilhamento automático
  com terceiros.
- YouTube OAuth está em pausa e o upload está desativado; se a integração voltar,
  documentar escopos, finalidade, titulares afetados, retenção dos tokens e revogação.
- \`localStorage\` guarda só preferência de tema e id do grupo ativo (não
  sensíveis); a API é a fonte da verdade e nenhum dado de conta fica no navegador.

---

## Base legal e transparência

Antes de produção, o controlador deve registrar fora do código:

- A base legal de cada tratamento (ex.: execução de contrato/atividade
  operacional da equipe e legítimo interesse para segurança e controle de acesso).
- Quem é o controlador, operador(es) e encarregado/canal de privacidade.
- Aviso aos usuários internos sobre quais dados são tratados, por que, por quanto
  tempo, quem acessa e como pedir correção/eliminação.
- Regra para cadastrar credenciais de terceiros: armazenar apenas quando houver
  autorização e necessidade operacional clara.

---

## Controles técnicos aplicados

- 🔒 **Criptografia em repouso AES-256-GCM** para \`password\`, \`recoveryEmail\`,
  \`phone\`, \`notes\` e tokens OAuth, quando \`CONTAS_FLOW_ENC_KEY\` está definida.
- 🔑 Senhas dos usuários com hash **scrypt** e salt por usuário.
- 🍪 Sessão por cookie HttpOnly, \`SameSite=Strict\`, \`Path=/\` e \`Secure\` em HTTPS,
  com estado server-side em \`sessions.json\`: revogável (encerrar uma sessão ou
  todas de um usuário) e com duplo prazo (3h de inatividade, 3 dias absolutos, OWASP).
  \`ipHash\` e \`userAgent\` das sessões são cifrados em repouso.
- 👤 **Isolamento por grupo/owner:** membros acessam apenas seus grupos; admin
  acessa tudo para governança e backup.
- 🚫 **Segredos não ficam no navegador:** as contas (senha, email de recuperação,
  telefone, notas) não são gravadas em \`localStorage\`. A senha nem vem na
  listagem — é buscada sob demanda no endpoint \`/secret\` (atrás de reauth),
  some da tela sozinha e o clipboard é limpo após a cópia.
- 🔏 **Reautenticação para ações críticas:** revelar/copiar senha, exportar
  backup, trocar senha, criar/remover admin e apagar grupo exigem redigitar a senha
  (libera por 5 min). Reduz o risco de uma sessão aberta numa máquina destravada.
- 🔐 **2FA opcional por usuário (TOTP, RFC 6238):** cada um ativa em "Minha conta";
  com 2FA ativo o login pede um código do app autenticador. Secret e códigos de
  recuperação cifrados em repouso; nunca expostos. Admin pode resetar o 2FA de
  quem ficar trancado fora.
- 📋 **Trilha de auditoria** (\`audit.json\`): registra quem fez o que e quando
  (incl. quem viu/copiou senha, exportou backup, trocou/criou/removeu), **sem**
  gravar qualquer segredo. Atende ao dever de informar sobre acesso/compartilhamento.
- 🛡️ Rate limit no login (e na reautenticação), headers de segurança, CORS fechado
  por padrão e limite de corpo de requisição.
- \`storage/\`, \`.env\`, exports e backups são ignorados pelo git.
- \`readDb\` falha alto em erro de leitura/decifragem e não sobrescreve
  \`groups.json\` com store vazio.

---

## Direitos do titular

Fluxo mínimo para atender solicitações:

1. Registrar solicitante, data, escopo e responsável pelo atendimento.
2. Confirmar identidade e autorização antes de revelar ou alterar dados.
3. Localizar dados em usuários, grupos, contas, backups recentes e logs.
4. Atender conforme o caso:
   - **acesso/confirmação:** exportar ou listar os dados pertinentes;
   - **correção:** editar a conta/grupo/usuário pela UI;
   - **eliminação/bloqueio:** apagar conta, grupo ou usuário quando não houver
     motivo operacional/legal para retenção;
   - **informação sobre acesso/compartilhamento:** listar administradores,
     operadores de infraestrutura e backups onde o dado existe; o painel
     "Registro de atividade" (audit log) mostra quem viu/alterou/exportou e quando.
5. Registrar a resposta e qualquer exceção de retenção.

> Ao remover um usuário, os grupos dele são reatribuídos ao admin para evitar
> perda de dados. Para uma eliminação LGPD completa, o admin deve revisar esses
> grupos e apagar ou transferir somente o que tiver justificativa.

---

## Retenção e backup

- Definir prazo de retenção por política interna. O padrão recomendado é manter
  credenciais apenas enquanto houver necessidade operacional.
- Exportações de grupo e backup completo contêm dados em texto plano — guardar em
  cofre, com acesso restrito, criptografia no destino e prazo de expiração.
- Snapshot do volume preserva \`groups.json\` cifrado, mas ainda é dado pessoal:
  proteger junto com \`CONTAS_FLOW_ENC_KEY\`, que deve ficar em cofre separado.
- Antes de compartilhar prints, logs ou arquivos com suporte externo, remover
  emails, telefones, usuários, senhas, tokens e URLs privadas.

---

## Incidentes de segurança

Tratar como incidente qualquer perda, acesso indevido, publicação acidental,
backup exposto, chave vazada, token OAuth vazado, conta comprometida ou
indisponibilidade relevante que afete confidencialidade, integridade,
disponibilidade ou autenticidade dos dados pessoais.

**Procedimento mínimo:**

1. **Conter:** revogar/trocar senhas, tokens e \`CONTAS_FLOW_ENC_KEY\` quando
   aplicável; restringir acessos e preservar evidências.
2. **Avaliar impacto:** titulares afetados, categorias de dados, volume, proteções
   existentes (ex.: criptografia) e risco/dano relevante.
3. **Corrigir:** remover exposição, restaurar de backup seguro e aplicar patch.
4. **Comunicar:** se houver risco ou dano relevante, o controlador deve avaliar
   comunicação aos titulares e à ANPD.
5. **Registrar:** linha do tempo, causa raiz, medidas tomadas e prevenções futuras.

---

## Checklist de produção LGPD

- [ ] Controlador, operador(es) e canal/encarregado definidos.
- [ ] Base legal e finalidade documentadas.
- [ ] Aviso interno de privacidade entregue aos usuários.
- [ ] \`CONTAS_FLOW_ENC_KEY\` definida e guardada em cofre separado.
- [ ] Admins limitados a quem realmente precisa.
- [ ] Política de backup, retenção e descarte definida.
- [ ] Processo de atendimento a direitos do titular definido.
- [ ] Processo de incidente e comunicação definido.
- [ ] Auditoria periódica de git, storage, backups e logs agendada.

---

## Referências oficiais

- [ANPD — Titular de Dados](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1)
- [ANPD — Comunicação de Incidente de Segurança](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis)
`;

const ARQUITETURA = `# 🏗️ Arquitetura do Contas_exe

Cofre de credenciais de redes sociais para **equipes**, organizado em **grupos**
com login por usuário e criptografia em repouso. Um único serviço Node serve a
API e o frontend buildado; a persistência é em arquivos JSON.

\`\`\`
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
\`\`\`

Em produção é **um serviço só**: o \`server/index.mjs\` serve \`/api/*\` e também o
build estático de \`dist/\`. \`scripts/local-dev.mjs\` sobe API + Vite juntos em dev
(\`npm run local\`).

---

## Modelo de dados

### Usuários — \`storage/users.json\`

\`\`\`json
{
  "users": [
    { "id": "uuid", "username": "andre", "role": "admin",
      "passwordHash": "scrypt:N:r:p:saltHex:hashHex", "createdAt": "ISO" }
  ]
}
\`\`\`

- Papéis: **admin** (vê todos os grupos, gerencia usuários e backup) e **member**
  (vê só os próprios grupos). Ver \`server/users.mjs\`.
- Senhas: hash **scrypt** com salt por usuário; nunca em texto plano.
- O admin inicial é semeado de \`APP_AUTH_USER\` / \`APP_AUTH_PASSWORD\` quando o
  arquivo ainda não existe.

### Grupos e contas — \`storage/groups.json\`

\`\`\`json
{
  "groups": [
    { "id": "uuid", "name": "Vitissouls", "ownerId": "uuid",
      "accounts": [ /* AccountRecord[] */ ] }
  ]
}
\`\`\`

- **Ownership:** cada grupo tem \`ownerId\`. Um membro só acessa grupos que possui;
  o admin vê todos. O "grupo ativo" é estado **do navegador** (localStorage,
  namespaceado por usuário), não do servidor.
- **Migração automática:** se existir um \`storage/accounts.json\` antigo (array
  plano), o servidor cria um grupo **"Vitissouls"** com aquelas contas e o atribui
  ao admin no startup (\`backfillOwners\`).
- **Importar** um backup **cria um grupo novo** (não mistura com os existentes).
- **Exportar** salva **apenas o grupo ativo** (\`contas-<grupo>-AAAA-MM-DD.json\`).
  O **backup completo** (admin) exporta tudo.

\`AccountRecord\` (ver \`src/data/credential-records.ts\`): \`id, platform, role,
owner, label, email, username, password, recoveryEmail, phone, status,
twoFactor, postDay, niche, notes, updatedAt\`. Cifrados em repouso: \`password\`,
\`recoveryEmail\`, \`phone\`, \`notes\`.

Ordenação das contas: **alfabética por \`email\`** (chave primária), depois pelos
demais campos como desempate. Ver \`sortAccounts\` em \`account-vault.tsx\`.

---

## API (\`server/index.mjs\`)

Sem framework: um \`createServer\` com despacho por \`URL\` + regex. Helpers:
\`readDb\`/\`writeDb\`, \`normalizeRecord\`, \`sendJson\`, \`requireUser\`, \`canSeeGroup\`.

**Gate:** todo \`/api/*\` exige sessão válida, **exceto** \`/api/health\`,
\`/api/auth/*\` e \`/api/youtube/callback\`. CORS é same-origin por padrão (sem \`*\`).

### Auth

| Método | Rota | Ação |
| ------ | ---- | ---- |
| POST | \`/api/auth/login\` | Valida credenciais (scrypt), emite cookie de sessão. Rate-limited. |
| POST | \`/api/auth/login/totp\` | Finaliza login com código TOTP (2FA). |
| POST | \`/api/auth/logout\` | Encerra a sessão. |
| POST | \`/api/auth/reauth\` | Reautenticação para ações críticas (rate-limited). |
| GET  | \`/api/auth/status\` | Diz se há sessão e quem é (\`{authenticated, user}\`). |
| POST | \`/api/auth/register\` | Cria conta (pede aprovação de admin, dependendo da config). |

### Usuários (admin)

| Método | Rota | Ação |
| ------ | ---- | ---- |
| GET    | \`/api/users\` | Lista usuários (sem hashes). |
| POST   | \`/api/users\` | Cria usuário (\`username\`, \`password\`, \`role\`). |
| DELETE | \`/api/users/:id\` | Remove usuário (re-atribui os grupos dele ao admin). |
| PUT    | \`/api/users/:id/password\` | Reseta a senha de um usuário. |
| POST   | \`/api/users/:id/sessions/revoke\` | Revoga todas as sessões de um usuário. |
| POST   | \`/api/users/:id/2fa/reset\` | Admin reseta o 2FA de um usuário trancado. |

### Sessões

| Método | Rota | Ação |
| ------ | ---- | ---- |
| GET    | \`/api/sessions\` | Lista sessões ativas do usuário logado. |
| DELETE | \`/api/sessions/:id\` | Revoga uma sessão específica. |

### Conta do usuário

| Método | Rota | Ação |
| ------ | ---- | ---- |
| GET  | \`/api/account/2fa\` | Status do 2FA do usuário. |
| POST | \`/api/account/2fa/setup\` | Inicia setup (retorna secret + QR data). |
| POST | \`/api/account/2fa/enable\` | Confirma código e ativa o 2FA. |
| POST | \`/api/account/2fa/disable\` | Desativa o 2FA (reauth). |
| GET  | \`/api/account/2fa/recovery-codes\` | Lista códigos de recuperação restantes. |
| POST | \`/api/account/2fa/recovery-codes\` | Gera novos códigos (reauth). |

### Grupos (ownership-scoped)

| Método | Rota | Ação |
| ------ | ---- | ---- |
| GET    | \`/api/groups\` | Lista grupos visíveis (\`{id,name,ownerId,count}\`). |
| POST   | \`/api/groups\` | Cria grupo (dono = criador). |
| PUT    | \`/api/groups/:id\` | Renomeia grupo. |
| DELETE | \`/api/groups/:id\` | Exclui grupo (reauth). |

### Contas (dentro de um grupo)

| Método | Rota | Ação |
| ------ | ---- | ---- |
| GET    | \`/api/groups/:gid/accounts\` | Lista contas do grupo (senha mascarada). |
| GET    | \`/api/groups/:gid/accounts/:id/secret\` | Retorna a senha real (reauth + auditoria). |
| POST   | \`/api/groups/:gid/accounts\` | Cria conta. |
| POST   | \`/api/groups/:gid/accounts/import\` | Substitui as contas do grupo (importação). |
| PUT    | \`/api/groups/:gid/accounts/:id\` | Edita conta. |
| DELETE | \`/api/groups/:gid/accounts/:id\` | Remove conta. |

Em todas as rotas de grupo/conta, um recurso que o usuário não pode ver responde
**404** (não revela existência). Ver \`canSeeGroup\`/\`resolveOwnedGroup\`.

### Backup (admin)

| Método | Rota | Ação |
| ------ | ---- | ---- |
| GET | \`/api/admin/backup\` | Baixa todos os grupos/contas (texto plano, sem hashes de senha). |

### Auditoria (admin)

| Método | Rota | Ação |
| ------ | ---- | ---- |
| GET | \`/api/audit\` | Retorna os últimos eventos da trilha de auditoria. |

### YouTube

OAuth em pausa; o endpoint de upload está **desativado** (503) por segurança.
Ver **[docs/YOUTUBE.md](./YOUTUBE.md)**.

### Estáticos

Fora de \`/api/\`, serve a build de \`dist/\` (SPA fallback para \`index.html\`).

---

## Frontend (\`src/\`)

- **\`App.tsx\`** — alterna entre \`LocalLogin\` e \`AccountVault\`; consulta
  \`/api/auth/status\` no mount e guarda o usuário logado (\`{username, role}\`) e o
  tema (localStorage). O papel do usuário dirige as features de admin.
- **\`components/account-vault.tsx\`** — tela principal: navbar, sidebar
  (seletor de grupo + engrenagem de ações + lista de redes + **Equipe** (admin) +
  Sair), lista de registros, busca/filtro, wizard de cadastro, quick view, e os
  modais (\`ModalShell\`, \`GroupDialog\`, \`ConfirmDialog\`).
- **\`components/users-dialog.tsx\`** — painel **Equipe** (só admin): criar/remover
  usuários, sessões ativas, trilha de auditoria e backup completo.
- **\`components/local-login.tsx\`** — tela de login (usuário + senha + TOTP).
- **\`components/register.tsx\`** — tela de criar conta (campos, validação, i18n).
- **\`components/forgot-password.tsx\`** — tela de recuperação de senha.
- **\`components/lang-terminal.tsx\`** — seletor de idioma compartilhado entre as
  telas de login, registro e recuperação.
- **\`components/platform-icons.tsx\`** — glyphs de marca (YouTube, Instagram, TikTok,
  Kwai, Facebook).
- **\`components/theme-toggle.tsx\`** — seletor de tema (Dark / White).
- **\`components/ui/\`** — \`button\` (com variante \`neon\`), \`input\`, \`switch\`,
  \`spinner\`, \`toast\`, \`card\`, \`badge\`, \`form-alert\`.
- **\`data/credential-records.ts\`** — tipos, \`platformOptions\`, \`roleOptions\`.
- **\`theme.ts\`** + **\`index.css\`** — 2 temas (\`dark\`, \`white\`) por variáveis CSS.
  Cor de acento verde: \`#22c55e\` (dark) / \`#16a34a\` (white). Os componentes
  uiverse (borda neon, label flutuante, switch, spinner, toast, spotlight) são
  todos tingidos por essas variáveis. Tudo respeita \`prefers-reduced-motion\`.
- **\`locales/\`** — traduções em \`pt.json\`, \`en.json\`, \`es.json\`, \`fr.json\`, \`zh.json\`
  (login, registro, vault, equipe, conta, plataformas, funções, status).

### Persistência no cliente

\`account-vault.tsx\` busca os grupos e as contas do grupo ativo via API a cada
montagem. **As contas nunca são guardadas no navegador** — elas carregam segredos
e persistir em \`localStorage\` os vazaria para quem tivesse acesso à máquina. A
única coisa guardada localmente é o **id do grupo ativo**
(\`contas_exe.activeGroup.v1:<username>\`, namespaceado por usuário), que não é
segredo. A API é a fonte da verdade.

A senha nem vem na listagem: ao revelar ou copiar, o front a busca sob demanda
em \`/secret\` (reauth), mantém o valor só em memória, reoculta após ~15s e limpa
o clipboard após ~20s. Uma ação crítica que receba \`403 reauth_required\` abre o
modal de reautenticação e é refeita automaticamente após confirmação.

---

## Segurança

### Criptografia em repouso (AES-256-GCM)

Com \`CONTAS_FLOW_ENC_KEY\` definida, os campos sensíveis das contas (\`password\`,
\`recoveryEmail\`, \`phone\`, \`notes\`) e os refresh tokens do YouTube são cifrados
no disco (formato \`enc:v1:...\`), com IV aleatório por valor e tag de autenticação.
Em memória e na API o servidor sempre usa texto plano; a cifragem vive só na
borda de I/O (\`readDb\`/\`writeDb\`, \`readTokens\`/\`writeTokens\`). Ver \`server/crypto.mjs\`.

**Sem a chave**, esses campos ficam em texto plano (uso local). A migração de
texto plano para cifrado é automática e idempotente: ao subir com a chave, o
servidor re-grava o store cifrado no startup. A chave é a **única** forma de
decifrar: se perdida, os campos cifrados são irrecuperáveis.

### Login e sessões

Multiusuário com hash **scrypt** (salt por usuário) em \`users.json\`; sessão via
cookie HttpOnly + \`SameSite=Strict\` + \`Path=/\` (+ \`Secure\` em HTTPS), \`Max-Age\`
de 3 dias. Estado das sessões em \`storage/sessions.json\` (\`server/sessions.mjs\`):
sobrevive a redeploy, pode ser revogado. Dois prazos independentes (OWASP):
**3h de inatividade** (\`lastSeenAt\`) e **teto absoluto de 3 dias** (\`expiresAt\`,
nunca estendido). \`ipHash\` (SHA-256 do IP) e \`userAgent\` são cifrados em repouso.

### 2FA (TOTP)

Cada usuário ativa/desativa o seu em "Minha conta": adiciona a chave no app
autenticador, confirma um código de 6 dígitos para ligar e recebe **8 códigos de
recuperação** (uso único, mostrados uma vez). Implementado com \`crypto\` nativo,
RFC 6238 (\`server/totp.mjs\`). Com 2FA ativo, o login é em duas etapas:
\`/api/auth/login\` responde \`{ twoFactorRequired: true }\` (sem cookie) e o cliente
finaliza em \`POST /api/auth/login/totp\`. O secret e os hashes dos códigos de
recuperação são cifrados em repouso em \`users.json\`.

### Reautenticação e senha sob demanda

Revelar/copiar senha, exportar backup, trocar senha, criar/remover admin, apagar
grupo e "sair de todos os dispositivos" exigem que o usuário **redigite a senha**
(\`POST /api/auth/reauth\`, rate-limited). O sucesso grava \`reauthAt\` na sessão e
libera essas ações por **5 min** (\`hasRecentReauth\`). A listagem NÃO traz a senha
— o valor real é buscado por \`GET /api/groups/:gid/accounts/:aid/secret\`, atrás
de reauth, e registrado na auditoria. Editar uma conta sem mexer na senha não a
apaga (senha vazia = "inalterada").

### Auditoria

\`storage/audit.json\` (\`server/audit.mjs\`) registra eventos sensíveis (login/logout,
reauth, ver/copiar senha, exportar backup, trocar senha, criar/remover usuário,
apagar grupo, revogar sessões) com \`{ ts, userId, username, action, target, ipHash }\`.
**Nunca** grava senha, valor copiado ou token. Rotação: mantém os últimos 5000.
O admin vê os últimos eventos no painel Equipe (\`GET /api/audit\`).

### Endurecimento HTTP/API

Login rate-limited em memória por IP (10 tentativas/10 min; sucesso limpa o
contador). O IP vem do socket por padrão; \`X-Forwarded-For\` só é aceito quando
\`CONTAS_FLOW_TRUSTED_PROXIES\` informa quantos proxies confiáveis existem (Railway = \`1\`).
Todas as respostas recebem headers de segurança (CSP, HSTS quando cookie \`Secure\`,
\`X-Frame-Options: DENY\`, \`X-Content-Type-Options: nosniff\`, \`Referrer-Policy: no-referrer\`).
Corpos limitados a **1 MB**. Erros internos são logados no servidor e viram apenas
\`{ error: "server_error" }\` para o cliente.

### Proteção contra perda de dados

\`readDb\` nunca sobrescreve \`groups.json\` em caso de erro de leitura, JSON
corrompido ou falha de decifragem. Só \`ENOENT\` (arquivo inexistente) dispara
a migração/criação inicial. Uma \`CONTAS_FLOW_ENC_KEY\` errada, ausente ou perdida
faz o servidor **falhar alto** e preservar o arquivo no disco.

---

## .gitignore — o que está protegido e por quê

| Padrão | Cobre | Motivo |
| ------- | ----- | ------ |
| \`.env\`, \`.env.*\` (exceto \`.env.example\`) | Client ID/Secret da Google | segredos OAuth |
| \`client_secret*.json\`, \`credentials*.json\`, \`*.pem\`, \`*.key\` | credenciais baixadas | nunca devem ir ao repo |
| \`storage/*\` (exceto \`storage/.gitkeep\`) | \`groups.json\`, \`accounts.json\`, \`youtube.json\`, backups | **senhas reais e refresh tokens** |
| \`*.backup.json\`, \`contas-*.json\`, \`backups/\` | exports do app | contêm senhas |
| \`*.log\` | logs locais | podem vazar dados |

O \`storage/.gitkeep\` (arquivo vazio) é o **único** de \`storage/\` rastreado, só
para a pasta existir no repositório.

\`\`\`bash
git check-ignore -v storage/groups.json   # deve apontar a regra do .gitignore
git ls-files storage/                      # deve listar apenas storage/.gitkeep
\`\`\`
`;

const YOUTUBE = `# 📹 Integração YouTube (publicar e agendar vídeos)

Este documento descreve a integração do Contas_exe com a **YouTube Data API v3**
para fazer upload e **agendar** a publicação de vídeos nos canais do próprio usuário.

> **Status: Fase 0 (backend) implementada.** Falta o usuário criar as
> credenciais no Google Cloud, conectar um canal e validar um upload. A
> interface (UI) ainda **não** foi construída — o uso atual é via rotas HTTP.

---

## Decisões de projeto

| Tema | Decisão |
| ---- | ------- |
| Onde roda | Local agora (\`127.0.0.1\`); HTTPS/domínio depois. Migrar = trocar \`YOUTUBE_REDIRECT_URI\`. |
| Volume | ≤ 5 uploads/dia. Cabe na cota padrão (10.000 unidades/dia; ~1.600 por upload). |
| Canais | Todos do próprio usuário (caso de uso legítimo). |
| Segredos | Client ID/Secret no \`.env\` (git-ignored). Tokens em \`storage/youtube.json\` (cifrados). |
| Backend | Estende o \`server/index.mjs\` existente, usando a lib oficial \`googleapis\`. |

### Cota — leia antes de escalar

Cada \`videos.insert\` (upload) custa **~1.600 unidades**; a cota padrão é
**10.000/dia por projeto**, somando todos os canais → **~6 uploads/dia**.
Para o volume planejado (≤5/dia) está tranquilo. Aumentar a cota exige revisão
manual da Google e costuma ser negado para automação em massa.

---

## Passo a passo no Google Cloud

### 1. Projeto + ativar a API

1. Acesse o Google Cloud Console e crie um projeto (ex.: \`Contas_exe\`).
2. **APIs e Serviços → Biblioteca** → busque **"YouTube Data API v3"** → **Ativar**.

### 2. Tela de consentimento OAuth

1. **APIs e Serviços → Tela de consentimento OAuth** → tipo **Externo**.
2. Preencha nome do app e e-mail de contato.
3. Em **Usuários de teste**, adicione o(s) e-mail(s) das contas que vão conectar.

> **Modo "Testing":** os refresh tokens expiram a cada **7 dias** e há limite de
> ~100 usuários de teste. Suficiente para a Fase 0. Quando subir para um domínio
> público, publique/verifique o app para tokens duradouros.

### 3. Credenciais (Client ID/Secret)

1. **APIs e Serviços → Credenciais → Criar credenciais → ID do cliente OAuth**.
2. Tipo: **App da Web**.
3. Em **URIs de redirecionamento autorizados**, adicione:
   \`\`\`
   http://127.0.0.1:8787/api/youtube/callback
   \`\`\`
   (Em produção, adicione também \`https://SEU-DOMINIO/api/youtube/callback\`.)
4. Salve e copie o **Client ID** e o **Client Secret**.

### 4. Preencher o \`.env\`

\`\`\`bash
cp .env.example .env
\`\`\`

Abra o \`.env\` e preencha:

\`\`\`env
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=http://127.0.0.1:8787/api/youtube/callback
\`\`\`

### 5. Conectar um canal

1. \`npm run local\`
2. Acesse \`http://127.0.0.1:8787/api/youtube/connect\`
3. Faça login na conta do canal e autorize. O canal fica salvo em
   \`storage/youtube.json\`.
4. Confira: \`http://127.0.0.1:8787/api/youtube/channels\`

---

## Endpoints da API

Todos sob \`/api/youtube/*\`, servidos por \`server/index.mjs\` (lógica em
\`server/youtube.mjs\`).

| Método | Rota | O que faz |
| ------ | ---- | --------- |
| GET  | \`/api/youtube/connect\` | Redireciona para a tela de consentimento da Google. |
| GET  | \`/api/youtube/callback\` | Recebe o \`?code\`, troca por tokens, salva o canal, redireciona ao app. |
| GET  | \`/api/youtube/channels\` | Lista canais conectados (sem segredos). |
| POST | \`/api/youtube/upload\` | Faz upload (com agendamento opcional). |

### Upload — \`POST /api/youtube/upload\`

\`\`\`json
{
  "channelId": "UC...",
  "filePath": "C:/caminho/do/video.mp4",
  "title": "Meu vídeo",
  "description": "opcional",
  "tags": ["opcional"],
  "publishAt": "2026-06-10T18:00:00Z"
}
\`\`\`

- **Sem \`publishAt\`** → vídeo enviado como **privado**.
- **Com \`publishAt\`** → enviado como privado e publicado automaticamente
  na data/hora informada (UTC, \`Z\` no fim).

**Resposta:**

\`\`\`json
{ "videoId": "...", "title": "...", "publishAt": "...", "privacyStatus": "private" }
\`\`\`

**Exemplo (PowerShell):**

\`\`\`powershell
$body = @{
  channelId = "UC..."
  filePath  = "C:\\videos\\teste.mp4"
  title     = "Teste agendado"
  publishAt = "2026-06-10T18:00:00Z"
} | ConvertTo-Json

Invoke-RestMethod \`
  -Uri http://127.0.0.1:8787/api/youtube/upload \`
  -Method Post \`
  -ContentType "application/json" \`
  -Body $body
\`\`\`

---

## Como os tokens são guardados

\`storage/youtube.json\` (git-ignored):

\`\`\`json
{
  "channels": [
    { "id": "UC...", "title": "Meu Canal", "refreshToken": "enc:v1:...", "connectedAt": "..." }
  ]
}
\`\`\`

Mantemos apenas o **refresh token** (longo prazo); o access token é curto e a
\`googleapis\` o renova sob demanda. Os refresh tokens são **cifrados em repouso**
com \`server/crypto.mjs\` quando \`CONTAS_FLOW_ENC_KEY\` está definida.
**Nunca** commite este arquivo nem o \`.env\`.

---

## Próximos passos (não implementados)

1. **UI (Fase 2):** botão "Conectar YouTube", enviar/agendar vídeo, biblioteca,
   edição de metadados, miniatura e histórico.
2. **Vincular canal ↔ grupo:** associar cada canal do YouTube a um grupo do cofre.
3. **Produção:** HTTPS/domínio, publicar o app OAuth e definir retenção dos tokens
   conforme LGPD.
`;

writeFileSync("README.md", README);
writeFileSync("SECURITY.md", SECURITY);
writeFileSync("IA.md", IA);
writeFileSync("docs/DEPLOY.md", DEPLOY);
writeFileSync("docs/LGPD.md", LGPD);
writeFileSync("docs/ARQUITETURA.md", ARQUITETURA);
writeFileSync("docs/YOUTUBE.md", YOUTUBE);

console.log("Todos os arquivos de documentação escritos.");
