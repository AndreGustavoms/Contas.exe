# Auditoria pre-beta do Contas Flow

Data da auditoria: 2026-06-16  
Escopo: codigo local, configuracao, testes automatizados, testes manuais de API com storage temporario, build, audit de dependencias e inspecao UX por codigo/CSS.  
Nao foi feita validacao visual automatizada porque o Browser in-app estava indisponivel (`iab`) e o projeto nao tem Playwright/Puppeteer instalado.

## 1. Resumo brutal

O projeto tem uma base tecnica melhor que um prototipo comum: sessoes server-side, cookies HttpOnly, rate limit de login, criptografia AES-GCM opcional, reauth para acoes sensiveis, auditoria e testes unitarios de partes criticas.

Mas nao esta pronto para beta sem correcoes. O bloqueador principal e grave: existe um superadmin fixo hardcoded em `server/users.mjs`, e o boot atual sobrescreve `users.json` com esse usuario. Isso quebra o fluxo documentado de admin inicial, cria risco operacional e pode apagar usuarios locais/de producao. Alem disso, cadastro publico fica aberto por padrao sem documentacao no `.env.example`, ha vulnerabilidade de dependencia em `vite/esbuild`, i18n esta incompleto em zh, o bundle esta grande, e o sistema usa JSON em disco sem estrategia real para multi-instancia, backup/restore ou corrupcao.

Nota direta: bom trabalho de endurecimento em algumas areas, mas ha decisoes perigosas demais para beta real com usuarios.

## 2. Como o sistema funciona

- Frontend: React 18 + TypeScript + Vite + Tailwind + lucide-react.
- Backend: Node HTTP nativo, sem Express/Nest.
- Banco/ORM: nao ha banco nem ORM. Persistencia em arquivos JSON dentro de `storage/`.
- Dados:
  - `users.json`: usuarios, roles, hashes scrypt, 2FA.
  - `vaults/{userId}.json`: grupos e contas do usuario.
  - `sessions.json`: sessoes server-side.
  - `audit.json`: trilha de auditoria.
  - `youtube.json` e `youtube-history.json`: tokens/historico YouTube.
- Autenticacao: usuario/senha com scrypt; OAuth Google/GitHub; 2FA TOTP opcional; sessoes opacas em cookie `contas_session`.
- Cookie: `HttpOnly`, `SameSite=Strict`, `Secure` quando `PORT` existe ou `CONTAS_FLOW_COOKIE_SECURE=1`.
- OAuth: Google/GitHub login e link de conta usam cookie de state `HttpOnly` + `SameSite=Lax`; YouTube tambem valida state.
- Permissoes: `member`, `admin`, `superadmin`. Admin ve todos os vaults; member ve apenas o proprio; superadmin acessa `/admin`.
- i18n: `react-i18next`, locales `pt/en/es/fr/zh`.
- Deploy: Dockerfile multi-stage para Railway; storage deve ir em volume persistente.

## 3. Validacoes executadas

Comandos executados:

- `npm test`: passou, 28 testes.
- `npm run typecheck`: passou.
- `npm run build`: passou, mas Vite alertou chunk JS grande: `606.48 kB` minificado, `166.22 kB` gzip.
- `npm audit --audit-level=moderate`: falhou com 2 vulnerabilidades high em `esbuild` via `vite`.

Testes manuais de API com storage temporario:

- `/api/groups` sem sessao: `401`.
- `POST /api/auth/register`: `201` com cadastro publico aberto por padrao.
- `POST /api/auth/login`: `200`.
- `GET /api/auth/status`: `200 authenticated=true` quando `CONTAS_FLOW_COOKIE_SECURE=0` em HTTP local.
- `GET /api/groups`: cria grupo padrao `Geral`.
- `POST /api/groups/:id/accounts`: cria conta e mascara `password` na resposta.
- `GET /api/groups/:id/accounts/:accountId/secret` sem reauth: `403 reauth_required`.
- `POST /api/auth/reauth` e novo `GET secret`: retorna senha.
- Com `CONTAS_FLOW_ENC_KEY`, senha foi cifrada no JSON (`enc:v1:`) e nao apareceu em texto claro.
- Campos com `<script>` foram aceitos, persistidos e retornados pela API como texto.

