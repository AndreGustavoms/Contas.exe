import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

// Painel de publicação no YouTube. Fluxo: escolher canal conectado, enviar o
// vídeo do navegador (streaming pro servidor, com progresso) e publicar com
// título/descrição/tags, privado/não listado/público OU agendado.

type Channel = { id: string; title: string; connectedAt: string };
type Privacy = "public" | "unlisted" | "private";

type HistoryItem = {
  videoId: string | null;
  title: string;
  description?: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  uploadedAt: string;
  privacyStatus?: string;
};

function fmtDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Envia o arquivo via XHR para acompanhar o progresso (fetch não expõe upload
// progress). Resolve com o nome já preparado no servidor.
function uploadVideoFile(
  file: File,
  onProgress: (fraction: number) => void,
): Promise<{ name: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/youtube/uploads");
    xhr.setRequestHeader(
      "X-Upload-Filename",
      encodeURIComponent(file.name || "video"),
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("bad_response"));
        }
      } else {
        reject(new Error(`http_${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(file);
  });
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function YouTubePoster() {
  const { t } = useTranslation();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [channelId, setChannelId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [privacy, setPrivacy] = useState<Privacy>("private");
  const [schedule, setSchedule] = useState("");

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ videoId: string } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(() => {
    fetch("/api/youtube/history")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: HistoryItem[] }) => setHistory(d.items ?? []))
      .catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    fetch("/api/youtube/channels")
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .then((d: { channels?: Channel[] }) => {
        const list = d.channels ?? [];
        setChannels(list);
        if (list[0]) setChannelId(list[0].id);
      })
      .catch(() => setChannels([]));
    loadHistory();
  }, [loadHistory]);

  function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setDone(null);
    setError("");
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }

  async function publish() {
    setError("");
    if (!channelId) return setError(t("post.youtube.error_no_channel"));
    if (!file) return setError(t("post.youtube.error_no_file"));
    if (!title.trim()) return setError(t("post.youtube.error_no_title"));

    let publishAt: string | undefined;
    if (schedule) {
      const when = new Date(schedule);
      if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        return setError(t("post.youtube.error_schedule_past"));
      }
      publishAt = when.toISOString();
    }

    setBusy(true);
    try {
      setProgress(0);
      const staged = await uploadVideoFile(file, setProgress);
      setProgress(null);

      const res = await fetch("/api/youtube/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          file: staged.name,
          title: title.trim(),
          description,
          tags: tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          publishAt,
          privacyStatus: privacy,
        }),
      });
      if (!res.ok) throw new Error("publish_failed");
      const data: { videoId: string } = await res.json();
      setDone({ videoId: data.videoId });
      loadHistory();
    } catch (err) {
      setError(
        err instanceof Error && err.message === "file_too_large"
          ? t("post.youtube.error_too_large")
          : t("post.youtube.error"),
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  // Carregando canais.
  if (channels === null) {
    return <div className="skeleton h-40 w-full rounded-2xl" />;
  }

  // Nenhum canal conectado: CTA de conexão.
  if (channels.length === 0) {
    return (
      <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-[color:var(--border)] p-10 text-center">
        <h2 className="text-lg font-semibold text-[color:var(--text)]">
          {t("post.youtube.connect_title")}
        </h2>
        <p className="max-w-sm text-sm text-[color:var(--muted)]">
          {t("post.youtube.connect_desc")}
        </p>
        <a className="login-btn-primary mt-1 px-5" href="/api/youtube/connect">
          {t("post.youtube.connect_btn")}
        </a>
      </div>
    );
  }

  // Sucesso.
  if (done) {
    return (
      <div className="grid place-items-center gap-3 rounded-2xl border border-[color:var(--border)] p-10 text-center">
        <CheckCircle2 className="h-10 w-10 text-[color:var(--accent)]" />
        <h2 className="text-lg font-semibold text-[color:var(--text)]">
          {t("post.youtube.success")}
        </h2>
        <a
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--accent)] hover:underline"
          href={`https://studio.youtube.com/video/${done.videoId}/edit`}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink className="h-4 w-4" />
          {t("post.youtube.view")}
        </a>
        <Button
          variant="outline"
          className="mt-2"
          onClick={() => {
            setDone(null);
            setFile(null);
            setTitle("");
            setDescription("");
            setTags("");
            setSchedule("");
          }}
        >
          {t("post.youtube.new_post")}
        </Button>

        <div className="w-full pt-2 text-left">
          <HistoryList items={history} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-[color:var(--text)]">
          {t("post.youtube.heading")}
        </h1>
        <p className="text-sm text-[color:var(--muted)]">
          {t("post.youtube.subtitle")}
        </p>
      </header>

      {/* Canal */}
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-[color:var(--muted)]">
          {t("post.youtube.channel")}
        </span>
        <select
          className="login-input h-11 rounded-xl px-3"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>

      {/* Vídeo */}
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-[color:var(--muted)]">
          {t("post.youtube.video")}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={pickFile}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-3 rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--field)] px-4 py-3 text-left transition hover:border-[color:var(--accent)]"
        >
          <Upload className="h-5 w-5 shrink-0 text-[color:var(--muted)]" />
          <span className="min-w-0">
            <span className="block truncate text-sm text-[color:var(--text)]">
              {file ? file.name : t("post.youtube.choose_file")}
            </span>
            <span className="block text-xs text-[color:var(--muted)]">
              {file ? fmtSize(file.size) : t("post.youtube.choose_hint")}
            </span>
          </span>
        </button>
      </div>

      {/* Título */}
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-[color:var(--muted)]">
          {t("post.youtube.field_title")}
        </span>
        <input
          className="login-input h-11 rounded-xl px-3"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      {/* Descrição */}
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-[color:var(--muted)]">
          {t("post.youtube.field_description")}
        </span>
        <textarea
          className="login-input min-h-[96px] rounded-xl px-3 py-2"
          maxLength={5000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      {/* Tags */}
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-[color:var(--muted)]">
          {t("post.youtube.field_tags")}
        </span>
        <input
          className="login-input h-11 rounded-xl px-3"
          placeholder={t("post.youtube.tags_placeholder")}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
      </label>

      {/* Privacidade + agendamento */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[color:var(--muted)]">
            {t("post.youtube.privacy")}
          </span>
          <select
            className="login-input h-11 rounded-xl px-3 disabled:opacity-50"
            value={privacy}
            disabled={Boolean(schedule)}
            onChange={(e) => setPrivacy(e.target.value as Privacy)}
          >
            <option value="private">{t("post.youtube.privacy_private")}</option>
            <option value="unlisted">
              {t("post.youtube.privacy_unlisted")}
            </option>
            <option value="public">{t("post.youtube.privacy_public")}</option>
          </select>
        </label>

        <label className="grid gap-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--muted)]">
            <Calendar className="h-3.5 w-3.5" />
            {t("post.youtube.schedule")}
          </span>
          <input
            type="datetime-local"
            className="login-input h-11 rounded-xl px-3"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
          />
        </label>
      </div>
      {schedule ? (
        <p className="-mt-2 text-xs text-[color:var(--muted)]">
          {t("post.youtube.schedule_note")}
        </p>
      ) : null}

      {progress !== null ? (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--field)]">
            <div
              className="h-full rounded-full bg-[color:var(--accent)] transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="text-xs text-[color:var(--muted)]">
            {t("post.youtube.uploading", {
              percent: Math.round(progress * 100),
            })}
          </p>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Button
        className={cn("login-btn-primary w-full", busy && "opacity-80")}
        disabled={busy}
        onClick={publish}
      >
        {busy ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {busy
          ? progress !== null
            ? t("post.youtube.uploading", {
                percent: Math.round((progress ?? 0) * 100),
              })
            : t("post.youtube.publishing")
          : schedule
            ? t("post.youtube.schedule_btn")
            : t("post.youtube.publish")}
      </Button>

      <HistoryList items={history} />
    </div>
  );
}

// Histórico de uploads (metadados — o vídeo nunca fica salvo no Contas).
function HistoryList({ items }: { items: HistoryItem[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <section className="mt-2 border-t border-[color:var(--border)] pt-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[color:var(--text)]">
        <Clock className="h-4 w-4 text-[color:var(--muted)]" />
        {t("post.youtube.history")}
      </h2>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li
            key={`${item.videoId ?? "v"}-${i}`}
            className="flex items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] p-2.5"
          >
            <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-md bg-[color:var(--surface-soft)]">
              {item.thumbnailUrl ? (
                <img
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  src={item.thumbnailUrl}
                />
              ) : null}
              {item.durationSeconds ? (
                <span className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 text-[10px] font-medium tabular-nums text-white">
                  {fmtDuration(item.durationSeconds)}
                </span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[color:var(--text)]">
                {item.title}
              </p>
              {item.description ? (
                <p className="truncate text-xs text-[color:var(--muted)]">
                  {item.description}
                </p>
              ) : null}
              <p className="text-[11px] text-[color:var(--muted)]">
                {new Date(item.uploadedAt).toLocaleString()}
              </p>
            </div>
            {item.videoId ? (
              <a
                aria-label={t("post.youtube.view")}
                className="shrink-0 text-[color:var(--muted)] transition hover:text-[color:var(--accent)]"
                href={`https://studio.youtube.com/video/${item.videoId}/edit`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
