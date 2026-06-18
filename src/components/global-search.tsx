import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Search, X, ArrowRight, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import { Spinner } from "./ui/spinner";
import {
  FacebookIcon,
  InstagramIcon,
  KwaiIcon,
  TikTokIcon,
  YouTubeIcon,
} from "./platform-icons";
import type { AccountRecord } from "../data/credential-records";

interface SearchResult extends AccountRecord {
  groupId: string;
  groupName: string;
}

interface Props {
  onClose: () => void;
  onNavigate: (groupId: string) => void;
}

async function fetchResults(q: string): Promise<SearchResult[]> {
  const res = await fetch(
    `/api/search?q=${encodeURIComponent(q)}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

function PlatformIcon({
  platform,
  className,
}: {
  platform: string | undefined;
  className?: string;
}) {
  const cls = cn("h-4 w-4 shrink-0", className);
  switch (platform) {
    case "instagram": return <InstagramIcon className={cls} />;
    case "facebook":  return <FacebookIcon  className={cls} />;
    case "youtube":   return <YouTubeIcon   className={cls} />;
    case "tiktok":    return <TikTokIcon    className={cls} />;
    case "kwai":      return <KwaiIcon      className={cls} />;
    default:          return <Layers        className={cls} style={{ color: "var(--muted)" }} />;
  }
}

export function GlobalSearch({ onClose, onNavigate }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const res = await fetchResults(q);
      setResults(res);
      setCursor(0);
      setLoading(false);
    }, 220);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Keep focused item scrolled into view
  useEffect(() => {
    const li = listRef.current?.children[cursor] as HTMLElement | undefined;
    li?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = useCallback(
    (result: SearchResult) => {
      onNavigate(result.groupId);
      onClose();
    },
    [onNavigate, onClose],
  );

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && results[cursor]) {
      pick(results[cursor]);
    }
  }

  return (
    /* backdrop */
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center pt-[10vh]"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="mx-4 w-full max-w-xl overflow-hidden rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.45)]"
        style={{ background: "var(--panel)", border: "1px solid var(--accent-border)" }}
      >
        {/* search input */}
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          {loading ? (
            <Spinner className="h-4 w-4 shrink-0 text-[color:var(--accent)]" />
          ) : (
            <Search className="h-4 w-4 shrink-0" style={{ color: "var(--muted)" }} />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("vault.global_search_placeholder")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-40"
            style={{ color: "var(--text)" }}
          />
          {query && (
            <button onClick={() => setQuery("")} className="opacity-40 hover:opacity-100 transition-opacity">
              <X className="h-4 w-4" style={{ color: "var(--text)" }} />
            </button>
          )}
          <kbd
            className="rounded px-1.5 py-0.5 text-[10px] font-medium opacity-40"
            style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}
          >
            ESC
          </kbd>
        </div>

        {/* results */}
        {results.length > 0 && (
          <ul
            ref={listRef}
            className="max-h-[360px] overflow-y-auto py-1"
            role="listbox"
          >
            {results.map((r, i) => (
              <li
                key={r.id}
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={() => pick(r)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors",
                  i === cursor
                    ? "bg-[color:var(--accent-surface)]"
                    : "hover:bg-[color:var(--surface)]",
                )}
              >
                <PlatformIcon platform={r.platform} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                      {r.name}
                    </span>
                    {r.username && (
                      <span className="truncate text-xs opacity-50" style={{ color: "var(--text)" }}>
                        {r.username}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs opacity-40" style={{ color: "var(--text)" }}>
                    <span className="truncate">{r.groupName}</span>
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-30" style={{ color: "var(--text)" }} />
              </li>
            ))}
          </ul>
        )}

        {/* empty state */}
        {!loading && query.trim() && results.length === 0 && (
          <div className="px-4 py-8 text-center text-sm opacity-40" style={{ color: "var(--text)" }}>
            {t("vault.global_search_empty")}
          </div>
        )}

        {/* hint */}
        {!query && (
          <div className="px-4 py-5 text-center text-xs opacity-30" style={{ color: "var(--text)" }}>
            {t("vault.global_search_hint")}
          </div>
        )}

        {/* footer shortcut hints */}
        {results.length > 0 && (
          <div
            className="flex items-center gap-3 px-4 py-2 text-[10px] opacity-30"
            style={{ borderTop: "1px solid var(--border)", color: "var(--text)" }}
          >
            <span>↑↓ navegar</span>
            <span>↵ abrir grupo</span>
            <span>ESC fechar</span>
          </div>
        )}
      </div>
    </div>
  );
}