Teste de bootstrap:

- Com storage vazio e `APP_AUTH_USER=seedadmin`, `APP_AUTH_PASSWORD=SeedPass!123`, login do seed retornou `401`.
- `users.json` nasceu contendo apenas `fixed-superadmin-andre`.
- Evidencia: `server/users.mjs:49-56`, `server/users.mjs:502-521`, `server/index.mjs:2778-2783`.

## 4. Mapa de features

### Login local

Arquivos:

- `src/components/local-login.tsx`
- `server/index.mjs`
- `server/users.mjs`
- `server/sessions.mjs`
- `server/rate-limit.mjs`

Fluxo:

1. UI envia `{ name, password }` para `/api/auth/login`.
2. Backend aplica rate limit por IP e usuario.
3. Verifica scrypt.
4. Se 2FA ativo, retorna `twoFactorRequired`.
5. Se OK, cria sessao server-side e cookie HttpOnly.

Status: **Parcial**

Problemas:

- O fluxo funciona, mas o bootstrap de usuario inicial esta quebrado pelo superadmin fixo.
- Em HTTP local direto com `PORT` setado, cookie `Secure` impede persistencia de sessao, salvo override `CONTAS_FLOW_COOKIE_SECURE=0`.

### Cadastro publico

Arquivos:

- `src/components/register.tsx`
- `server/index.mjs:1344-1409`
- `server/users.mjs:694-729`

Fluxo:

1. Qualquer pessoa chama `/api/auth/register`.
2. Cria usuario `member`.
3. Rate limit conta por IP.

Status: **Suspeito**

Problemas:

- Aberto por padrao. Fecha apenas se `CONTAS_FLOW_REGISTRATIONS_OPEN === "false"`.
- Variavel nao esta documentada em `.env.example`.
- Retorna `username_taken` e `email_taken`, permitindo enumeracao por cadastro.
- Em beta privado isso gera spam, custo operacional e superficie de abuso.

### Recuperacao de senha

Arquivos:

- `src/components/forgot-password.tsx`
- `src/components/reset-password.tsx`
- `server/password-reset.mjs`
- `server/email.mjs`
- `server/index.mjs:1297-1459`

Fluxo:

1. Solicita reset por e-mail.
2. Token bruto e enviado por e-mail; hash scrypt fica em `password-reset.json`.
3. Token expira em 15 min e e single-use.
4. Reset revoga sessoes.

Status: **Parcial**

Problemas:

- Sem `RESEND_API_KEY`, `sendEmail()` so loga no stdout e retorna sucesso. Em producao mal configurada, usuario acha que e-mail saiu e nada acontece.
- Falta teste automatizado desse fluxo.
- O HTML do e-mail interpola `account.username` e link sem escape dedicado. Username e validado, mas ainda e melhor usar template seguro.

### OAuth Google/GitHub

Arquivos:

- `server/google-auth.mjs`
- `server/github-auth.mjs`
- `server/index.mjs:889-1085`
- `src/components/local-login.tsx`

Fluxo:

1. Backend gera state aleatorio.
2. State vai em cookie HttpOnly `SameSite=Lax`.
3. Callback valida state e troca code.
4. Cria usuario member ou bloqueia conflito de e-mail.

Status: **Parcial**

Pontos bons:

- State existe e usa `timingSafeEqual`.
- Conflito de e-mail e bloqueado.
- Google verifica e-mail verificado e dominio opcional.

Problemas:

- Nao testado end-to-end sem credenciais OAuth.
- `requestOrigin()` depende de `Host`/`x-forwarded-proto`; se proxy estiver mal configurado, redirect URI pode sair errada.
- Google/GitHub login marca reauth imediatamente apos login OAuth (`markReauth`), aumentando janela para acoes sensiveis sem senha local.

