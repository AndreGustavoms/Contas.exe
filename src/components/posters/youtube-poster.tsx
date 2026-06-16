import {
  type ChangeEvent,
  type ReactNode,
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
  FileVideo2,
  Plus,
  Shield,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { YouTubeIcon } from "../platform-icons";

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

function fmtConnectedAt(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ videoId: string } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const selectedChannel =
    channels?.find((channel) => channel.id === channelId) ?? null;

  function updateSchedulePart(part: "date" | "time", value: string) {
    const nextDate = part === "date" ? value : scheduleDate;
    const nextTime = part === "time" ? value : scheduleTime;
    setScheduleDate(nextDate);
    setScheduleTime(nextTime);
    setSchedule(nextDate && nextTime ? `${nextDate}T${nextTime}` : "");
  }

  function clearSchedule() {
    setScheduleDate("");
    setScheduleTime("");
    setSchedule("");
  }

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

  if (channels === null) {
    return <div className="skeleton h-40 w-full rounded-2xl" />;
  }

  if (channels.length === 0) {
    return (
      <div className="grid place-items-center gap-4 rounded-2xl border border-dashed border-[color:var(--border)] p-12 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-500">
          <YouTubeIcon className="h-7 w-7" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-[color:var(--text)]">
            {t("post.youtube.connect_title")}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-[color:var(--muted)]">
            {t("post.youtube.connect_desc")}
          </p>
        </div>
        <a className="login-btn-primary px-6" href="/api/youtube/connect">
          {t("post.youtube.connect_btn")}
        </a>
      </div>
    );
  }

  if (done) {
    return (
      <div className="grid place-items-center gap-4 py-12 text-center">
        <CheckCircle2 className="h-10 w-10 text-[color:var(--accent)]" />
        <h2 className="text-lg font-semibold text-[color:var(--text)]">
          {t("post.youtube.success")}
        </h2>
        <div className="flex gap-3">
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
            onClick={() => {
              setDone(null);
              setChannelId("");
              setFile(null);
              setTitle("");
              setDescription("");
              setTags("");
              clearSchedule();
            }}
          >
            {t("post.youtube.new_post")}
          </Button>
        </div>
        <div className="w-full border-t border-[color:var(--border)] pt-5 text-left">
          <HistoryList items={history} />
        </div>
      </div>
    );
  }

  const fieldCls =
    "h-11 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-4 text-sm text-[color:var(--text)] outline-none transition-all duration-200 placeholder:text-[color:var(--muted-soft)] focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20";

  const SectionLabel = ({
    dot,
    children,
  }: {
    dot?: "red" | "accent";
    children: ReactNode;
  }) => (
    <span className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[color:var(--muted-soft)]">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          dot === "red"
            ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]"
            : "bg-[color:var(--accent)] shadow-[0_0_6px_var(--accent-glow)]",
        )}
      />
      {children}
    </span>
  );

  return (
    <div>
      {/* ── Canal ── */}
      <section className="pb-6">
        <div className="flex items-center justify-between">
          <SectionLabel dot="red">{t("post.youtube.channel")}</SectionLabel>
          <a
            className="mb-3 inline-flex h-7 items-center gap-1.5 rounded-lg border border-[color:var(--border)] px-3 text-[11px] font-semibold text-[color:var(--muted)] transition-all duration-200 hover:border-[color:var(--accent-border)] hover:bg-[color:var(--accent-surface)] hover:text-[color:var(--accent-soft)]"
            href="/api/youtube/connect"
          >
            <Plus className="h-3 w-3" />
            {t("post.youtube.connect_another")}
          </a>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {channels.map((channel) => {
            const selected = channel.id === channelId;
            return (
              <button
                key={channel.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setChannelId(channel.id)}
                className={cn(
                  "group relative flex items-center gap-3 overflow-hidden rounded-xl border px-4 py-3 text-left transition-all duration-200",
                  selected
                    ? "border-red-500/25 bg-gradient-to-r from-red-500/10 to-transparent"
                    : "border-[color:var(--border)] hover:border-red-500/20 hover:bg-red-500/5",
                )}
              >
                {selected && (
                  <div className="absolute left-0 top-0 h-full w-0.5 rounded-r bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]" />
                )}
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
                    selected
                      ? "bg-red-500 text-white shadow-[0_6px_20px_-6px_rgba(239,68,68,0.8)]"
                      : "bg-red-500/10 text-red-500 group-hover:bg-red-500/15",
                  )}
                >
                  <YouTubeIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[color:var(--text)]">
                    {channel.title}
                  </span>
                  <span className="block text-[11px] text-[color:var(--muted)]">
                    {fmtConnectedAt(channel.connectedAt)}
                  </span>
                </span>
                {selected && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-red-400/80" />
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Vídeo ── */}
      <section className="border-t border-[color:var(--border)] py-6">
        <SectionLabel>{t("post.youtube.video")}</SectionLabel>
        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={pickFile} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "group flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-9 transition-all duration-300",
            file
              ? "border-[color:var(--accent-border)] bg-[color:var(--accent-surface)]"
              : "border-[color:var(--border)] hover:border-[color:var(--accent-border)] hover:bg-[color:var(--accent-surface)]",
          )}
        >
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl transition-all duration-300",
              file
                ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)] shadow-[0_8px_28px_-8px_var(--accent)]"
                : "border border-[color:var(--border)] text-[color:var(--muted)] group-hover:border-[color:var(--accent-border)] group-hover:text-[color:var(--accent)] group-hover:shadow-[0_0_20px_var(--accent-glow)]",
            )}
          >
            <Upload className="h-5 w-5" />
          </span>
          <div className="text-center">
            <p className="text-sm font-semibold text-[color:var(--text)]">
              {file ? file.name : t("post.youtube.choose_file")}
            </p>
            <p className="mt-0.5 text-xs text-[color:var(--muted)]">
              {file ? fmtSize(file.size) : t("post.youtube.choose_hint")}
            </p>
          </div>
        </button>

        {previewUrl && (
          <div className="mt-3 overflow-hidden rounded-xl border border-[color:var(--accent-border)] bg-black shadow-[0_8px_32px_-8px_var(--accent-glow)]">
            <video
              src={previewUrl}
              className="max-h-56 w-full object-contain"
              controls
              muted
            />
          </div>
        )}
      </section>

      {/* ── Conteúdo ── */}
      <section className="border-t border-[color:var(--border)] py-6 grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-[11px] font-semibold text-[color:var(--muted)]">
            {t("post.youtube.field_title")}
          </span>
          <input className={fieldCls} maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label className="grid gap-1.5">
          <span className="text-[11px] font-semibold text-[color:var(--muted)]">
            {t("post.youtube.field_description")}
          </span>
          <textarea
            className="min-h-28 w-full resize-y rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-4 py-3 text-sm text-[color:var(--text)] outline-none transition-all duration-200 focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20"
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-[11px] font-semibold text-[color:var(--muted)]">
            {t("post.youtube.field_tags")}
          </span>
          <input
            className={fieldCls}
            placeholder={t("post.youtube.tags_placeholder")}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </label>
      </section>

      {/* ── Privacidade + Agendamento ── */}
      <section className="border-t border-[color:var(--border)] py-6 grid gap-5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--muted)]">
            <Shield className="h-3.5 w-3.5" />
            {t("post.youtube.privacy")}
          </span>
          <select
            className={cn(fieldCls, "cursor-pointer")}
            value={privacy}
            disabled={Boolean(schedule)}
            onChange={(e) => setPrivacy(e.target.value as Privacy)}
          >
            <option value="private">{t("post.youtube.privacy_private")}</option>
            <option value="unlisted">{t("post.youtube.privacy_unlisted")}</option>
            <option value="public">{t("post.youtube.privacy_public")}</option>
          </select>
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--muted)]">
              <Calendar className="h-3.5 w-3.5" />
              {t("post.youtube.schedule")}
            </span>
            {schedule ? (
              <button
                className="text-[11px] font-semibold text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
                type="button"
                onClick={clearSchedule}
              >
                Limpar
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="Data" type="date" className={fieldCls} value={scheduleDate} onChange={(e) => updateSchedulePart("date", e.target.value)} />
            <input aria-label="Hora" type="time" className={fieldCls} value={scheduleTime} onChange={(e) => updateSchedulePart("time", e.target.value)} />
          </div>
          {schedule ? (
            <p className="text-[11px] text-[color:var(--muted)]">{t("post.youtube.schedule_note")}</p>
          ) : null}
        </div>
      </section>

      {/* ── Progresso ── */}
      {progress !== null ? (
        <div className="border-t border-[color:var(--border)] py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-[color:var(--muted)]">
              {t("post.youtube.uploading", { percent: Math.round(progress * 100) })}
            </span>
            <span className="font-mono text-[11px] font-bold text-[color:var(--accent)]">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-[color:var(--field)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[color:var(--accent)] to-[color:var(--accent-hover)] shadow-[0_0_8px_var(--accent-glow)] transition-all duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* ── Publicar ── */}
      <section className="border-t border-[color:var(--border)] pt-6 grid gap-3">
        {error ? <p className="text-sm font-medium text-red-400">{error}</p> : null}
        <button
          type="button"
          disabled={busy}
          onClick={publish}
          className="group relative flex h-12 w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl bg-[color:var(--accent)] text-sm font-bold tracking-wide text-[color:var(--accent-foreground)] shadow-[0_16px_40px_-16px_var(--accent)] transition-all duration-300 hover:brightness-110 hover:shadow-[0_20px_48px_-16px_var(--accent)] disabled:opacity-50 disabled:shadow-none"
        >
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          {busy ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
          {busy
            ? progress !== null
              ? t("post.youtube.uploading", { percent: Math.round((progress ?? 0) * 100) })
              : t("post.youtube.publishing")
            : schedule
              ? t("post.youtube.schedule_btn")
              : t("post.youtube.publish")}
        </button>
      </section>

      <HistoryList items={history} />
    </div>
  );
}

function HistoryList({ items }: { items: HistoryItem[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <section className="border-t border-[color:var(--border)] pt-5 mt-5">
      <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
        <Clock className="h-3 w-3" />
        {t("post.youtube.history")}
      </p>
      <ul className="grid gap-2">
        {items.map((item, i) => (
          <li
            key={`${item.videoId ?? "v"}-${i}`}
            className="flex items-center gap-3 rounded-xl border border-[color:var(--border)] p-2.5"
          >
            <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-[color:var(--surface-soft)]">
              {item.thumbnailUrl ? (
                <img alt="" className="h-full w-full object-cover" loading="lazy" src={item.thumbnailUrl} />
              ) : null}
              {item.durationSeconds ? (
                <span className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 text-[10px] tabular-nums text-white">
                  {fmtDuration(item.durationSeconds)}
                </span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[color:var(--text)]">{item.title}</p>
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
