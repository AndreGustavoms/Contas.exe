# Arquitetura do Contas_exe

Documento técnico de referência do sistema. A meta aqui é explicar o desenho
atual de forma coerente com o código, não preservar versões antigas da
arquitetura.

## Resumo

O `Contas_exe` é um monólito modular:

- frontend SPA em React
- backend HTTP em Node
- autenticação e autorização no servidor
- PostgreSQL como persistência principal
- fallback legado para JSON apenas para compatibilidade/migração

```text
Navegador
  -> /api/*
Servidor Node
  -> auth
  -> sessions
  -> permissions
  -> audit
  -> integrations
  -> PostgreSQL
     fallback: storage/*.json legado
```

## Objetivos de arquitetura

- Entregar frontend e API no mesmo deploy
- Manter segurança forte para segredos e acessos
- Garantir isolamento entre usuários e grupos
- Permitir operação simples em ambiente pequeno/médio
- Suportar evolução sem quebrar bases legadas

## Componentes principais

### Frontend

Principais áreas em `src/`:

- `App.tsx`: gate principal do app autenticado
- `admin/AdminApp.tsx`: painel administrativo isolado
- `components/account-vault.tsx`: tela principal do cofre
- `components/users-dialog.tsx`: gestão de usuários/equipe
- `components/account-settings.tsx`: configurações da conta
- `components/global-search.tsx`: busca global
- `components/social-poster.tsx`: fluxos ligados a publicação
- `components/ui/*`: primitives reutilizáveis
- `locales/*.json`: i18n

### Backend

Principais módulos em `server/`:

- `index.mjs`: entrypoint HTTP e roteamento
- `db.mjs`: conexão PostgreSQL e fallback controlado
- `users-pg.mjs`: usuários, login, papéis, 2FA, OAuth links
- `sessions.mjs`: sessões server-side revogáveis
- `audit.mjs`: trilha de auditoria
- `crypto.mjs`: criptografia em repouso
- `rate-limit.mjs`: proteção anti abuso
- `password-reset.mjs`: recuperação de senha
- `youtube.mjs`: integração de canais/upload
- `server-logs.mjs`: logs recentes do servidor

## Persistência

### Padrão atual

A persistência principal é PostgreSQL.

O módulo [server/db.mjs](../server/db.mjs) tenta conectar no startup. Se
`DATABASE_URL` não existir ou a conexão falhar, o servidor pode operar em modo
legado com JSON para não quebrar ambientes antigos.

### Modo PostgreSQL

Schema principal em [server/schema.sql](../server/schema.sql).

Entidades principais:

- `users`
- `groups`
- `accounts`
- `sessions`
- `audit_events`
- `password_reset_tokens`
- `youtube_channels`
- `youtube_uploads`

Características:

- integridade relacional
- índices para busca e filtros
- concorrência segura
- sessões e auditoria persistentes
- suporte melhor a multi-instância

### Modo legado JSON

Arquivos em `storage/`:

- `groups.json`
- `users.json`
- `sessions.json`
- `audit.json`
- `youtube.json`

Esse modo existe para:

- compatibilidade com instalações antigas
- desenvolvimento local sem banco, quando necessário
- migração gradual para PostgreSQL

Não deve ser o default para novos ambientes de produção.

## Modelo de acesso

Papéis:

- `superadmin`
- `admin`
- `member`

Regras:

- `member` vê apenas grupos próprios
- `admin` e `superadmin` têm visão ampliada conforme a política da rota
- recursos fora do escopo respondem `404` para não revelar existência

O servidor é a fonte da verdade para autorização. O frontend só reflete esse
estado; ele não protege dado por conta própria.

## Sessão e autenticação

O modelo adotado é sessão server-side com cookie opaco:

- cookie `HttpOnly`
- `SameSite=Strict`
- `Secure` em HTTPS
- expiração absoluta e por inatividade
- revogação explícita

Fluxos suportados:

- login por usuário/senha
- login com 2FA TOTP
- reautenticação para ações críticas
- login social com Google e GitHub
- reset de senha

## Segurança

### Senhas

- hash com `scrypt`
- comparação segura
- usuário inexistente protegido com custo equivalente de verificação

### Dados sensíveis

Segredos de contas e integrações são protegidos com `AES-256-GCM` em repouso.

Exemplos:

- senha de conta
- email de recuperação
- telefone
- notas
- tokens OAuth
- metadados sensíveis de sessão

### Controles

- rate limit para login e reauth
- auditoria de ações críticas
- limite de payload
- cabeçalhos HTTP de segurança
- política de proxy confiável
- limpeza/expiração de sessão

## API

A API é implementada diretamente no Node HTTP nativo.

Características:

- handlers explícitos
- rotas por `URL` + regex
- helpers de autenticação/autorização
- responses JSON padronizadas

Famílias de rota:

- `/api/auth/*`
- `/api/account/*`
- `/api/users/*`
- `/api/sessions/*`
- `/api/groups/*`
- `/api/admin/*`
- `/api/audit`
- `/api/youtube/*`
- `/api/health`

## Frontend e estado

Princípios do cliente:

- segredos não ficam persistidos no browser
- dados sensíveis são buscados sob demanda
- o grupo ativo pode ir para `localStorage`, porque não é segredo
- senha real não vem na listagem padrão

Isso reduz vazamento local e mantém a API como fonte de verdade.

## Integrações externas

### Google e GitHub

Usadas para login/vínculo de conta.

### YouTube

Há suporte estrutural para:

- conectar canal
- listar canais
- staging de upload
- upload resumable
- histórico de upload

Parte do fluxo depende de configuração OAuth e operação controlada.

## Operação

Características operacionais importantes:

- um único serviço Node em produção
- Docker multi-stage
- healthcheck em `/api/health`
- secret scan antes de build
- documentação de deploy e segurança no repositório

## Testes e qualidade

A base já cobre áreas de maior risco:

- isolamento entre usuários
- sessões
- rate limit
- usuários
- integração YouTube

O foco correto para esse produto é testar comportamento de risco e segurança,
não apenas cobertura superficial.

## Evolução recomendada

Para novos ciclos do projeto:

- tratar PostgreSQL como padrão obrigatório em produção
- formalizar ainda mais a camada de policy/autorização
- padronizar contratos de erro e validação
- separar melhor logs técnicos de auditoria
- evoluir migrações de schema como rotina operacional
