import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Search, X, CornerDownLeft, Layers, Mail } from "lucide-react";
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
  onNavigate: (result: SearchResult) => void;
}

async function fetchResults(q: string): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results ?? [];
  } catch {
    return [];
  } finally {
    window.clearTimeout(timeout);
  }
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
    case "instagram":
      return <InstagramIcon className={cls} />;
    case "facebook":
      return <FacebookIcon className={cls} />;
    case "youtube":
      return <YouTubeIcon className={cls} />;
    case "tiktok":
      return <TikTokIcon className={cls} />;
    case "kwai":
      return <KwaiIcon className={cls} />;
    case "email":
      return <Mail className={cls} />;
    default:
      return <Layers className={cls} />;
  }
}

function platformTileStyle(platform: string | undefined) {
  switch (platform?.toLowerCase()) {
    case "instagram":
      return {
        background:
          "linear-gradient(45deg,#F58529 0%,#FEDA77 20%,#DD2A7B 50%,#8134AF 75%,#515BD4 100%)",
        boxShadow: "0 8px 18px -10px rgba(225, 48, 108, 0.8)",
      };
    case "facebook":
      return {
        background: "linear-gradient(140deg,#1877F2,#1877F2cc)",
        boxShadow: "0 8px 18px -10px rgba(24, 119, 242, 0.8)",
      };
    case "youtube":
      return {
        background: "linear-gradient(140deg,#FF0000,#FF3B30)",
        boxShadow: "0 8px 18px -10px rgba(255, 0, 0, 0.8)",
      };
    case "tiktok":
      return {
        background: "linear-gradient(140deg,#27272b,#0a0a0c)",
        boxShadow: "0 8px 18px -10px rgba(15, 23, 42, 0.9)",
      };
    case "kwai":
      return {
        background: "linear-gradient(140deg,#FF6A00,#FF8A00)",
        boxShadow: "0 8px 18px -10px rgba(255, 106, 0, 0.8)",
      };
    case "email":
      return {
        background: "linear-gradient(140deg,#3B82F6,#2563EB)",
        boxShadow: "0 8px 18px -10px rgba(59, 130, 246, 0.8)",
      };
    default:
      return {
        background: "linear-gradient(140deg,var(--accent),var(--accent-hover))",
        boxShadow: "0 8px 18px -10px var(--accent-glow)",
      };
  }
}

function SearchingLoader() {
  return (
    <div className="search-loader-wrapper">
      <div className="search-loader" />
      <div className="search-letter-wrapper" aria-label="Buscando">
        {"Buscando".split("").map((ch, i) => (
          <span key={i} className="search-loader-letter">
            {ch}
          </span>
        ))}
      </div>
    </div>
  );
}

export function GlobalSearch({ onClose, onNavigate }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [visible, setVisible] = useState(false);
  // Incrementa a cada tecla digitada; usado como `key` da barra de baixo pra
  // remontá-la e reativar a animação de varredura a cada letra.
  const [pulse, setPulse] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

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
    const requestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetchResults(q);
        if (requestId !== requestIdRef.current) return;
        setResults(res);
        setCursor(0);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
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
      onNavigate(result);
      close();
    },
    [onNavigate, close],
  );

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      close();
      return;
    }
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
  const showLoader = loading && query.trim().length > 0;
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
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={cn(
          "global-search-panel w-full max-w-[960px] overflow-visible transition-[transform,opacity] duration-300",
          visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
        )}
      >
        {/* input row */}
        <div className="global-search-input-row flex items-center px-4 py-4 sm:px-5 sm:py-5">
          <div className="global-search-input-shell flex min-w-0 flex-1 items-center gap-3 px-4 py-3 sm:px-4.5 sm:py-3.5">
            <span
              className="global-search-icon shrink-0 transition-all duration-200"
              style={{ opacity: query ? 0.92 : 0.56 }}
            >
              {loading ? (
                <Spinner className="h-[18px] w-[18px]" />
              ) : (
                <Search className="h-[18px] w-[18px]" />
              )}
            </span>

            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPulse((p) => p + 1);
              }}
              onKeyDown={onKey}
              placeholder={t("vault.global_search_placeholder")}
              className="global-search-input min-w-0 flex-1 bg-transparent text-[15px] leading-snug outline-none placeholder:opacity-30"
              style={{ color: "var(--text)" }}
              autoComplete="off"
              spellCheck={false}
            />

            {query ? (
              <button
                onClick={() => setQuery("")}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--muted)] transition-colors duration-150 hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]"
                tabIndex={-1}
              >
                <X className="icon-crisp close-glyph h-[18px] w-[18px]" />
              </button>
            ) : null}

            {/* Barra de baixo: remonta a cada tecla (key={pulse}) e dispara uma
                varredura de luz verde — feedback por letra digitada. */}
            {query ? (
              <span
                key={pulse}
                aria-hidden
                className="global-search-typing-bar"
              />
            ) : null}
          </div>
        </div>

        {/* divider */}
        {(hasResults || showEmpty || showLoader) && (
          <div
            className="mx-5"
            style={{
              height: 1,
              background: "color-mix(in srgb, var(--border) 72%, transparent)",
            }}
          />
        )}

        {/* loading */}
        {showLoader && (
          <div className="px-5 py-10">
            <SearchingLoader />
          </div>
        )}

        {/* results list */}
        {hasResults && !showLoader && (
          <ul
            ref={listRef}
            className="max-h-[352px] overflow-y-auto px-2.5 py-2"
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
                  "group flex cursor-pointer items-center gap-3 rounded-2xl px-3.5 py-3 transition-colors duration-150",
                  i === cursor
                    ? "bg-[color:var(--surface-soft)]"
                    : "hover:bg-[color:var(--surface-soft)]",
                )}
              >
                {/* platform icon */}
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px]"
                  style={{
                    ...platformTileStyle(r.platform),
                    color: "#fff",
                    transition: "background 150ms, color 150ms",
                  }}
                >
                  <PlatformIcon
                    platform={r.platform}
                    className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]"
                  />
                </span>

                {/* text */}
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[13px] font-medium leading-tight"
                    style={{ color: "var(--text)" }}
                  >
                    {r.label}
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
            <p
              className="text-[13px] opacity-35"
              style={{ color: "var(--text)" }}
            >
              {t("vault.global_search_empty")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
