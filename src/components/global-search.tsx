import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Search, X, CornerDownLeft, Layers } from "lucide-react";
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
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
    credentials: "same-origin",
  });
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
  const cls = cn("h-[18px] w-[18px] shrink-0", className);
  switch (platform?.toLowerCase()) {
    case "instagram": return <InstagramIcon className={cls} />;
    case "facebook":  return <FacebookIcon  className={cls} />;
    case "youtube":   return <YouTubeIcon   className={cls} />;
    case "tiktok":    return <TikTokIcon    className={cls} />;
    case "kwai":      return <KwaiIcon      className={cls} />;
    default:          return <Layers        className={cls} />;
  }
}

export function GlobalSearch({ onClose, onNavigate }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mount animation
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

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
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    const li = listRef.current?.children[cursor] as HTMLElement | undefined;
    li?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const close = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 180);
  }, [onClose]);

  const pick = useCallback(
    (result: SearchResult) => {
      onNavigate(result.groupId);
      close();
    },
    [onNavigate, close],
  );

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { close(); return; }
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

  const hasResults = results.length > 0;
  const showEmpty = !loading && query.trim().length > 0 && !hasResults;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[300] flex items-start justify-center px-4 pt-[12vh] transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{
        background: "color-mix(in srgb, var(--overlay) 86%, transparent)",
        backdropFilter: "blur(10px)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        className={cn(
          "global-search-panel w-full max-w-[640px] overflow-hidden rounded-[28px] transition-[transform,opacity] duration-300",
          visible
            ? "translate-y-0 opacity-100"
            : "-translate-y-2 opacity-0",
        )}
      >
        {/* input row */}
        <div className="global-search-input-row flex items-center gap-3 px-5 py-4">
          <div className="global-search-input-shell flex min-w-0 flex-1 items-center gap-3 rounded-[20px] px-4 py-3">
            <span
              className="shrink-0 transition-all duration-200"
              style={{ color: query ? "var(--accent)" : "var(--muted)", opacity: query ? 1 : 0.7 }}
            >
              {loading
                ? <Spinner className="h-[18px] w-[18px]" />
                : <Search className="h-[18px] w-[18px]" />
              }
            </span>

            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder={t("vault.global_search_placeholder")}
              className="min-w-0 flex-1 bg-transparent text-[15px] leading-snug outline-none placeholder:opacity-30"
              style={{ color: "var(--text)" }}
              autoComplete="off"
              spellCheck={false}
            />

            {query ? (
              <button
                onClick={() => setQuery("")}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--muted)] transition-all duration-200 hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]"
                tabIndex={-1}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <kbd className="global-search-esc hidden sm:inline-flex">ESC</kbd>
        </div>

        {/* divider */}
        {(hasResults || showEmpty) && (
          <div
            className="mx-5"
            style={{
              height: 1,
              background: "color-mix(in srgb, var(--border) 72%, transparent)",
            }}
          />
        )}

        {/* results list */}
        {hasResults && (
          <ul
            ref={listRef}
            className="max-h-[352px] overflow-y-auto px-3 py-2"
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
                  "group flex cursor-pointer items-center gap-3 rounded-[18px] px-3.5 py-3 transition-all duration-150",
                  i === cursor
                    ? "bg-[color:var(--accent-surface)] shadow-[0_10px_30px_-24px_var(--accent-glow)]"
                    : "hover:bg-[color:var(--surface-soft)]",
                )}
              >
                {/* platform icon */}
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px]"
                  style={{
                    background: i === cursor
                      ? "color-mix(in srgb, var(--panel) 84%, white 16%)"
                      : "var(--surface-soft)",
                    color: i === cursor ? "var(--accent)" : "var(--muted)",
                    transition: "background 150ms, color 150ms, transform 150ms",
                  }}
                >
                  <PlatformIcon platform={r.platform} />
                </span>

                {/* text */}
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[13px] font-medium leading-tight"
                    style={{ color: "var(--text)" }}
                  >
                    {r.name}
                    {r.username && (
                      <span
                        className="ml-2 font-normal opacity-40"
                        style={{ fontSize: "12px" }}
                      >
                        {r.username}
                      </span>
                    )}
                  </p>
                  <p
                    className="mt-0.5 truncate text-[11px] opacity-35"
                    style={{ color: "var(--text)" }}
                  >
                    {r.groupName}
                  </p>
                </div>

                {/* enter hint — only on active */}
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 transition-opacity duration-100",
                    i === cursor ? "opacity-40" : "opacity-0",
                  )}
                >
                  <CornerDownLeft
                    className="h-3.5 w-3.5"
                    style={{ color: "var(--text)" }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* empty */}
        {showEmpty && (
          <div className="px-5 py-10 text-center">
            <p className="text-[13px] opacity-35" style={{ color: "var(--text)" }}>
              {t("vault.global_search_empty")}
            </p>
          </div>
        )}

        {/* footer */}
        {hasResults && (
          <div
            className="flex items-center gap-4 px-5 py-3"
            style={{
              borderTop: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
              opacity: 0.42,
            }}
          >
            {[
              { keys: ["↑", "↓"], label: "navegar" },
              { keys: ["↵"], label: "ir" },
              { keys: ["ESC"], label: "fechar" },
            ].map(({ keys, label }) => (
              <span
                key={label}
                className="flex items-center gap-1 text-[10px]"
                style={{ color: "var(--text)" }}
              >
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded px-1 py-px text-[10px]"
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {k}
                  </kbd>
                ))}
                <span className="ml-0.5">{label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
