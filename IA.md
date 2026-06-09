# IA — Contexto Operacional

Resumo rápido para quem (humano ou IA) for trabalhar no projeto. Para detalhes,
ver `README.md`, `docs/ARQUITETURA.md` e `docs/DEPLOY.md`.

## Projeto

**Contas_exe** — cofre de contas/senhas de redes sociais para uma **equipe**,
organizado em **grupos**. Era um organizador local pessoal; evoluiu para um app
multiusuário com login por pessoa, criptografia em repouso e deploy no Railway.

## O que mudou em relação à versão antiga

- **Multiusuário:** cada pessoa tem login próprio (`users.json`, hashes scrypt),
  com papéis admin/member. Não existe mais o login único `Vitissouls`.
- **Ownership:** cada grupo tem dono; membro vê só os seus, admin vê todos.
- **Criptografia em repouso (AES-256-GCM):** senha, recovery, telefone e notas
  das contas (e os refresh tokens do YouTube) são cifrados no disco com
  `CONTAS_FLOW_ENC_KEY`. O backup manual JSON ainda existe, em texto plano.
- **Persistência:** `storage/groups.json` (não mais `accounts.json` plano) +
  `storage/users.json`. O `localStorage` é só cache (namespaceado por usuário).
- **Endurecimento:** sessão server-side, rate limit no login, headers de
  segurança, CORS fechado.

## Decisões técnicas

- Frontend React 18 + TypeScript (Vite 6, Tailwind CSS 3, Lucide).
- API Node HTTP nativa (sem framework); serve `/api/*` e o build estático.
- 3 temas: Andre (vermelho), Dark (ciano), White (azul).
- Estado inicial vazio (nunca credenciais reais no código).
- YouTube (OAuth/upload) está **em pausa**; o endpoint de upload está desativado.

## Regras de segurança

- Nunca commitar `storage/`, `.env`, prints ou backups com dados reais.
- `CONTAS_FLOW_ENC_KEY` é a única forma de decifrar — guardar em cofre, separada
  do volume. Perdê-la = dados cifrados irrecuperáveis.
- O backup JSON exportado contém senhas em texto plano: tratar como segredo.

## Verificações

- `npm run build` (type-check + build de produção).
