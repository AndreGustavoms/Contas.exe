# ⚖️ LGPD — controles operacionais

Este documento registra como o Contas_exe deve ser operado para reduzir o risco
de tratamento inadequado de dados pessoais. Ele **não substitui avaliação
jurídica**: o controlador precisa definir base legal, aviso de privacidade,
encarregado/canal de atendimento e políticas internas.

---

## Escopo de dados pessoais

| Categoria           | Onde aparece                         | Observação LGPD                                                                                     |
| ------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Usuários do app     | `storage/users.json`                 | `username`, papel, data de criação e hash scrypt da senha.                                          |
| Contas armazenadas  | `storage/groups.json`                | email, usuário, telefone, email de recuperação, notas e outros metadados podem identificar pessoas. |
| Credenciais         | `storage/groups.json`, backups       | senhas, 2FA e tokens são dados de alto risco; tratar como sigilo máximo.                            |
| Sessão              | cookie HttpOnly                      | usado apenas para autenticação; `ipHash` e `userAgent` cifrados em repouso.                         |
| Backups/exportações | arquivos baixados pelo admin/usuário | podem conter dados pessoais e senhas em texto plano.                                                |
| Logs                | console/plataforma de deploy         | não devem conter senhas, tokens, dumps de request ou backups.                                       |

O sistema não deve coletar CPF, documentos, dados bancários, dados de saúde,
biometria ou dados de crianças/adolescentes. Se isso virar necessário, faça nova
avaliação de necessidade, base legal, retenção e segurança antes de coletar.

---

## Finalidade e minimização

- **Finalidade principal:** organizar e proteger credenciais de redes sociais
  usadas pela equipe.
- **Coleta mínima:** manter apenas os campos necessários para acesso, recuperação
  e operação da conta. Notas não devem receber dados pessoais livres sem necessidade.
- Sem analytics, pixels, publicidade comportamental ou compartilhamento automático
  com terceiros.
- YouTube OAuth está em pausa e o upload está desativado; se a integração voltar,
  documentar escopos, finalidade, titulares afetados, retenção dos tokens e revogação.
- `localStorage` guarda só preferência de tema e id do grupo ativo (não
  sensíveis); a API é a fonte da verdade e nenhum dado de conta fica no navegador.

---

## Base legal e transparência

Antes de produção, o controlador deve registrar fora do código:

- A base legal de cada tratamento (ex.: execução de contrato/atividade
  operacional da equipe e legítimo interesse para segurança e controle de acesso).
- Quem é o controlador, operador(es) e encarregado/canal de privacidade.
- Aviso aos usuários internos sobre quais dados são tratados, por que, por quanto
  tempo, quem acessa e como pedir correção/eliminação.
- Regra para cadastrar credenciais de terceiros: armazenar apenas quando houver
  autorização e necessidade operacional clara.

---

## Controles técnicos aplicados

- 🔒 **Criptografia em repouso AES-256-GCM** para `password`, `recoveryEmail`,
  `phone`, `notes` e tokens OAuth, quando `CONTAS_FLOW_ENC_KEY` está definida.
- 🔑 Senhas dos usuários com hash **scrypt** e salt por usuário.
- 🍪 Sessão por cookie HttpOnly, `SameSite=Strict`, `Path=/` e `Secure` em HTTPS,
  com estado server-side em `sessions.json`: revogável (encerrar uma sessão ou
  todas de um usuário) e com duplo prazo (3h de inatividade, 3 dias absolutos, OWASP).
  `ipHash` e `userAgent` das sessões são cifrados em repouso.
- 👤 **Isolamento por grupo/owner:** membros acessam apenas seus grupos; admin
  acessa tudo para governança e backup.
- 🚫 **Segredos não ficam no navegador:** as contas (senha, email de recuperação,
  telefone, notas) não são gravadas em `localStorage`. A senha nem vem na
  listagem — é buscada sob demanda no endpoint `/secret` (atrás de reauth),
  some da tela sozinha e o clipboard é limpo após a cópia.
- 🔏 **Reautenticação para ações críticas:** revelar/copiar senha, exportar
  backup, trocar senha, criar/remover admin e apagar grupo exigem redigitar a senha
  (libera por 5 min). Reduz o risco de uma sessão aberta numa máquina destravada.
