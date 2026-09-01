# IA.md

Resumo operacional para humanos e IAs que forem trabalhar no projeto.

## O que é

`Contas_exe` é um cofre de credenciais para equipes. O sistema gerencia contas
de redes sociais em grupos, com login por usuário, permissões por papel,
auditoria, 2FA e proteção de segredos.

## Padrão arquitetural do projeto

- monólito modular
- frontend React forte
- backend Node pragmático
- PostgreSQL como persistência principal
- fallback legado para JSON
- segurança tratada como arquitetura

## O que importa antes de mudar código

- autenticação e autorização são server-side
- ações críticas pedem reautenticação
- segredos não devem aparecer em logs, fixtures ou screenshots
- `storage/` é legado/local e não deve ser commitado
- para novos fluxos persistentes, prefira o caminho PostgreSQL

## Áreas principais

- `src/components/account-vault.tsx`: tela principal do cofre
- `src/admin/*`: painel administrativo
- `server/index.mjs`: roteamento e composição dos fluxos
- `server/users-pg.mjs`: usuários, papéis, auth, 2FA
- `server/sessions.mjs`: sessões
- `server/audit.mjs`: auditoria
- `server/crypto.mjs`: criptografia em repouso
- `server/schema.sql`: referência do schema

## Regras de segurança

- nunca commitar `.env`, backups, `storage/*` ou credenciais reais
- `CONTAS_FLOW_ENC_KEY` é crítica
- exportações e backups devem ser tratados como segredo
- repositório público exige cuidado com qualquer dado operacional

## Scripts úteis

```bash
npm run local
npm run typecheck
npm run test
npm run build
npm run scan:secrets
```

## Documentos que explicam o resto

- [README.md](README.md)

- [docs/ARQUITETURA.md](docs/ARQUITETURA.md)
- [docs/DEPLOY.md](docs/DEPLOY.md)
- [docs/SYSTEM-DESIGN-BASE.md](docs/SYSTEM-DESIGN-BASE.md)
- [SECURITY.md](SECURITY.md)

## Registro de execução — 01/09/2026

### Persistência compartilhada

Auditoria do fluxo de persistência encontrou que PostgreSQL já existia para
parte do domínio, mas o fallback JSON era silencioso e as rotas de grupos/contas
gravavam snapshots completos. Em duas instâncias, leituras concorrentes podiam
perder a última gravação. A decisão foi manter PostgreSQL como fonte de verdade
em produção/multi-instância e deixar JSON apenas como fallback local explícito.

Implementado:

- `server/db.mjs`: detecção correta de banco configurado, opt-in do fallback e
  falha fechada em produção/`CONTAS_FLOW_REQUIRE_DATABASE=true`.
- `server/index.mjs`: mutações PostgreSQL granulares para grupos e contas, com
  transações, `FOR UPDATE` na linha do grupo e advisory lock do grupo padrão.
- `server/password-reset.mjs`: exclusão + criação do token sob advisory lock
  transacional.
- `server/login-notify.mjs`: IPs conhecidos migrados para PostgreSQL como hash,
  com retenção limitada e lock por usuário para não disparar alertas duplicados
  em duas instâncias.
- `server/migrate-json-to-pg.mjs` e `server/schema.sql`: migração idempotente
  para cofres, auditoria e histórico do YouTube, com UUIDs determinísticos,
  chaves de origem e rollback global; JSONs de origem são preservados.
- `tests/persistence-config.test.mjs` e
  `tests/persistence-concurrency.test.mjs`: regressão do fail-closed e teste
  de duas instâncias (opt-in com `CONTAS_FLOW_TEST_DATABASE_URL`).
- `docs/PERSISTENCIA-POSTGRES.md`: rollout expand/migrate/contract, rollback e
  procedimento de validação.

Validação observada: `npm test` passou com 41 testes, 1 teste de PostgreSQL
explicitamente pulado por não haver banco de teste configurado; `npm run
scan:secrets`, build, sintaxe Node e Prettier dos arquivos alterados passaram.
O gate global de Prettier ainda reprova dois arquivos preexistentes e o
PostgreSQL temporário não pôde ser iniciado porque o Docker Desktop está
indisponível nesta máquina. A integração de duas instâncias permanece pendente
de execução com PostgreSQL real.
