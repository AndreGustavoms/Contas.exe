# 🔒 Segurança e proteção de dados sensíveis

> **Este repositório é PÚBLICO.** Tudo que for commitado fica visível para
> qualquer pessoa — inclusive no histórico do git, mesmo depois de "apagado".
> Antes de cada commit, garanta que **nenhum dado sensível** está sendo versionado.

---

## O que nunca pode ir para o repositório

- **Senhas, PINs e credenciais** de qualquer conta (login do app, redes sociais, e-mail).
- **Chaves de API e segredos** (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, tokens OAuth, etc.).
- **Arquivos de credenciais do Google** (`client_secret*.json`, `credentials*.json`, `service-account*.json`).
- **Dados reais de contas**: e-mails, usuários, telefones, e-mails de recuperação.
- **Backups exportados pelo app** (contêm senhas em texto plano).
- **Conteúdo de `storage/`** (`groups.json`, `accounts.json`, `youtube.json`).
- **Chaves privadas** (`*.pem`, `*.key`, `*.p12`).

---

## Onde esses dados devem ficar

| Tipo de dado                    | Onde guardar                                   | No git?                   |
| ------------------------------- | ---------------------------------------------- | ------------------------- |
| Login local do app              | `.env` → `APP_AUTH_USER` / `APP_AUTH_PASSWORD` | ❌ ignorado               |
| Credenciais do YouTube/OAuth    | `.env` → `YOUTUBE_*`                           | ❌ ignorado               |
| Chave de criptografia           | `.env` → `CONTAS_FLOW_ENC_KEY`                 | ❌ ignorado               |
| Contas, senhas, grupos          | `storage/*.json` (criados em runtime)          | ❌ ignorado               |
| Backups exportados              | `*.backup.json`, `contas_exe-backup-*.json`    | ❌ ignorado               |
| Estrutura/exemplo (sem valores) | `.env.example`                                 | ✅ versionado (em branco) |

Todas as regras acima estão refletidas no [`.gitignore`](.gitignore).

---

## Como configurar localmente (sem vazar nada)

1. Copie o modelo: `cp .env.example .env`
2. Preencha o `.env` com os **valores reais** (o `.env` é ignorado pelo git).
3. Nunca coloque valores reais no `.env.example` — ele é público.

---

## Checklist antes de cada commit

```bash
# 1. Veja exatamente o que será commitado
git status
git diff --staged

# 2. Garanta que arquivos sensíveis estão ignorados
git check-ignore .env storage/groups.json

# 3. Procure segredos no que está rastreado
git grep -nIE "(senha|password|secret|token|AIza|GOCSPX-|ya29\.|-----BEGIN)" -- $(git ls-files)
```

Se aparecer qualquer credencial real no resultado, **não commite** — mova o
valor para o `.env`.

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
2. Remova o segredo do código e mova para o `.env`.
3. Reescreva o histórico para apagá-lo dos commits antigos (`git filter-repo`),
   expire o reflog (`git reflog expire --expire=now --all`), rode
   `git gc --prune=now` e faça `git push --force`.
4. Avise quem tiver clonado o repositório para refazer o clone.

---

## E-mail do autor nos commits

O e-mail configurado no git aparece **publicamente** em cada commit. Para não
expor o e-mail pessoal, este repositório usa o **e-mail privado do GitHub**:

```bash
git config user.name  "AndreGustavoms"
git config user.email "133678902+AndreGustavoms@users.noreply.github.com"
```

Ative também, em **GitHub → Settings → Emails → "Keep my email addresses private"**
e **"Block command line pushes that expose my email"**, para o GitHub recusar
pushes que vazariam o e-mail real.

---

## Auditoria de histórico (2026-06-03)

Foi feita uma revisão de **100% dos commits e blobs** (12 commits, 137 objetos,
todas as refs e versões deletadas). Resultado:

- ✅ Nenhuma chave de API, token OAuth ou chave privada em commit algum.
- ✅ A senha de login que estava hardcoded foi removida de todo o histórico
  (agora vem do `.env`).
- ✅ O e-mail pessoal do autor foi removido de todos os commits do histórico
  (substituído pelo e-mail privado do GitHub `...@users.noreply.github.com`).
- ✅ `initialAccounts` vazio em todas as versões; `.env.example` sempre em branco.
- ✅ `.env`, `storage/*.json`, `seed-accounts.mjs`, `client_secret*.json` e backups
  **nunca** existiram no histórico.
- ✅ Nenhum telefone, CPF ou cartão; URLs/números encontrados eram placeholders
  de UI, coordenadas de ícones SVG e exemplos de documentação.

### Como reauditar

```bash
# Segredos em todos os blobs de todos os commits
for c in $(git rev-list --all); do
  git ls-tree -r --name-only "$c" | while read f; do
    git show "$c:$f" 2>/dev/null | grep -nIaE \
      "(AIza[0-9A-Za-z_-]{15,}|ya29\.|GOCSPX-|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)" \
      && echo "  ^ em $f @ ${c:0:7}"
  done
done

# E-mails reais de autor no histórico
git log --all --format="%ae %ce" | sort -u
```
