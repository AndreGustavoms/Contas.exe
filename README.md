# Contas.exe

Projeto local do Andre para organizar emails, usuarios, contas e senhas de
redes sociais, organizados em **grupos** (perfis/contextos).

## Uso local

```bash
npm install
npm run local
```

O app abre em `http://127.0.0.1:5175`. A API local roda em
`http://127.0.0.1:8787`.

Login local:

- Nome: `Vitissouls`
- Senha: `Vitissouls`

## O que o app faz

- Tela de acesso local antes do cofre.
- Temas: Andre, Dark e White (alto contraste nos tres).
- **Grupos de contas**: cada grupo (ex.: Vitissouls) tem seu proprio conjunto
  de contas. Da para criar, renomear, excluir e alternar entre grupos.
- Cadastro local de contas por plataforma: YouTube, Instagram, TikTok, Facebook,
  Kwai, email ou Estrela.
- Organizacao por funcao: postagem, apoio, conta estrela, nicho, recuperacao,
  financeiro ou administrativo.
- Cadastro guiado com nome, rede, funcao, email, usuario, senha e 2FA.
- Busca, abas de status e filtros por plataforma/funcao.
- Registros em ordem alfabetica **por email**.
- Botoes para copiar email e senha.
- Salvamento local em `storage/groups.json`.
- Exportar (somente o grupo atual) e importar (cria um grupo novo) backup JSON.

## Integracao YouTube (em andamento)

Backend para **publicar e agendar videos** nos proprios canais via YouTube
Data API v3. A base esta pronta; falta configurar as credenciais e a UI.
Guia completo: **[docs/YOUTUBE.md](docs/YOUTUBE.md)**.

## Importante sobre senhas

Os dados ficam em `storage/groups.json`, no seu computador. Isso e pratico para
uso local, mas **nao e criptografia**. Evite commitar esse arquivo, backups,
prints ou mensagens com senhas reais. O `.gitignore` ja ignora os arquivos JSON
da pasta `storage/`, o `.env` e os backups.

## Stack

- React 18 + TypeScript
- Node HTTP API local (sem framework)
- Vite + Tailwind CSS 3 + Lucide React
- googleapis (integracao YouTube)

## Estrutura

```text
src/
  components/
    account-vault.tsx     # tela principal do organizador local
    local-login.tsx       # tela de acesso
    platform-icons.tsx    # glyphs de marca
    theme-toggle.tsx      # seletor de tema
    ui/                   # componentes visuais pequenos
  data/
    credential-records.ts # tipos e opcoes
  theme.ts                # definicao dos temas
server/
  index.mjs               # API local (grupos, contas, youtube) + estaticos
  youtube.mjs             # OAuth + upload YouTube
scripts/
  local-dev.mjs           # sobe API + Vite juntos
storage/                  # JSON criados automaticamente, ignorados pelo git
  groups.json             # grupos + contas
  youtube.json            # tokens OAuth dos canais
docs/
  ARQUITETURA.md          # como o sistema funciona
  YOUTUBE.md              # guia da integracao YouTube
```

Detalhes em **[docs/ARQUITETURA.md](docs/ARQUITETURA.md)**.

## Scripts

```bash
npm run local    # app + API local
npm run dev      # somente frontend
npm run api      # somente API
npm run build    # validacao de TypeScript e build de producao
npm run start    # servir API e build pronto
npm run format   # formatar arquivos
```
