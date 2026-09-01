# Persistência compartilhada e migração

## Decisão

Produção e qualquer implantação com mais de uma instância usam PostgreSQL como
fonte de verdade. JSON fica restrito ao modo legado/local de uma única instância
e exige `CONTAS_FLOW_ALLOW_JSON_FALLBACK=true`. Com
`NODE_ENV=production` ou `CONTAS_FLOW_REQUIRE_DATABASE=true`, a aplicação falha
fechado se não conseguir conectar ao banco; isso evita split-brain silencioso.

As rotas de grupos e contas não gravam mais snapshots no PostgreSQL. Cada
mutação usa uma transação e escopo pelo proprietário. Operações sobre contas do
mesmo grupo bloqueiam a linha do grupo com `FOR UPDATE`, preservando alterações
concorrentes de instâncias diferentes. A criação automática do primeiro grupo
usa advisory lock transacional.

IPs conhecidos para alerta de novo login também ficam no PostgreSQL, como hash,
com retenção dos 20 mais recentes e advisory lock por usuário.

## Migração expand/migrate/contract

1. Faça backup do volume JSON e valide que ele pode ser lido/restaurado. Não
   remova nem altere os arquivos de origem durante a migração.
2. Crie o schema PostgreSQL com `server/schema.sql`. O boot também reaplica o
   schema de forma idempotente quando conecta.
3. Configure `DATABASE_URL` e `CONTAS_FLOW_ENC_KEY` com a mesma chave usada nos
   JSON cifrados.
4. Se houver grupo/registro sem proprietário no legado, defina
   `CONTAS_FLOW_MIGRATION_OWNER_ID` com o ID ou username de um usuário existente;
   sem isso o registro é ignorado para evitar atribuição silenciosa ao usuário
   errado. Execute `node server/migrate-json-to-pg.mjs`. O comando lê `users.json`,
   `groups.json`, `vaults/*.json`, `sessions.json`, `audit.json`,
   `youtube.json`, `youtube-history.json` e `login-ips/*.json`. IDs legados não-UUID recebem UUIDs
   determinísticos; códigos de recuperação já usados não são reativados; auditoria
   e histórico recebem chaves de origem únicas.
5. Reexecute o comando e compare os totais. A segunda execução deve importar
   zero novos registros e não duplicar dados.
6. Suba a aplicação com `CONTAS_FLOW_REQUIRE_DATABASE=true`. Verifique login,
   isolamento por usuário, criação/edição/exclusão de grupo e conta, sessões,
   auditoria e histórico do YouTube antes de aumentar o número de instâncias.

## Rollback

Antes do cutover, o JSON original permanece intacto e pode ser usado em uma
instância única com `CONTAS_FLOW_ALLOW_JSON_FALLBACK=true`. Depois do cutover,
rollback de dados deve usar o backup/snapshot do PostgreSQL; não existe
conversão automática de PostgreSQL para JSON. Se a migração falhar, o
`ROLLBACK` da transação global deixa o banco sem os registros daquela execução,
e os JSONs continuam disponíveis para nova tentativa.

Não faça _dual write_ entre JSON e PostgreSQL: isso mascara falhas e cria duas
fontes de verdade. A fase _contract_ — remoção definitiva dos módulos JSON —
fica deliberadamente posterior à observação do deploy e à confirmação do
backup/restore do PostgreSQL.

## Validação de concorrência

Com PostgreSQL de teste configurado em `CONTAS_FLOW_TEST_DATABASE_URL`, rode:

```bash
$env:CONTAS_FLOW_TEST_DATABASE_URL = "postgresql://..."
npm test
```

O teste `tests/persistence-concurrency.test.mjs` inicia duas instâncias,
grava 12 contas concorrentemente no mesmo grupo e confirma que todas chegam à
leitura posterior. Sem essa variável, o teste é pulado para que a suíte local
não toque em um banco real por acidente.
