import { ArrowLeft, Shield } from "lucide-react";
import { type AppTheme } from "../theme";
import { cn } from "../lib/utils";
import { CONTACT_EMAIL, SITE_NAME } from "../lib/site";

type Props = {
  theme: AppTheme;
  onBack?: () => void;
};

export function PrivacyPolicy({ theme, onBack }: Props) {
  return (
    <main className={cn(`theme-${theme}`, "app-shell min-h-[100dvh]")}>
      <div className="mx-auto max-w-2xl px-5 py-10">
        {onBack && (
          <button
            onClick={onBack}
            className="mb-8 flex items-center gap-2 text-sm opacity-60 transition-opacity hover:opacity-100"
            style={{ color: "var(--text)" }}
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
        )}

        <div className="mb-8 flex items-center gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
            style={{
              background: "var(--accent-surface)",
              color: "var(--accent)",
            }}
          >
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1
              className="text-2xl font-semibold"
              style={{ color: "var(--text)" }}
            >
              Política de Privacidade
            </h1>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Atualizada em 18 de junho de 2026
            </p>
          </div>
        </div>

        <div
          className="rounded-2xl p-6 space-y-6 text-sm leading-relaxed"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          <Section title="1. Quem somos">
            <p>
              O <strong>{SITE_NAME}</strong> é um gerenciador de credenciais e
              senhas voltado a equipes e uso pessoal. Operado de forma
              independente, o serviço é acessado em produção via Railway e está
              disponível publicamente em <em>contas-flow.up.railway.app</em> (ou
              domínio customizado quando configurado). Dúvidas:{" "}
              <strong>{CONTACT_EMAIL}</strong>.
            </p>
          </Section>

          <Section title="2. Quais dados coletamos">
            <p>
              Coletamos apenas o necessário para o funcionamento do serviço:
            </p>
            <ul className="mt-2 space-y-1 list-none">
              <Li>
                <strong>Dados de conta:</strong> nome completo, nome de usuário,
                endereço de e-mail e senha (armazenada com hash bcrypt/scrypt —
                jamais em texto puro).
              </Li>
              <Li>
                <strong>Credenciais do cofre:</strong> logins, senhas, URLs e
                anotações que você registra. Todos os campos sensíveis são
                cifrados em repouso com chave AES-256-GCM derivada da variável
                de ambiente do servidor — inacessíveis mesmo a quem acessa o
                banco de dados diretamente.
              </Li>
              <Li>
                <strong>Dados de sessão:</strong> token de sessão armazenado em
                cookie HttpOnly seguro, com validade de 7 dias (renovável) ou
                até o logout.
              </Li>
              <Li>
                <strong>Logs de auditoria:</strong> registro interno de eventos
                como login, troca de senha e alterações de configuração. Esses
                logs ficam no servidor e não são compartilhados.
              </Li>
              <Li>
                <strong>Autenticação OAuth:</strong> se você entrar via Google
                ou GitHub, recebemos apenas nome, e-mail e identificador público
                fornecidos por esses serviços. Não armazenamos tokens OAuth.
              </Li>
              <Li>
                <strong>Dados de uso:</strong> endereço IP (usado exclusivamente
                para rate-limiting e segurança), sem rastreamento
                comportamental.
              </Li>
            </ul>
          </Section>

          <Section title="3. Como usamos seus dados">
            <ul className="mt-2 space-y-1 list-none">
              <Li>Autenticar seu acesso e manter sua sessão ativa.</Li>
              <Li>Armazenar e recuperar suas credenciais de forma segura.</Li>
              <Li>
                Enviar e-mails transacionais quando solicitado (recuperação de
                senha, confirmações).
              </Li>
              <Li>
                Detectar e bloquear tentativas de uso abusivo (rate-limiting por
                IP).
              </Li>
              <Li>Permitir que administradores gerenciem membros da equipe.</Li>
            </ul>
            <p className="mt-3">
              Não usamos seus dados para publicidade, não os vendemos e não os
              compartilhamos com terceiros, exceto pelos provedores de
              infraestrutura listados abaixo.
            </p>
          </Section>

          <Section title="4. Compartilhamento com terceiros">
            <p>
              Seus dados trafegam apenas pelos seguintes provedores essenciais
              para o funcionamento do serviço:
            </p>
            <ul className="mt-2 space-y-1 list-none">
              <Li>
                <strong>Railway</strong> — hospedagem do servidor e banco de
                dados.
              </Li>
              <Li>
                <strong>Resend</strong> — envio de e-mails transacionais
                (recuperação de senha). Apenas o endereço de destino e o
                conteúdo do e-mail são transmitidos.
              </Li>
              <Li>
                <strong>Google / GitHub</strong> — apenas quando você opta pelo
                login OAuth; os dados recebidos são os descritos na seção 2.
              </Li>
            </ul>
            <p className="mt-3">
              Nenhum dado é compartilhado com empresas de análise, redes de
              anúncios ou outras partes não listadas aqui.
            </p>
          </Section>

          <Section title="5. Segurança">
            <ul className="mt-2 space-y-1 list-none">
              <Li>Senhas armazenadas com hash scrypt (custo adaptativo).</Li>
              <Li>
                Campos sensíveis do cofre cifrados com AES-256-GCM em repouso.
              </Li>
              <Li>Comunicação via HTTPS/TLS em produção.</Li>
              <Li>
                Cookies de sessão com flags <code>HttpOnly</code>,{" "}
                <code>Secure</code> e <code>SameSite=Lax</code>.
              </Li>
              <Li>
                Autenticação de dois fatores (TOTP) disponível para todos os
                usuários.
              </Li>
              <Li>Rate-limiting por IP em endpoints de autenticação.</Li>
              <Li>Auditoria de eventos sensíveis com log no servidor.</Li>
            </ul>
            <p className="mt-3">
              Apesar de todas as medidas técnicas, nenhum sistema é 100%
              inviolável. Em caso de incidente de segurança que afete seus
              dados, notificaremos por e-mail no menor prazo possível.
            </p>
          </Section>

          <Section title="6. Retenção de dados">
            <p>
              Seus dados permanecem armazenados enquanto sua conta estiver
              ativa. Ao excluir sua conta, todos os dados associados — incluindo
              as credenciais do cofre — são removidos permanentemente do
              servidor. Logs de auditoria podem ser retidos por até 90 dias após
              a exclusão por motivos de segurança e são então apagados.
            </p>
          </Section>

          <Section title="7. Seus direitos">
            <p>Você tem direito a:</p>
            <ul className="mt-2 space-y-1 list-none">
              <Li>
                <strong>Acesso:</strong> visualizar todos os dados que
                armazenamos sobre você (disponível nas configurações da conta).
              </Li>
              <Li>
                <strong>Retificação:</strong> corrigir nome, e-mail ou senha
                diretamente nas configurações.
              </Li>
              <Li>
                <strong>Exclusão:</strong> remover sua conta e todos os dados
                associados.
              </Li>
              <Li>
                <strong>Portabilidade:</strong> exportar suas credenciais do
                cofre a qualquer momento.
              </Li>
            </ul>
            <p className="mt-3">
              Para exercer qualquer direito não disponível diretamente na
              interface, entre em contato pelo e-mail{" "}
              <strong>{CONTACT_EMAIL}</strong>.
            </p>
          </Section>

          <Section title="8. Cookies">
            <p>
              Utilizamos um único cookie essencial: o token de sessão (
              <code>sid</code>), necessário para manter você autenticado. Não há
              cookies de rastreamento, analytics ou publicidade. Nenhum banner
              de cookies é exibido porque não há cookies não essenciais.
            </p>
          </Section>

          <Section title="9. Menores de idade">
            <p>
              O Contas não é direcionado a menores de 13 anos. Não coletamos
              intencionalmente dados de crianças. Se você acredita que dados de
              um menor foram coletados, entre em contato para remoção imediata.
            </p>
          </Section>

          <Section title="10. Alterações nesta política">
            <p>
              Quando houver alterações relevantes, atualizaremos a data no topo
              desta página e, quando aplicável, notificaremos por e-mail. O uso
              continuado do serviço após a publicação das alterações implica
              concordância com os novos termos.
            </p>
          </Section>

          <Section title="11. Contato">
            <p>
              Dúvidas, solicitações de dados ou denúncias de incidentes:{" "}
              <strong>{CONTACT_EMAIL}</strong>.
            </p>
          </Section>
        </div>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2
        className="mb-2 text-base font-semibold"
        style={{ color: "var(--accent)" }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span
        style={{ color: "var(--accent)" }}
        className="mt-[2px] flex-shrink-0 text-xs"
      >
        ▸
      </span>
      <span style={{ color: "var(--muted)" }}>{children}</span>
    </li>
  );
}
