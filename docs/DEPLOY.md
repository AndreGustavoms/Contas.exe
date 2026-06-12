# 🚀 Deploy (Railway) — app multiusuário

Guia para subir o Contas*exe em produção no **Railway**, já no modelo de
**equipe** (logins individuais + criptografia em repouso). O repositório é
**público**, então **nenhum segredo vai no código** — tudo via \_Variables* do Railway.

> **Resumo da arquitetura em prod:** 1 serviço Node. O `server/index.mjs` serve
> a API `/api/*` **e** o front buildado (`dist/`). O front usa fetch relativo,
> então não há URL de API para configurar. Build: Dockerfile multi-stage
> (`npm run build`); start: `node server/index.mjs`; healthcheck: `/api/health`.

---

## 1. Variables (Railway → Settings → Variables)

| Variável                      | Valor                                          | Obrigatória?                                    |
| ----------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| `APP_AUTH_USER`               | usuário do **admin inicial**                   | sim (no 1º deploy)                              |
| `APP_AUTH_PASSWORD`           | senha forte do admin inicial                   | sim (no 1º deploy)                              |
| `CONTAS_FLOW_ENC_KEY`         | chave de 32 bytes (64 hex) — ver passo 2       | **sim em prod**                                 |
| `CONTAS_FLOW_STORAGE_DIR`     | `/data`                                        | sim (senão os dados somem)                      |
| `CONTAS_FLOW_TRUSTED_PROXIES` | `1`                                            | **sim no Railway** (1 proxy na frente)          |
| `CONTAS_FLOW_ALLOWED_ORIGIN`  | em branco                                      | não (só se a API for consumida de outra origem) |
| `GOOGLE_AUTH_CLIENT_ID`       | Client ID OAuth do Google                      | se usar login Google                            |
| `GOOGLE_AUTH_CLIENT_SECRET`   | Client Secret OAuth do Google                  | se usar login Google                            |
| `GOOGLE_AUTH_REDIRECT_URI`    | `https://SEU-DOMINIO/api/auth/google/callback` | recomendado em prod                             |
| `GOOGLE_AUTH_ALLOWED_DOMAIN`  | domínio permitido, ex. `vitissouls.com`        | opcional                                        |

**Notas importantes:**

- `APP_AUTH_USER` / `APP_AUTH_PASSWORD` só semeiam o admin inicial quando
  `users.json` ainda não existe. Depois disso, mudá-las **não afeta** usuários
  já criados. Os colegas são criados **pela UI** (painel **Equipe**, só admin).
- **Não** setar `PORT` / `HOST`: o servidor vai para `0.0.0.0` sozinho quando o
  Railway injeta `PORT`. O cookie de sessão vira `Secure` automaticamente em
  produção.
- `CONTAS_FLOW_TRUSTED_PROXIES=1` é obrigatório no Railway: sem isso, o rate
  limit do login usa o IP do socket (o do proxy do Railway, igual para todos) e
  um atacante poderia forjar `X-Forwarded-For`. Com `1`, o app pega o IP real
  que o proxy observou. Em uso local, deixe em branco.
- Para o login Google, cadastre no Google Cloud o redirect URI exatamente igual
  ao valor de `GOOGLE_AUTH_REDIRECT_URI`. O callback do app é
  `/api/auth/google/callback`. Se o e-mail Google verificado ainda não existir,
  o app cria automaticamente um usuário `member`. Se o e-mail já existir sem
  vínculo Google, o login é bloqueado para evitar conflito; use usuário/senha.
  Admins continuam sendo promovidos pela tela **Equipe**.
- `YOUTUBE_*` só quando for ativar OAuth em prod (integração em pausa).

---

## 2. Gerar a chave de criptografia (`CONTAS_FLOW_ENC_KEY`)

Cifra em repouso (AES-256-GCM) os campos sensíveis das contas (senha, email de
recuperação, telefone, notas) e os refresh tokens do YouTube.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Cole o valor em `CONTAS_FLOW_ENC_KEY` no Railway.

> ⚠️ **A chave é a única forma de decifrar os dados.** Se você perdê-la, os
> campos cifrados ficam **irrecuperáveis**. Guarde-a em um gerenciador de senhas
> ou cofre, **separada** do volume de dados. Defina-a **uma vez** e não troque
> (trocar depois de ter dados cifrados exige re-migração, não implementada).

---

## 3. Volume persistente

Railway → **Settings → Volumes → Mount path `/data`** (deve bater com
`CONTAS_FLOW_STORAGE_DIR`). É onde vivem `users.json`, `groups.json` (cifrado),
`sessions.json` e `audit.json`. Sem o volume, os dados somem a cada redeploy.

---

## 4. Domínio

Railway → **Settings → Networking → Generate Domain** (`*.up.railway.app`).
Confira que a porta do domínio aponta para a porta que o app escuta (o Railway
injeta `PORT`; ajuste em _Networking_ se der 502).

---

## 5. Primeiro acesso e criação da equipe

1. Acesse a URL pública e faça login com `APP_AUTH_USER` / `APP_AUTH_PASSWORD`
   (o admin inicial).
2. Abra o painel **Equipe** (ícone na barra lateral, só admin).
3. Crie um login para cada colega (usuário + senha; marque "admin" só para quem
   precisar ver tudo). Cada colega vê **apenas os próprios grupos**; o admin vê todos.

---

## 6. Backup do volume `/data`

Use as duas formas:

- **No app (recomendado, regular):** painel **Equipe → Backup completo → Baixar**.
  Baixa `contas-backup-AAAA-MM-DD.json` com todos os grupos e contas em texto
  plano e a lista de usuários (sem as senhas). Guarde em local seguro.
- **Snapshot do volume (infra):** pelo painel/CLI do Railway, faça snapshot do
  volume `/data` periodicamente. O `groups.json` permanece **cifrado** — só é
  legível com a `CONTAS_FLOW_ENC_KEY`.

> O backup do app contém senhas em texto plano: trate com o mesmo cuidado das
> senhas reais. Não compartilhe nem suba a lugar nenhum.

---

## Checklist de go-live

- [ ] `CONTAS_FLOW_ENC_KEY` gerada e salva em cofre (separada do volume).
- [ ] Variables setadas no Railway (tabela do passo 1).
- [ ] Volume montado em `/data`.
- [ ] Domínio gerado e respondendo (`/api/health` → `{ "ok": true }`).
- [ ] Login do admin funciona; senha do admin é forte.
- [ ] Logins dos colegas criados pela UI.
- [ ] Backup baixado e guardado pelo menos uma vez.
- [ ] Checklist LGPD revisado: controlador/canal, base legal, aviso interno,
      retenção, backup e incidente. Ver [LGPD.md](./LGPD.md).