### Sessoes e logout

Arquivos:

- `server/sessions.mjs`
- `server/index.mjs:1462-1485`, `1691-1729`, `2091-2118`
- `src/components/account-settings.tsx`

Fluxo:

1. Cookie contem token opaco.
2. Estado real em `sessions.json`.
3. Idle timeout: 3h; absoluto: 3 dias.
4. Logout revoga sessao server-side.
5. Usuario/admin pode revogar sessoes.

Status: **OK com ressalvas**

Problemas:

- Store em arquivo e lock em memoria: seguro apenas em uma instancia. Multi-instancia perde consistencia.
- Geolocalizacao/IP sao sensiveis; estao cifrados se a chave existir, mas ficam plaintext se `CONTAS_FLOW_ENC_KEY` faltar.

### 2FA TOTP

Arquivos:

- `server/totp.mjs`
- `server/users.mjs`
- `server/index.mjs:1752-1848`
- `src/components/account-settings.tsx`

Fluxo:

1. Setup gera secret pendente e QR.
2. Enable valida TOTP e gera recovery codes.
3. Login exige TOTP ou recovery code.
4. Admin pode resetar 2FA de outro usuario.

Status: **Parcial**

Problemas:

- Recovery codes sao exibidos em claro uma vez, correto, mas fluxo visual nao foi validado.
- Falta teste automatizado completo de setup/enable/login/recovery.
- 2FA secret fica cifrado apenas se `CONTAS_FLOW_ENC_KEY` existir.

### Cofre de grupos/contas

Arquivos:

- `src/components/account-vault.tsx`
- `src/data/credential-records.ts`
- `server/index.mjs:2473-2682`

Fluxo:

1. Member ve/cria grupos no proprio vault.
2. Admin varre todos os vaults.
3. Conta e normalizada e salva.
4. Listagem mascara senha.
5. Segredo exige reauth.

Status: **Parcial**

Problemas:

- Criar conta (`POST /accounts`) nao exige reauth, embora grave senha/PII. Isso e discutivel, mas para cofre de credenciais eu exigiria reauth ou pelo menos confirmacao forte.
- Campos aceitam HTML/script e ficam persistidos/retornados. React escapa, mas export/backups/uso futuro podem virar XSS se alguem usar HTML renderizado.
- Sem limite por campo em `normalizeRecord`; body total e 1 MB, mas usuario pode criar labels/notas enormes e degradar UX/storage.
- Import substitui todas as contas e exige reauth, bom.

### Backup/export/import

Arquivos:

- `src/components/account-vault.tsx:1178-1253`
- `server/index.mjs:1852-1880`

Fluxo:

1. Export de grupo busca segredos um a um com reauth.
2. Backup admin baixa todos os grupos.
3. Import cria grupo novo e importa contas.

Status: **Parcial**

Problemas:

- Backups contem senhas em texto plano por design. Isso precisa de aviso mais agressivo e opcao de backup criptografado.
- Export em lote faz N requests para segredos; com muitos registros vira lento e ruidoso na auditoria.
- Import nao valida schema forte, apenas normaliza.

### Admin e painel superadmin

Arquivos:

- `src/admin/*`
- `server/index.mjs:1852-2240`
- `server/users.mjs`

Fluxo:

1. `admin` gerencia usuarios/sessoes/backup.
2. `superadmin` acessa `/admin`.
3. Rotas sensiveis exigem reauth.

Status: **Quebrado/Suspeito**

Problemas:

- Superadmin fixo hardcoded e boot sobrescrevendo usuarios e o maior risco do projeto.
- Admin reset de senha valida senha forte, bom.
- Criar `member` por admin nao exige reauth; criar `admin` exige.
- Listagem de sessoes admin inclui IP. Justificavel, mas e dado pessoal sensivel.

