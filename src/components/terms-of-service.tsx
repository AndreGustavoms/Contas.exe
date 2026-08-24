import { ArrowLeft, FileText } from "lucide-react";
import { type AppTheme } from "../theme";
import { cn } from "../lib/utils";
import { CONTACT_EMAIL } from "../lib/site";

type Props = {
  theme: AppTheme;
  onBack?: () => void;
};

export function TermsOfService({ theme, onBack }: Props) {
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
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h1
              className="text-2xl font-semibold"
              style={{ color: "var(--text)" }}
            >
              Termos de Uso
            </h1>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Atualizado em 18 de junho de 2026
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
          <Section title="1. Aceitação dos termos">
            <p>
              Ao criar uma conta ou utilizar o <strong>Contas</strong>, você
              concorda com estes Termos de Uso. Se não concordar com algum
              ponto, não utilize o serviço. O uso continuado após alterações
              publicadas nesta página implica aceitação dos novos termos.
            </p>
          </Section>

          <Section title="2. Descrição do serviço">
            <p>
              O Contas é um gerenciador de credenciais e senhas que permite
              armazenar, organizar e acessar logins, senhas e informações
              associadas de forma segura. O serviço é disponibilizado "no estado
              em que se encontra" e pode ser atualizado, modificado ou encerrado
              a qualquer momento mediante aviso prévio razoável.
            </p>
          </Section>

          <Section title="3. Cadastro e responsabilidade da conta">
            <ul className="mt-2 space-y-1 list-none">
              <Li>
                Você é responsável por manter a confidencialidade da sua senha
                de acesso.
              </Li>
              <Li>Cada conta é pessoal e intransferível.</Li>
              <Li>
                Informe dados verdadeiros ao se cadastrar; contas com
                informações falsas podem ser removidas.
              </Li>
              <Li>
                Notifique imediatamente qualquer acesso não autorizado à sua
                conta pelo e-mail <strong>{CONTACT_EMAIL}</strong>.
              </Li>
              <Li>
                O titular da conta é responsável por todas as ações realizadas
                em seu nome.
              </Li>
            </ul>
          </Section>

          <Section title="4. Uso aceitável">
            <p>
              Você concorda em utilizar o serviço somente para fins lícitos. É
              expressamente proibido:
            </p>
            <ul className="mt-2 space-y-1 list-none">
              <Li>
                Armazenar credenciais de terceiros sem a devida autorização.
              </Li>
              <Li>
                Tentar acessar contas, dados ou sistemas de outros usuários.
              </Li>
              <Li>
                Realizar ataques de força bruta, scraping automatizado ou
                qualquer teste de penetração não autorizado.
              </Li>
              <Li>
                Usar o serviço para atividades ilegais, fraudes ou violação de
                direitos de terceiros.
              </Li>
              <Li>
                Compartilhar sua conta com outras pessoas sem consentimento do
                administrador da equipe.
              </Li>
              <Li>
                Reverter, descompilar ou tentar extrair o código-fonte do
                serviço.
              </Li>
            </ul>
          </Section>

          <Section title="5. Conteúdo armazenado">
            <p>
              Você é o único responsável pelas credenciais e informações que
              armazena no Contas. O serviço não tem acesso ao conteúdo cifrado
              do seu cofre e não realiza verificação do que é salvo. Ao usar o
              serviço, você garante que possui autorização legal para armazenar
              as credenciais inseridas.
            </p>
          </Section>

          <Section title="6. Segurança e limitação de responsabilidade">
            <p>
              O Contas adota medidas técnicas robustas de segurança (descritas
              na Política de Privacidade), porém não garante disponibilidade
              ininterrupta nem ausência absoluta de falhas. Na máxima extensão
              permitida por lei:
            </p>
            <ul className="mt-2 space-y-1 list-none">
              <Li>
                O serviço é fornecido sem garantias expressas ou implícitas de
                adequação a um fim específico.
              </Li>
              <Li>
                Não nos responsabilizamos por perdas de dados decorrentes de
                falhas técnicas imprevisíveis.
              </Li>
              <Li>
                Não nos responsabilizamos por danos indiretos, lucros cessantes
                ou danos consequentes.
              </Li>
            </ul>
            <p className="mt-3">
              <strong>Recomendamos fortemente</strong> que você mantenha cópias
              de segurança externas das credenciais críticas. A exportação está
              disponível nas configurações da conta.
            </p>
          </Section>

          <Section title="7. Conta de administrador e equipes">
            <p>
              Usuários com papel de <em>admin</em> ou <em>superadmin</em> podem
              gerenciar membros da equipe. O superadmin (proprietário da
              instância) tem acesso ao painel administrativo e assume
              responsabilidade pela gestão adequada dos usuários sob sua
              supervisão, incluindo remoção de acessos quando necessário.
            </p>
          </Section>

          <Section title="8. Suspensão e encerramento">
            <p>
              Reservamo-nos o direito de suspender ou encerrar contas que violem
              estes termos, com ou sem aviso prévio dependendo da gravidade. Em
              caso de encerramento por violação, os dados podem ser removidos
              imediatamente. Você pode encerrar sua conta a qualquer momento nas
              configurações; os dados são apagados conforme descrito na Política
              de Privacidade.
            </p>
          </Section>

          <Section title="9. Propriedade intelectual">
            <p>
              O código-fonte, design e marca do Contas são de propriedade do
              desenvolvedor. O uso do serviço não transfere nenhum direito de
              propriedade intelectual ao usuário. As credenciais que você
              armazena pertencem exclusivamente a você.
            </p>
          </Section>

          <Section title="10. Alterações nos termos">
            <p>
              Podemos atualizar estes termos a qualquer momento. Alterações
              significativas serão comunicadas por e-mail com pelo menos 7 dias
              de antecedência. A data de atualização no topo desta página indica
              a versão vigente.
            </p>
          </Section>

          <Section title="11. Lei aplicável">
            <p>
              Estes termos são regidos pelas leis da República Federativa do
              Brasil, com foro da comarca de domicílio do operador do serviço
              para dirimir quaisquer controvérsias, sem prejuízo de vias de
              resolução amigável.
            </p>
          </Section>

          <Section title="12. Contato">
            <p>
              Dúvidas sobre estes termos: <strong>{CONTACT_EMAIL}</strong>.
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
