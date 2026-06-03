# Integração YouTube (publicar e agendar vídeos)

Este documento descreve a integração do Contas_exe com a **YouTube Data API
v3** para fazer upload e **agendar** a publicação de vídeos nos canais do
próprio usuário.

> Status: **Fase 0 (backend) implementada.** Falta o usuário criar as
> credenciais no Google Cloud, conectar um canal e validar um upload. A
> interface (UI) ainda **não** foi construída — o uso atual é via rotas HTTP.

---

## Decisões de projeto

| Tema | Decisão |
| --- | --- |
| Onde roda | Local agora (`127.0.0.1`); HTTPS/domínio depois. Migrar = trocar `YOUTUBE_REDIRECT_URI`. |
| Volume | ≤ 5 uploads/dia. Cabe na cota padrão (10.000 unidades/dia; ~1.600 por upload). **Sem pedir aumento à Google.** |
| Canais | Todos do próprio usuário (caso de uso legítimo). |
| Segredos | `Client ID/Secret` no `.env` (git-ignored). Tokens dos canais em `storage/youtube.json` (separado de `groups.json`, git-ignored). |
| Backend | Estende o `server/index.mjs` existente, usando a lib oficial `googleapis`. |

### Cota — leia antes de escalar

Cada `videos.insert` (upload) custa **~1.600 unidades**; a cota padrão é
**10.000/dia por projeto**, somando todos os canais → **~6 uploads/dia**.
Para o volume planejado (≤5/dia) está tranquilo. Aumentar a cota exige revisão
manual da Google e costuma ser negado para "automação de postagem em massa em
múltiplas contas" — então não conte com isso.

---

## Passo a passo no Google Cloud (o que só você faz)

### 1. Projeto + ativar a API
1. Acesse <https://console.cloud.google.com> e crie um projeto (ex.: `Contas_exe`).
2. **APIs e Serviços → Biblioteca** → busque **"YouTube Data API v3"** → **Ativar**.

### 2. Tela de consentimento OAuth
1. **APIs e Serviços → Tela de consentimento OAuth** → tipo **Externo**.
2. Preencha nome do app e e-mail de contato.
3. Em **Usuários de teste**, adicione o(s) e-mail(s) das contas que vão conectar
   (ex.: `info@vitissouls.com`).

> **Modo "Testing":** os refresh tokens expiram a cada **7 dias** e há limite de
> ~100 usuários de teste. Suficiente para a Fase 0. Quando subir para um
> domínio público, publique/verifique o app para tokens duradouros.

### 3. Credenciais (Client ID/Secret)
1. **APIs e Serviços → Credenciais → Criar credenciais → ID do cliente OAuth**.
2. Tipo: **App da Web**.
3. Em **URIs de redirecionamento autorizados**, adicione **exatamente**:
   ```
   http://127.0.0.1:8787/api/youtube/callback
   ```
   (Em produção, adicione também `https://SEU-DOMINIO/api/youtube/callback`.)
4. Salve e **copie** o **Client ID** e o **Client Secret**.

### 4. Preencher o `.env`
Na raiz do projeto:
```bash
cp .env.example .env   # Windows PowerShell: copy .env.example .env
```
Abra o `.env` e preencha:
```
YOUTUBE_CLIENT_ID=...        # do passo 3
YOUTUBE_CLIENT_SECRET=...    # do passo 3
YOUTUBE_REDIRECT_URI=http://127.0.0.1:8787/api/youtube/callback
```

### 5. Conectar um canal
1. `npm run local`
2. Abra no navegador: <http://127.0.0.1:8787/api/youtube/connect>
3. Faça login na conta do canal e autorize. Você volta ao app
   (`/?youtube=connected&channel=...`) e o canal fica salvo em
   `storage/youtube.json`.
4. Confira: <http://127.0.0.1:8787/api/youtube/channels>

---

## Endpoints da API

Todos sob `/api/youtube/*`, servidos por `server/index.mjs` (lógica em
`server/youtube.mjs`).

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/youtube/connect` | Redireciona para a tela de consentimento da Google. |
| GET | `/api/youtube/callback` | Recebe o `?code`, troca por tokens, salva o canal, redireciona ao app. |
| GET | `/api/youtube/channels` | Lista canais conectados (sem segredos): `{ channels: [{ id, title, connectedAt }] }`. |
| POST | `/api/youtube/upload` | Faz upload (com agendamento opcional). Ver abaixo. |

### Upload — `POST /api/youtube/upload`

Corpo (JSON):
```json
{
  "channelId": "UC...",                 // id de /api/youtube/channels
  "filePath": "C:/caminho/do/video.mp4",// caminho LOCAL no servidor
  "title": "Meu vídeo",
  "description": "opcional",
  "tags": ["opcional"],
  "publishAt": "2026-06-10T18:00:00Z"   // opcional, ISO 8601 no futuro (UTC)
}
```

- **Sem `publishAt`** → o vídeo é enviado como **privado**.
- **Com `publishAt`** → enviado como **privado** e o YouTube o torna **público
  automaticamente** na data/hora informada (em UTC; `Z` no fim).

Resposta:
```json
{ "videoId": "...", "title": "...", "publishAt": "...", "privacyStatus": "private" }
```

Exemplo de teste (PowerShell):
```powershell
$body = @{
  channelId = "UC..."
  filePath  = "C:\videos\teste.mp4"
  title     = "Teste agendado"
  publishAt = "2026-06-10T18:00:00Z"
} | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:8787/api/youtube/upload -Method Post -ContentType "application/json" -Body $body
```

---

## Como os tokens são guardados

`storage/youtube.json` (git-ignored):
```json
{
  "channels": [
    { "id": "UC...", "title": "Meu Canal", "refreshToken": "...", "connectedAt": "..." }
  ]
}
```
Mantemos apenas o **refresh token** (longo prazo); o access token é curto e a
`googleapis` o renova sob demanda. **Nunca** commite este arquivo nem o `.env`.

---

## Próximos passos (não implementados)

1. **UI (Fase 2):** botão "Conectar YouTube", enviar/agendar vídeo, biblioteca,
   edição de metadados, miniatura, histórico.
2. **Vincular canal ↔ grupo:** associar cada canal do YouTube a um grupo do
   cofre (ver `docs/ARQUITETURA.md`).
3. **Produção:** HTTPS/domínio, publicar o app OAuth, e considerar criptografar
   tokens em repouso.
