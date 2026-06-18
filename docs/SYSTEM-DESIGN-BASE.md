# System Design Base

Template pessoal de system design derivado do padrão consolidado no
`Contas_exe`. A ideia não é descrever só este projeto, mas capturar a forma de
pensar e iniciar novos produtos com consistência.

## Perfil de arquitetura

Seu padrão base é:

- monólito modular primeiro
- frontend rico, backend pragmático
- segurança forte desde o início
- deploy simples
- documentação operacional versionada

Em uma frase:

> Centralizar complexidade no backend, manter a superfície de deploy simples e
> tratar segurança e operação como parte do produto.

## Defaults recomendados

### Stack

- Frontend: React + TypeScript + Vite
- UI: Tailwind + componentes próprios
- Backend: Node
- Persistência real: PostgreSQL
- Sessão: server-side com cookie `HttpOnly`
- Hash de senha: `scrypt`
- Criptografia em repouso: `AES-256-GCM`
- i18n: `react-i18next` se o produto nasce com múltiplos idiomas
- Deploy: um serviço só no começo

### Módulos obrigatórios

- `auth`
- `users`
- `sessions`
- `permissions`
- `audit`
- `security`
- `domain modules`
- `integrations`
- `docs`

## Regras de decisão

### Quando começar com um serviço só

- produto ainda é uma unidade clara
- equipe pequena
- deploy precisa ser simples
- não há demanda real por escala independente

### Quando subir para múltiplos serviços

- jobs longos ou assíncronos viram parte central
- integrações externas pesadas isolam melhor
- múltiplos times precisam iterar separadamente
- há gargalo claro de escalabilidade operacional

### Quando usar PostgreSQL desde o dia 1

Use como padrão se houver:

- multiusuário
- permissões por papel
- ownership
- auditoria
- sessões
- reset de senha
- integrações persistentes
- necessidade real de consulta, filtro ou histórico

## Checklist de kickoff

Antes de escrever código, responda:

- qual problema o sistema resolve?
- quem usa?
- qual é o fluxo principal?
- quais dados são sensíveis?
- quem é dono de cada recurso?
- quais ações exigem reauth?
- o que precisa de auditoria?
- onde pode haver concorrência?
- qual é o plano de backup e restore?

## Estrutura de projeto sugerida

```text
src/
  app/
  components/
  features/
  lib/
  locales/

server/
  index
  auth
  users
  sessions
  permissions
  audit
  db
  integrations/
  domain/

docs/
  ARCHITECTURE.md
  DEPLOY.md
  SECURITY.md
  OPERATIONS.md
```

## Template de documento

```md
# System Design

## 1. Objetivo
O sistema resolve:
Usuários:
Fluxo principal:
Ação crítica:

## 2. Arquitetura
- Frontend:
- Backend:
- Persistência:
- Deploy:
- Integrações:

## 3. Módulos
- Auth
- Users
- Sessions
- Permissions
- Audit
- Domain modules
- Integrations

## 4. Modelo de dados
Entidades:
Relacionamentos:
Campos sensíveis:
Campos auditáveis:

## 5. Auth e autorização
- Login:
- Sessão:
- Papéis:
- Ownership:
- Reauth:

## 6. Segurança
- Hash de senha:
- Criptografia em repouso:
- Cookies:
- Rate limit:
- Headers:
- Auditoria:
- Backup:

## 7. API
- Rotas:
- Contratos:
- Validação:
- Erros:

## 8. Frontend
- Telas:
- Estado:
- Componentes reutilizáveis:
- i18n:
- tema/design system:

## 9. Operação
- Variáveis de ambiente:
- Como rodar local:
- Como buildar:
- Como deployar:
- Como restaurar:

## 10. Riscos
- Técnicos:
- Segurança:
- Escala:
- Mitigação:
```

## O que melhorar sempre

Ao reaplicar esse padrão em projetos novos, elevar:

- policy layer explícita para autorização
- contratos de API mais formais
- observabilidade mínima obrigatória
- migrations como rotina
- distinção clara entre auditoria e logs técnicos
- testes focados em risco

## Anti-padrões para evitar

- espalhar regra de permissão pelo frontend
- usar JSON como solução permanente em app multiusuário real
- tratar backup como detalhe operacional
- colocar segredos em fixtures, docs ou exemplos
- criar múltiplos serviços cedo sem necessidade real
