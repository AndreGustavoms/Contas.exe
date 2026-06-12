import { useState } from "react";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LANGUAGES, type LangCode } from "../i18n";
import { cn } from "../lib/utils";

export function LangTerminal() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const currentLang = i18n.language as LangCode;
  const activeLang =
    LANGUAGES.find((l) => l.code === currentLang) ?? LANGUAGES[0];

  return (
    <div className={cn("login-terminal", !open && "login-terminal--collapsed")}>
      <div
        className="login-terminal-header"
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) =>
          (e.key === "Enter" || e.key === " ") && setOpen((v) => !v)
        }
      >
        <span className="login-terminal-title">
          <Globe width={13} height={13} />
          {open ? (
            "lang"
          ) : (
            <span className="login-terminal-active-code">
              {activeLang.flag} {activeLang.code.toUpperCase()}
            </span>
          )}
        </span>
        <div className="login-terminal-controls">
          <span className="login-terminal-dot login-terminal-dot--close" />
          <span className="login-terminal-dot login-terminal-dot--min" />
          <span className="login-terminal-dot login-terminal-dot--max" />
        </div>
      </div>
      <div className="login-terminal-body">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            className={cn(
              "login-terminal-lang",
              currentLang === lang.code && "login-terminal-lang--active",
            )}
            type="button"
            onClick={() => {
              i18n.changeLanguage(lang.code);
              setOpen(false);
            }}
          >
            <span>{lang.flag}</span>
            <span>{lang.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
