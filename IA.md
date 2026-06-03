# IA - Contexto Operacional

## Projeto

Contas_exe.

## Dono e uso

O projeto e do Andre e sera usado localmente para facilitar tarefas de
organizacao de contas, emails, usuarios e senhas.

## Objetivo atual

Manter um organizador local de acessos por plataforma, funcao, status e 2FA. A
referencia de trabalho inclui redes como YouTube, Instagram, TikTok, Facebook e
Kwai, alem de funcoes como postagem, apoio, conta estrela, nicho e recuperacao.

## Decisoes tecnicas

- Frontend em React 18, TypeScript, Vite e Tailwind CSS 3.
- Dados persistidos em `storage/accounts.json` por API local Node.
- Tela de acesso local antes do cofre: nome `Vitissouls` e senha `Vitissouls`.
- Temas disponiveis: Andre, Dark e White. O tema Andre usa preto com roxo neon.
- `localStorage` fica apenas como fallback/migracao.
- Estado inicial vazio para evitar credenciais reais no codigo.
- Backup manual por exportacao/importacao JSON.
- Sem servico externo nesta fase.
- Fonte externa removida para reduzir dependencia de rede no uso local.
- Pasta antiga de design system, build `dist`, logs de servidor e MVP de fluxos
  foram removidos.
- Listas, filtros e registros devem seguir ordem alfabetica.

## Regras de seguranca

- Nao salvar senhas reais em arquivos versionados.
- Nao commitar `storage/accounts.json` nem backups JSON exportados.
- Lembrar que o arquivo local e backup JSON nao sao criptografados.
- Se o app passar a ser usado por mais pessoas, priorizar criptografia local ou
  backend com cofre seguro antes de compartilhar dados sensiveis.

## Funcionalidades atuais

- Login local simples.
- Alternancia de tema.
- Cadastro e edicao de contas.
- Cadastro guiado em modal.
- Busca global.
- Filtros por plataforma/funcao e abas de status.
- Copia rapida de email e usuario.
- Exibicao/ocultacao de senha.
- Status: ativa, revisar e arquivada.
- Marcacao de 2FA.
- Exportacao/importacao de backup JSON.

## Proximos passos possiveis

- Importar a planilha de rede de amplificacao para gerar registros iniciais.
- Adicionar criptografia local com senha mestra.
- Criar campos customizados por plataforma.
- Criar testes para filtros, persistencia e importacao de backup.

## Verificacoes

- Validar TypeScript e build com `npm run build`.
