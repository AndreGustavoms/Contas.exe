# Segurança e proteção de dados sensíveis

> **Este repositório é PÚBLICO.** Tudo que for commitado fica visível para
> qualquer pessoa — inclusive no histórico do git, mesmo depois de "apagado".
> Antes de cada commit, garanta que NENHUM dado sensível está sendo versionado.

## O que NUNCA pode ir para o repositório

- **Senhas, PINs e credenciais** de qualquer conta (login do app, redes sociais, e-mail).
- **Chaves de API e segredos** (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, tokens OAuth, etc.).
- **Arquivos de credenciais do Google** (`client_secret*.json`, `credentials*.json`, `service-account*.json`).
- **Dados reais de contas**: e-mails, usuários, telefones, e-mails de recuperação.
- **Backups exportados pelo app** (contêm senhas).
- **Conteúdo de `storage/`** (`groups.json`, `accounts.json`, `youtube.json`).
- **Chaves privadas** (`*.pem`, `*.key`, `*.p12`).

## Onde esses dados devem ficar

| Tipo de dado | Onde guardar | Está no git? |
|---|---|---|
| Login local do app | `.env` → `VITE_LOCAL_LOGIN_NAME`, `VITE_LOCAL_LOGIN_PASSWORD` | ❌ ignorado |
| Credenciais do YouTube/OAuth | `.env` → `YOUTUBE_*` | ❌ ignorado |
| Contas, senhas, grupos | `storage/*.json` (criados em runtime) | ❌ ignorado |
| Backups exportados | `*.backup.json`, `contas_exe-backup-*.json` | ❌ ignorado |
| Estrutura/exemplo (sem valores) | `.env.example` | ✅ versionado (em branco) |

Todas as regras acima estão refletidas no [`.gitignore`](.gitignore).

## Como configurar localmente (sem vazar nada)

1. Copie o modelo: `cp .env.example .env`
2. Preencha o `.env` com os **valores reais** (o `.env` é ignorado pelo git).
3. Nunca coloque valores reais no `.env.example` — ele é público.

## Checklist antes de cada commit

```bash
# 1. Veja exatamente o que será commitado
git status
git diff --staged

# 2. Garanta que arquivos sensíveis estão ignorados
git check-ignore .env storage/accounts.json

# 3. Procure segredos no que está rastreado
git grep -nIE "(senha|password|secret|token|AIza|GOCSPX-|ya29\.|-----BEGIN)" -- $(git ls-files)
```

Se aparecer qualquer credencial real no resultado, **não comite** — mova o valor para o `.env`.

## Se um segredo vazar mesmo assim

1. **Considere o segredo comprometido** e **troque/revogue imediatamente**
   (senha do app, client secret do Google, tokens). Reescrever o histórico
   **não** desfaz o vazamento — o dado já pode ter sido visto, clonado ou indexado.
2. Remova o segredo do código e mova para o `.env`.
3. Reescreva o histórico para apagá-lo dos commits antigos (`git filter-branch`
   ou `git filter-repo`), expire o reflog (`git reflog expire --expire=now --all`),
   rode `git gc --prune=now` e faça `git push --force`.
4. Avise quem tiver clonado o repositório para refazer o clone.
