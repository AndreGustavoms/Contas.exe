import { Dices } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

// Geração e medição de força de senhas. Tudo client-side com crypto.getRandomValues
// (CSPRNG do navegador) — a senha gerada nunca passa pela rede até o usuário salvar.

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%&*()-_=+[]{};:,.?";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

// Índice aleatório uniforme em [0, max) sem viés de módulo (rejection sampling).
function randomIndex(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

// Senha de `length` caracteres com pelo menos 1 minúscula, 1 maiúscula,
// 1 dígito e 1 símbolo (passa nas regras do servidor), embaralhada com
// Fisher–Yates para as classes garantidas não ficarem em posições fixas.
export function generatePassword(length = 16): string {
  const chars: string[] = [
    LOWER[randomIndex(LOWER.length)],
    UPPER[randomIndex(UPPER.length)],
    DIGITS[randomIndex(DIGITS.length)],
    SYMBOLS[randomIndex(SYMBOLS.length)],
  ];
  while (chars.length < length) {
    chars.push(ALL[randomIndex(ALL.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// 0 = vazia, 1 = fraca, 2 = média, 3 = forte, 4 = excelente.
// Heurística simples e honesta: comprimento + variedade de classes.
export function scorePassword(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;

  const len = password.length;
  if (len >= 16 && classes === 4) return 4;
  if (len >= 20 && classes >= 3) return 4;
  if (len >= 14 && classes === 4) return 3;
  if (len >= 12 && classes >= 3) return 2;
  if (len >= 8) return 1;
  return 1;
}

const STRENGTH_KEYS = [
  "",
  "account.pw_weak",
  "account.pw_medium",
  "account.pw_strong",
  "account.pw_excellent",
] as const;

const STRENGTH_COLORS = [
  "",
  "bg-red-400",
  "bg-amber-400",
  "bg-green-400/70",
  "bg-green-400",
] as const;

const STRENGTH_TEXT = [
  "",
  "text-red-400",
  "text-amber-400",
  "text-green-400/90",
  "text-green-400",
] as const;

// Barra de 4 segmentos + rótulo, atualizada a cada tecla. Não renderiza nada
// com o campo vazio (sem ruído visual antes de o usuário digitar).
export function PasswordStrengthMeter({ password }: { password: string }) {
  const { t } = useTranslation();
  const level = scorePassword(password);
  if (level === 0) return null;

  return (
    <div aria-live="polite" className="grid gap-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((seg) => (
          <span
            key={seg}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              seg <= level
                ? STRENGTH_COLORS[level]
                : "bg-[color:var(--border)]",
            )}
          />
        ))}
      </div>
      <span className={cn("text-[11px] font-medium", STRENGTH_TEXT[level])}>
        {t(STRENGTH_KEYS[level])}
      </span>
    </div>
  );
}

// Botão "gerar senha forte": preenche o campo do chamador via onGenerate.
export function GeneratePasswordButton({
  onGenerate,
  className,
}: {
  onGenerate: (password: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-3 text-xs font-medium text-[color:var(--muted)] transition hover:border-[color:var(--accent-border)] hover:bg-[color:var(--field-hover)] hover:text-[color:var(--text)]",
        className,
      )}
      type="button"
      onClick={() => onGenerate(generatePassword(16))}
    >
      <Dices className="h-3.5 w-3.5" />
      {t("account.pw_generate")}
    </button>
  );
}
