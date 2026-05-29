# IA - Contexto Operacional

## Projeto

Contas-flow.

## Objetivo atual

Criar uma base de aplicacao para organizar e facilitar fluxos de criacao de contas, usando o Felixo System Design como padrao obrigatorio.

## Decisoes tecnicas

- Frontend iniciado com React 18, TypeScript, Vite e Tailwind CSS 3.
- Componentes base ficam em `src/components/ui`.
- A primeira tela e um painel operacional, sem landing page.
- Dados iniciais ficam mockados em `src/data/account-flows.ts`.
- O core do Felixo System Design foi copiado para `docs/design-system/core`.

## Padroes ativos

- Ler `docs/design-system/core/GUIA_MINIMO_QUALIDADE.md` antes de mudancas relevantes.
- Para frontend, seguir `docs/design-system/core/DESIGN_SYSTEM_FRONTEND.md`.
- Para backend futuro, seguir `docs/design-system/core/DESIGN_SYSTEM_BACKEND.md`.
- Manter README e este arquivo atualizados quando decisoes estruturais mudarem.

## Funcionalidades criadas

- Painel de fluxo de contas.
- Metricas de prontos, pendencias e total de fluxos.
- Busca por nome, responsavel ou canal.
- Filtro por status.
- Criacao local de fluxo.
- Checklist com alternancia de etapas e recalculo de progresso.

## Proximos passos

- Definir modelo real de dados.
- Escolher se o backend sera Django + SQLite, conforme padrao preferido do design system.
- Persistir fluxos criados.
- Adicionar autenticacao quando houver usuarios reais.
- Criar testes automatizados para regras de progresso e filtros quando a regra estabilizar.

## Verificacoes

- Build deve ser validado com `npm run build`.