- 🔐 **2FA opcional por usuário (TOTP, RFC 6238):** cada um ativa em "Minha conta";
  com 2FA ativo o login pede um código do app autenticador. Secret e códigos de
  recuperação cifrados em repouso; nunca expostos. Admin pode resetar o 2FA de
  quem ficar trancado fora.
- 📋 **Trilha de auditoria** (`audit.json`): registra quem fez o que e quando
  (incl. quem viu/copiou senha, exportou backup, trocou/criou/removeu), **sem**
  gravar qualquer segredo. Atende ao dever de informar sobre acesso/compartilhamento.
- 🛡️ Rate limit no login (e na reautenticação), headers de segurança, CORS fechado
  por padrão e limite de corpo de requisição.
- `storage/`, `.env`, exports e backups são ignorados pelo git.
- `readDb` falha alto em erro de leitura/decifragem e não sobrescreve
  `groups.json` com store vazio.

---

## Direitos do titular

Fluxo mínimo para atender solicitações:

1. Registrar solicitante, data, escopo e responsável pelo atendimento.
2. Confirmar identidade e autorização antes de revelar ou alterar dados.
3. Localizar dados em usuários, grupos, contas, backups recentes e logs.
4. Atender conforme o caso:
   - **acesso/confirmação:** exportar ou listar os dados pertinentes;
   - **correção:** editar a conta/grupo/usuário pela UI;
   - **eliminação/bloqueio:** apagar conta, grupo ou usuário quando não houver
     motivo operacional/legal para retenção;
   - **informação sobre acesso/compartilhamento:** listar administradores,
     operadores de infraestrutura e backups onde o dado existe; o painel
     "Registro de atividade" (audit log) mostra quem viu/alterou/exportou e quando.
5. Registrar a resposta e qualquer exceção de retenção.

> Ao remover um usuário, os grupos dele são reatribuídos ao admin para evitar
> perda de dados. Para uma eliminação LGPD completa, o admin deve revisar esses
> grupos e apagar ou transferir somente o que tiver justificativa.

---

## Retenção e backup

- Definir prazo de retenção por política interna. O padrão recomendado é manter
  credenciais apenas enquanto houver necessidade operacional.
- Exportações de grupo e backup completo contêm dados em texto plano — guardar em
  cofre, com acesso restrito, criptografia no destino e prazo de expiração.
- Snapshot do volume preserva `groups.json` cifrado, mas ainda é dado pessoal:
  proteger junto com `CONTAS_FLOW_ENC_KEY`, que deve ficar em cofre separado.
- Antes de compartilhar prints, logs ou arquivos com suporte externo, remover
  emails, telefones, usuários, senhas, tokens e URLs privadas.

---

## Incidentes de segurança

Tratar como incidente qualquer perda, acesso indevido, publicação acidental,
backup exposto, chave vazada, token OAuth vazado, conta comprometida ou
indisponibilidade relevante que afete confidencialidade, integridade,
disponibilidade ou autenticidade dos dados pessoais.

**Procedimento mínimo:**

1. **Conter:** revogar/trocar senhas, tokens e `CONTAS_FLOW_ENC_KEY` quando
   aplicável; restringir acessos e preservar evidências.
2. **Avaliar impacto:** titulares afetados, categorias de dados, volume, proteções
   existentes (ex.: criptografia) e risco/dano relevante.
3. **Corrigir:** remover exposição, restaurar de backup seguro e aplicar patch.
4. **Comunicar:** se houver risco ou dano relevante, o controlador deve avaliar
   comunicação aos titulares e à ANPD.
5. **Registrar:** linha do tempo, causa raiz, medidas tomadas e prevenções futuras.

---

## Checklist de produção LGPD

- [ ] Controlador, operador(es) e canal/encarregado definidos.
- [ ] Base legal e finalidade documentadas.
- [ ] Aviso interno de privacidade entregue aos usuários.
- [ ] `CONTAS_FLOW_ENC_KEY` definida e guardada em cofre separado.
- [ ] Admins limitados a quem realmente precisa.
- [ ] Política de backup, retenção e descarte definida.
- [ ] Processo de atendimento a direitos do titular definido.
- [ ] Processo de incidente e comunicação definido.
- [ ] Auditoria periódica de git, storage, backups e logs agendada.

---

## Referências oficiais

- [ANPD — Titular de Dados](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1)
- [ANPD — Comunicação de Incidente de Segurança](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis)