### Publicador social/YouTube

Arquivos:

- `src/components/social-poster.tsx`
- `src/components/posters/youtube-poster.tsx`
- `server/youtube.mjs`
- `server/index.mjs:2240-2438`

Fluxo:

1. UI abre modulo de postagem.
2. YouTube conecta canal via OAuth.
3. Upload usa staging em disco e API do YouTube.
4. Outras redes aparecem como `comingSoon`.

Status: **Parcial**

Problemas:

- Produto parece prometer redes sociais, mas so YouTube esta ativo.
- `server/youtube.mjs` usa token store global, nao claramente escopado por usuario. Se isso for intencional, admin/member podem acabar vendo canais compartilhados; se nao for, e vazamento funcional.
- Upload de ate 2 GB precisa controle operacional de disco/quota.
- End-to-end com YouTube nao foi testado sem credenciais.

### i18n

Arquivos:

- `src/i18n.ts`
- `src/locales/*.json`

Status: **Parcial**

Problemas:

- `zh.json` contem textos em ingles e caracteres `?` em chaves do admin.
- Documentos/README exibiram mojibake no terminal, indicando risco de encoding/acentos, embora isso possa ser exibicao do PowerShell.
- Textos extensos em botoes/modais precisam teste real em 320/375 px.

## 5. Auditoria de endpoints

### Publicos

- `GET /api/health`: OK.
- `POST /api/auth/login`: OK com rate limit.
- `POST /api/auth/login/totp`: OK por inspecao; falta teste E2E.
- `POST /api/auth/logout`: OK.
- `GET /api/auth/status`: OK.
- `GET /api/auth/providers`: OK.
- `GET /api/auth/google`, `/callback`: parcial, state OK.
- `GET /api/auth/github`, `/callback`: parcial, state OK.
- `POST /api/auth/forgot-password`: parcial, e-mail pode ser no-op silencioso.
- `POST /api/auth/reset-password`: parcial, boa revogacao de sessoes.
- `POST /api/auth/register`: suspeito, aberto por padrao.
- `GET /api/youtube/callback`: publico por necessidade OAuth, state OK.

### Protegidos

- `/api/account/*`: em geral OK, mas perfil/avatar aceita data URL ate 750 KB; pode pesar storage.
- `/api/users*`: admin only, com varias acoes reauth. Bom, mas afetado por superadmin fixo.
- `/api/sessions*`: admin only; delete de sessao especifica nao exige reauth.
- `/api/audit`: admin only; bom.
- `/api/admin-panel/*`: superadmin + reauth; bom, exceto superadmin fixo.
- `/api/youtube/*`: autenticado, mas escopo por usuario precisa revisao.
- `/api/groups*`: permissao por vault; bom por inspecao, mas sem testes automatizados de ID de outro usuario.

## 6. Seguranca

Critico:

- `FIXED_SUPERADMIN` hardcoded com hash de senha em `server/users.mjs:49-56`.
- `ensureFixedSuperadmin()` grava `[owner]` e remove qualquer outro usuario do store em `server/users.mjs:502-521`.
- O boot chama isso antes do seed admin em `server/index.mjs:2778-2783`; portanto `APP_AUTH_USER`/`APP_AUTH_PASSWORD` nao funcionam em storage vazio.

Alto:

- Cadastro publico aberto por padrao e nao documentado.
- `npm audit` acusa vulnerabilidade high em `esbuild` via `vite`.
- Sem `CONTAS_FLOW_ENC_KEY`, vault, tokens e metadados sensiveis ficam plaintext. Isso e documentado, mas em producao deveria falhar fechado, nao apenas alertar.
- File JSON + lock in-process nao suporta multi-instancia nem escrita concorrente entre processos.
- Falta CSRF token tradicional. `SameSite=Strict` reduz bastante para sessoes, mas se algum dia CORS/embeds/domains mudarem, fica fragil.

Medio:

