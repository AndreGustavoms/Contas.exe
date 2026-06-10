# LGPD - controles operacionais

Este documento registra como o Contas_exe deve ser operado para reduzir risco
de tratamento inadequado de dados pessoais. Ele nao substitui avaliacao juridica:
o controlador precisa definir base legal, aviso de privacidade, encarregado/canal
de atendimento e politicas internas.

## Escopo de dados pessoais

| Categoria | Onde aparece | Observacao LGPD |
| --- | --- | --- |
| Usuarios do app | `storage/users.json` | `username`, papel, data de criacao e hash scrypt da senha. |
| Contas armazenadas | `storage/groups.json` | email, usuario, telefone, email de recuperacao, notas e outros metadados podem identificar pessoas. |
| Credenciais | `storage/groups.json`, backups | senhas, 2FA e tokens sao dados de alto risco operacional; tratar como sigilo maximo. |
| Sessao | cookie HttpOnly | usado apenas para autenticacao. |
| Backups/exportacoes | arquivos baixados pelo admin/usuario | podem conter dados pessoais e senhas em texto plano. |
| Logs | console/plataforma de deploy | nao devem conter senhas, tokens, dumps de request ou backups. |

O sistema nao deve coletar CPF, documentos, dados bancarios, dados de saude,
biometria ou dados de criancas/adolescentes. Se isso virar necessario, faca nova
avaliacao de necessidade, base legal, retencao e seguranca antes de coletar.

## Finalidade e minimizacao

- Finalidade principal: organizar e proteger credenciais de redes sociais usadas
  pela equipe.
- Coleta minima: manter apenas os campos necessarios para acesso, recuperacao e
  operacao da conta. Notas nao devem receber dados pessoais livres sem necessidade.
- Sem analytics, pixels, publicidade comportamental ou compartilhamento automatico
  com terceiros.
- YouTube OAuth esta em pausa e o upload esta desativado; se a integracao voltar,
  documentar escopos, finalidade, titulares afetados, retencao dos tokens e
  revogacao.
- `localStorage` guarda so preferencia de tema e id do grupo ativo (nao
  sensiveis); a API e a fonte da verdade e nenhum dado de conta fica no navegador.

## Base legal e transparencia

Antes de producao, o controlador deve registrar fora do codigo:

- a base legal de cada tratamento, por exemplo execucao de contrato/atividade
  operacional da equipe e legitimo interesse para seguranca e controle de acesso;
- quem e o controlador, operador(es) e encarregado/canal de privacidade;
- aviso aos usuarios internos sobre quais dados sao tratados, por que, por quanto
  tempo, quem acessa e como pedir correcao/eliminacao;
- regra para cadastrar credenciais de terceiros: armazenar apenas quando houver
  autorizacao e necessidade operacional clara.

## Controles tecnicos aplicados

- Criptografia em repouso AES-256-GCM para `password`, `recoveryEmail`, `phone`,
  `notes` e tokens OAuth, quando `CONTAS_FLOW_ENC_KEY` esta definida.
- Senhas dos usuarios com hash scrypt e salt por usuario.
- Sessao por cookie HttpOnly, `SameSite=Strict`, `Path=/` e `Secure` em HTTPS,
  com estado server-side em `sessions.json`: revogavel (encerrar uma sessao ou
  todas de um usuario) e com duplo prazo (3h de inatividade, 3 dias absolutos,
  OWASP). `ipHash` e `userAgent` das sessoes sao cifrados em repouso.
- Isolamento por grupo/owner: membros acessam apenas seus grupos; admin acessa
  tudo para governanca e backup.
- Segredos nao ficam no navegador: as contas (senha, email de recuperacao,
  telefone, notas) nao sao gravadas em `localStorage`; senha revelada se
  reoculta sozinha e o clipboard e limpo apos a copia. So o id do grupo ativo
  (nao sensivel) e guardado, namespaceado por usuario.
- Rate limit no login, headers de seguranca, CORS fechado por padrao e limite de
  corpo de requisicao.
- `storage/`, `.env`, exports e backups sao ignorados pelo Git.
- `readDb` falha alto em erro de leitura/decifragem e nao sobrescreve
  `groups.json` com store vazio.

## Direitos do titular

Fluxo minimo para atender solicitacoes:

1. Registrar solicitante, data, escopo e responsavel pelo atendimento.
2. Confirmar identidade e autorizacao antes de revelar ou alterar dados.
3. Localizar dados em usuarios, grupos, contas, backups recentes e logs.
4. Atender conforme o caso:
   - acesso/confirmacao: exportar ou listar os dados pertinentes;
   - correcao: editar a conta/grupo/usuario pela UI;
   - eliminacao/bloqueio: apagar conta, grupo ou usuario quando nao houver motivo
     operacional/legal para retencao;
   - informacao sobre compartilhamento: listar administradores, operadores de
     infraestrutura e backups onde o dado existe.
5. Registrar a resposta e qualquer excecao de retencao.

Observacao operacional: ao remover um usuario, os grupos dele sao reatribuidos ao
admin para evitar perda de dados. Para uma eliminacao LGPD completa, o admin deve
revisar esses grupos e apagar ou transferir somente o que tiver justificativa.

## Retencao e backup

- Definir prazo de retencao por politica interna. O padrao recomendado e manter
  credenciais apenas enquanto houver necessidade operacional.
- Exportacoes de grupo e backup completo contem dados em texto plano; guardar em
  cofre, com acesso restrito, criptografia no destino e prazo de expiracao.
- Snapshot do volume preserva `groups.json` cifrado, mas ainda e dado pessoal:
  proteger junto com `CONTAS_FLOW_ENC_KEY`, que deve ficar em cofre separado.
- Antes de compartilhar prints, logs ou arquivos com suporte externo, remover
  emails, telefones, usuarios, senhas, tokens e URLs privadas.

## Incidentes de seguranca

Tratar como incidente qualquer perda, acesso indevido, publicacao acidental,
backup exposto, chave vazada, token OAuth vazado, conta comprometida ou
indisponibilidade relevante que afete confidencialidade, integridade,
disponibilidade ou autenticidade dos dados pessoais.

Procedimento minimo:

1. Conter: revogar/trocar senhas, tokens e `CONTAS_FLOW_ENC_KEY` quando aplicavel;
   restringir acessos e preservar evidencias.
2. Avaliar impacto: titulares afetados, categorias de dados, volume, protecoes
   existentes (ex.: criptografia) e risco/dano relevante.
3. Corrigir: remover exposicao, restaurar de backup seguro e aplicar patch.
4. Comunicar: se houver risco ou dano relevante, o controlador deve avaliar
   comunicacao aos titulares e a ANPD.
5. Registrar: linha do tempo, causa raiz, medidas tomadas e prevencoes futuras.

## Checklist de producao LGPD

- [ ] Controlador, operador(es) e canal/encarregado definidos.
- [ ] Base legal e finalidade documentadas.
- [ ] Aviso interno de privacidade entregue aos usuarios.
- [ ] `CONTAS_FLOW_ENC_KEY` definida e guardada em cofre separado.
- [ ] Admins limitados a quem realmente precisa.
- [ ] Politica de backup, retencao e descarte definida.
- [ ] Processo de atendimento a direitos do titular definido.
- [ ] Processo de incidente e comunicacao definido.
- [ ] Auditoria periodica de Git, storage, backups e logs agendada.

## Referencias oficiais

- ANPD - Titular de Dados: https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1
- ANPD - Comunicacao de Incidente de Seguranca: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis
