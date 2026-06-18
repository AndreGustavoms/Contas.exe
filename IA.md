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