- Campos HTML/script sao persistidos. React escapa hoje, mas export/import/admin/HTML futuro podem transformar isso em XSS armazenado.
- Rate limit e em memoria; restart zera.
- `CONTAS_FLOW_TRUSTED_PROXIES` errado quebra IP real e rate limit.
- `sendEmail()` em modo dev retorna sucesso sem enviar.
- Backups plaintext sao risco alto de vazamento.

Pontos bons:

- Cookie HttpOnly/SameSite.
- Sessoes revogaveis server-side.
- Reauth em reveal, delete, backup e alteracao de senha.
- Senha de login com scrypt.
- OAuth state implementado.
- Password reset revoga sessoes.
- CSP, HSTS condicionado, nosniff e X-Frame-Options.

## 7. UX/UI

Problemas provaveis para beta:

- O app tem muita densidade visual: glass, sombras, bordas, glow, grid, neon e varios estilos competindo. Para cofre de credenciais, usuarios querem confianca, clareza e velocidade; a UI parece mais "painel visual" que ferramenta operacional.
- Modais usam `rounded-[28px]`; isso destoa de uma UI operacional e pode parecer pesado.
- O publicador mostra Instagram/TikTok/Facebook/Kwai como indisponiveis; usuario beta pode reclamar de promessa nao cumprida.
- `SocialPoster` usa sidebar fixa `w-52` e painel dentro de `min-h-[calc(100dvh-150px)]`; sem teste visual, isso e suspeito em 320 px.
- Muitas areas usam scroll horizontal como mitigacao. Funciona tecnicamente, mas em mobile vira atrito.
- Admin/i18n em zh esta incompleto; isso quebra a promessa de 5 idiomas.

Pontos bons:

- Existem estados vazios, spinners, toasts e reauth modal.
- Layout tem varias regras `100dvh`, `overflow-y-auto`, `overflow-wrap:anywhere`.
- A listagem mascara senha e reveal auto-oculta em 15s.

## 8. Performance/SRE

Problemas:

- Bundle JS unico: `606.48 kB` minificado. Falta code splitting por admin, poster YouTube, i18n e telas auth.
- CSS grande e muito global (`src/index.css` com milhares de linhas). Risco de regressao visual e dificuldade de manutencao.
- Admin lista/varre todos os vaults em JSON; escala mal com muitos usuarios/grupos.
- Export de segredos faz N requests.
- Upload YouTube aceita ate 2 GB em disco local; precisa quota, limpeza e monitoramento.
- Logs operacionais sao volateis em memoria (`server-logs.mjs`), insuficiente para producao.
- Deploy em Railway com volume unico e Node single instance. Se escalar replicas, dados quebram.

Pontos bons:

- Build passa.
- Tests passam.
- Body JSON limitado a 1 MB.
- Upload grande e streamado para arquivo, nao bufferizado inteiro.

## 9. Casos extremos

Testados:

- Sessao ausente em endpoint protegido: 401.
- Login/cookie local com Secure em HTTP: sessao nao persiste.
- Cadastro com `<script>` em nome: aceito e retornado.
- Conta com `<script>` em campos: aceito e retornado.
- Reveal sem reauth: 403.
- Reveal apos reauth: 200.
- Criptografia com chave: senha cifrada no storage.

Nao testados por limitacao de ambiente/credenciais:

- OAuth real Google/GitHub.
- OAuth/upload real YouTube.
- UI visual em 320/375/768/ultrawide.
- Multiplos dispositivos reais.
- Corrida entre duas instancias Node.
- Recuperacao de senha com e-mail real.
- 2FA setup/login real via UI.

## 10. O que falta para beta

### Critico

- Remover superadmin fixo e `ensureFixedSuperadmin()` destrutivo.
  - Impacto: bloqueia login inicial, pode apagar usuarios.
  - Dificuldade: media.
  - Recomendacao: voltar para seed admin por env e promocao superadmin por env sem hardcode.

