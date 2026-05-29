# Contas-flow

Contas-flow e um painel para organizar fluxos de criacao de contas, centralizando etapas, pendencias, status e responsaveis em uma fila unica.

## Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS 3
- Lucide React

## Padrao de qualidade

Este projeto usa o **Felixo System Design** como contrato de frontend, backend, README e contexto operacional.

Arquivos de referencia:

- `docs/design-system/core/GUIA_MINIMO_QUALIDADE.md`
- `docs/design-system/core/DESIGN_SYSTEM_FRONTEND.md`
- `docs/design-system/core/DESIGN_SYSTEM_BACKEND.md`
- `docs/design-system/core/DESIGN_SYSTEM_README.md`
- `IA.md`

## Scripts

```bash
npm install
npm run dev
npm run build
```

## Estrutura inicial

```text
src/
  components/
    ui/                       # componentes base reutilizaveis
    account-flow-dashboard.tsx # primeira tela funcional
  data/                       # dados mockados do MVP
  lib/                        # utilitarios compartilhados
```

## Estado atual

- Dashboard operacional criado.
- Filtro por busca e status.
- Criacao local de novo fluxo.
- Checklist interativo com atualizacao de progresso.
- Design system copiado para `docs/design-system/core`.