- Fechar cadastro publico por padrao.
  - Impacto: evita spam e usuarios desconhecidos.
  - Dificuldade: baixa.
  - Recomendacao: `CONTAS_FLOW_REGISTRATIONS_OPEN=false` default, ou invite/token.

- Atualizar Vite/esbuild.
  - Impacto: vulnerabilidade high.
  - Dificuldade: baixa/media.
  - Recomendacao: `npm audit fix`, testar build.

- Exigir `CONTAS_FLOW_ENC_KEY` em producao.
  - Impacto: senhas/tokens plaintext se esquecer env.
  - Dificuldade: baixa.
  - Recomendacao: se `NODE_ENV=production` e sem chave, falhar startup.

### Alta

- Testes E2E de auth, reauth, CRUD, permissao cross-user, reset e 2FA.
- Escopo por usuario para canais/tokens YouTube, ou documentar explicitamente que canais sao globais.
- Validacao de schema/campos para contas e import.
- Backup criptografado ou warning muito mais agressivo.
- Corrigir i18n zh/admin e auditar todos os idiomas.
- Code splitting de admin/poster/auth.

### Media

- Sanitizacao/normalizacao de campos textuais e limites por campo.
- Melhorar observabilidade: logs persistentes, ids de request, metricas basicas.
- Teste visual responsivo automatizado.
- Melhorar UX mobile dos modais e publicador.
- Documentar `CONTAS_FLOW_REGISTRATIONS_OPEN`.

### Nice to have

- Convites por e-mail.
- Politica de retencao de audit/logs configuravel.
- Export com senha/criptografia local.
- Rotacao de chave de criptografia.
- Import preview/diff antes de substituir dados.

## 11. Ranking final

### Bugs criticos

1. Superadmin fixo hardcoded e boot destrutivo de usuarios.
2. Admin inicial por `APP_AUTH_USER`/`APP_AUTH_PASSWORD` nao funciona em storage vazio.
3. Cadastro publico aberto por default sem documentacao.
4. Dependencia vulneravel high (`vite/esbuild`).

### Bugs importantes

1. Sessao local quebra em HTTP quando `PORT` seta cookie `Secure`.
2. `sendEmail()` pode simular sucesso sem enviar e-mail.
3. Tokens/canais YouTube parecem globais, nao por usuario.
4. Campos HTML/script persistidos sem sanitizacao.
5. i18n zh/admin incompleto.

### Melhorias

1. Code splitting.
2. E2E de fluxos sensiveis.
3. Backup criptografado.
4. Schema validation centralizada.
5. Observabilidade real.

### Funcionalidades faltantes

1. Convites/controle de cadastro beta.
2. Fluxo confiavel de onboarding admin sem hardcode.
3. Teste visual mobile.
4. Rotacao de chave.
5. Politica de retencao LGPD aplicada por codigo/config, nao apenas docs.

## 12. Notas

- Seguranca: **4/10**. Ha boas primitives, mas o superadmin hardcoded, cadastro aberto e dependencia high derrubam a nota.
- UX: **6/10**. Rica e responsiva por intencao, mas pesada, incompleta em idiomas e sem validacao visual automatizada.
- Performance: **5/10**. Build passa, mas bundle unico grande, JSON scan e CSS global pesam.
- Arquitetura: **5/10**. Simples e pragmatica para single instance, fraca para crescimento, concorrencia e recuperacao.
- Pronto para beta: **3/10**. Pode ser testado internamente por devs, mas nao deve ir para beta com usuarios reais antes dos criticos.

## 13. Estado do repositorio durante a auditoria

Antes de qualquer edicao minha ja existia alteracao em:

- `src/components/social-poster.tsx`

Durante a auditoria, `git status` tambem mostrou:

- `src/components/account-vault.tsx`

Eu nao reverti nem alterei esses arquivos. Este relatorio foi adicionado como:

- `docs/AUDITORIA_PRE_BETA.md`
