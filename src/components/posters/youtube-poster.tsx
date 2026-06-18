import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clapperboard,
  Clock,
  ExternalLink,
  FileVideo2,
  Pencil,
  Plus,
  Shield,
  Trash2,
  Upload,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { DatePicker } from "../ui/date-picker";
import { TimePicker } from "../ui/time-picker";
import { Select } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { YouTubeIcon } from "../platform-icons";

type Channel = { id: string; title: string; connectedAt: string };
type Privacy = "public" | "unlisted" | "private";
type VideoType = "video" | "short" | "community";

type HistoryItem = {
  videoId: string | null;
  channelId?: string;
  title: string;
  description?: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  uploadedAt: string;
  privacyStatus?: string;
  publishAt?: string | null;
};

type VideoMetadata = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

type UploadIssue = {
  title: string;
  message: string;
  userMessage?: string;
  source?: "youtube" | "local" | "network";
  status?: number;
  reason?: string;
  retryable?: boolean;
};

type UploadErrorPayload = {
  error?: string;
  source?: "youtube" | "local" | "network";
  status?: number;
  reason?: string;
  message?: string;
  userMessage?: string;
  retryable?: boolean;
};

class UploadRequestError extends Error {
  status: number;
  payload: UploadErrorPayload;

  constructor(status: number, payload: UploadErrorPayload) {
    super(payload.message || payload.error || `http_${status}`);
    this.name = "UploadRequestError";
    this.status = status;
    this.payload = payload;
  }
}

const YOUTUBE_MAX_UPLOAD_BYTES = 256 * 1024 * 1024 * 1024;
const YOUTUBE_MAX_DURATION_SECONDS = 12 * 60 * 60;
const YOUTUBE_SHORT_MAX_SECONDS = 3 * 60;

type Translate = (key: string, opts?: Record<string, unknown>) => string;

function parseJson(text: string): UploadErrorPayload {
  try {
    const parsed = JSON.parse(text) as UploadErrorPayload;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function fmtDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// 1 MB chunks: small enough that no single request body trips Railway's edge
// proxy (which resets even a few-MB streamed body — the real cause of the
// "Falha de rede / 0" seen on tiny files), large enough to keep request count
// sane. Each chunk goes to a fixed byte offset, so a retried chunk overwrites a
// half-written attempt instead of duplicating it.
const CHUNK_SIZE = 1024 * 1024;
const CHUNK_RETRIES = 4;

// Hex-32 id usable in any context (crypto.randomUUID is HTTPS-only; getRandomValues
// is universal). The server validates /^[a-f0-9]{32}$/.
function makeUploadId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sendChunk(
  uploadId: string,
  filename: string,
  offset: number,
  chunk: Blob,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/youtube/uploads/chunk");
    xhr.setRequestHeader("X-Upload-Id", uploadId);
    xhr.setRequestHeader("X-Chunk-Offset", String(offset));
    xhr.setRequestHeader("X-Upload-Filename", encodeURIComponent(filename));
    xhr.timeout = 60_000; // 1 MB should take seconds; a stall means retry
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new UploadRequestError(xhr.status, parseJson(xhr.responseText)));
    };
    xhr.onerror = () =>
      reject(new UploadRequestError(0, { error: "network", source: "network", message: "network" }));
    xhr.ontimeout = () =>
      reject(new UploadRequestError(0, { error: "timeout", source: "network", message: "timeout" }));
    xhr.send(chunk);
  });
}

async function sendChunkWithRetry(
  uploadId: string,
  filename: string,
  offset: number,
  chunk: Blob,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CHUNK_RETRIES; attempt++) {
    try {
      await sendChunk(uploadId, filename, offset, chunk);
      return;
    } catch (err) {
      lastErr = err;
      const status = err instanceof UploadRequestError ? err.status : -1;
      // Only transient failures are worth retrying (connection reset / 5xx).
      // A 4xx is a hard rejection — stop immediately.
      const transient = status === 0 || (status >= 500 && status < 600);
      if (!transient || attempt === CHUNK_RETRIES) break;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

async function uploadVideoFile(
  file: File,
  onProgress: (fraction: number) => void,
): Promise<{ name: string; size: number }> {
  const uploadId = makeUploadId();
  const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  for (let i = 0; i < total; i++) {
    const offset = i * CHUNK_SIZE;
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    try {
      await sendChunkWithRetry(uploadId, file.name || "video", offset, chunk);
    } catch (err) {
      // Surface a precise, actionable diagnosis instead of a generic "Falha de rede".
      if (err instanceof UploadRequestError) {
        const serverDetail = err.payload.message ? ` Detalhe: ${err.payload.message}.` : "";
        err.payload.source = "network";
        err.payload.userMessage =
          err.status === 0
            ? `O envio foi interrompido ao transferir o trecho em ${fmtSize(offset)} (a conexão caiu antes da resposta do servidor). Tente novamente — se persistir, o proxy do servidor está recusando o upload.`
            : `O servidor recusou o trecho em ${fmtSize(offset)} (código ${err.status}).${serverDetail} Tente novamente.`;
      }
      throw err;
    }
    onProgress((i + 1) / total);
  }

  const res = await fetch("/api/youtube/uploads/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ uploadId, originalName: file.name || "video" }),
  });
  if (!res.ok) {
    throw new UploadRequestError(res.status, parseJson(await res.text()));
  }
  return res.json();
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

function readVideoMetadata(file: File): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (value: VideoMetadata | null) => {
      window.clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timeout = window.setTimeout(() => done(null), 5000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      done({
        durationSeconds: Number.isFinite(video.duration)
          ? video.duration
          : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
    };
    video.onerror = () => done(null);
    video.src = url;
  });
}

function fileLooksLikeAudio(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  return /\.(mp3|wav|pcm|aac|m4a|flac|ogg)$/i.test(file.name);
}

function localUploadIssue(
  t: Translate,
  message: string,
  userMessage?: string,
): UploadIssue {
  return {
    title: t("post.youtube.error_modal_local_title"),
    source: "local",
    message,
    userMessage,
  };
}

function validateVideoBeforeUpload(
  file: File,
  metadata: VideoMetadata | null,
  videoType: VideoType,
  t: Translate,
): UploadIssue | null {
  if (fileLooksLikeAudio(file)) {
    return localUploadIssue(
      t,
      t("post.youtube.error_audio_file"),
      t("post.youtube.error_audio_file_hint"),
    );
  }
  if (
    file.type &&
    file.type !== "application/octet-stream" &&
    !file.type.startsWith("video/")
  ) {
    return localUploadIssue(t, t("post.youtube.error_not_video"));
  }
  if (file.size > YOUTUBE_MAX_UPLOAD_BYTES) {
    return localUploadIssue(
      t,
      t("post.youtube.error_youtube_too_large"),
      t("post.youtube.error_youtube_too_large_hint"),
    );
  }
  if (
    metadata?.durationSeconds &&
    metadata.durationSeconds > YOUTUBE_MAX_DURATION_SECONDS
  ) {
    return localUploadIssue(
      t,
      t("post.youtube.error_youtube_too_long"),
      t("post.youtube.error_youtube_too_long_hint"),
    );
  }
  if (videoType === "short") {
    if (
      metadata?.durationSeconds == null ||
      metadata.width == null ||
      metadata.height == null
    ) {
      return localUploadIssue(
        t,
        t("post.youtube.error_short_metadata"),
        t("post.youtube.error_short_metadata_hint"),
      );
    }
    if (
      metadata?.durationSeconds &&
      metadata.durationSeconds > YOUTUBE_SHORT_MAX_SECONDS
    ) {
      return localUploadIssue(
        t,
        t("post.youtube.error_short_too_long"),
        t("post.youtube.error_short_too_long_hint"),
      );
    }
    if (
      metadata?.width &&
      metadata?.height &&
      metadata.width > metadata.height
    ) {
      return localUploadIssue(
        t,
        t("post.youtube.error_short_landscape"),
        t("post.youtube.error_short_landscape_hint"),
      );
    }
  }
  return null;
}

function issueFromError(error: unknown, t: Translate): UploadIssue {
  if (error instanceof UploadRequestError) {
    const payload = error.payload;
    const source = payload.source ?? "local";
    return {
      title:
        source === "youtube"
          ? t("post.youtube.error_modal_youtube_title")
          : t("post.youtube.error_modal_local_title"),
      source,
      status: payload.status ?? (error.status > 0 ? error.status : undefined),
      reason: payload.reason,
      retryable: payload.retryable,
      message:
        payload.message ||
        (source === "youtube"
          ? t("post.youtube.error_youtube_unknown")
          : t("post.youtube.error")),
      userMessage: payload.userMessage,
    };
  }
  if (error instanceof Error && error.message === "bad_response") {
    return localUploadIssue(t, t("post.youtube.error_bad_response"));
  }
  return localUploadIssue(t, t("post.youtube.error"));
}

type Tab = "post" | "history";
type FieldKey = "channel" | "file" | "title" | "schedule";

// Re-add the shake class after a forced reflow so the animation replays even
// when the same field fails twice in a row.
function triggerShake(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove("field-shake");
  void el.offsetWidth;
  el.classList.add("field-shake");
}

export function YouTubePoster() {
  const { t } = useTranslation();

  const [tab, setTab] = useState<Tab>("post");
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [channelId, setChannelId] = useState("");
  const [channelToDisconnect, setChannelToDisconnect] = useState<Channel | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [videoType, setVideoType] = useState<VideoType>("video");

  // Video / Short
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [privacy, setPrivacy] = useState<Privacy>("private");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [schedule, setSchedule] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [scheduleDate, setScheduleDate] = useState(today);
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [videoDim, setVideoDim] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [uploadIssue, setUploadIssue] = useState<UploadIssue | null>(null);
  const [fieldError, setFieldError] = useState<{
    field: FieldKey;
    message: string;
  } | null>(null);
  const [done, setDone] = useState<{ videoId: string } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const channelSectionRef = useRef<HTMLDivElement>(null);
  const fileButtonRef = useRef<HTMLButtonElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const scheduleSectionRef = useRef<HTMLElement>(null);

  // Mark a field as invalid: scroll it into view, replay the shake, focus the
  // input when there is one, and surface the message next to the field instead
  // of above the publish button.
  const failField = useCallback((field: FieldKey, message: string) => {
    setError("");
    setFieldError({ field, message });
    const target =
      field === "channel"
        ? channelSectionRef.current
        : field === "file"
          ? fileButtonRef.current
          : field === "title"
            ? titleInputRef.current
            : scheduleSectionRef.current;
    const shakeTarget =
      field === "channel"
        ? channelSectionRef.current
        : field === "schedule"
          ? scheduleSectionRef.current
          : target;
    requestAnimationFrame(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      triggerShake(shakeTarget);
      if (field === "title") titleInputRef.current?.focus();
    });
  }, []);

  const clearFieldError = useCallback((field: FieldKey) => {
    setFieldError((prev) => (prev?.field === field ? null : prev));
  }, []);

  useEffect(() => {
    setVideoDuration(null);
    if (!file) {
      setPreviewUrl(null);
      setVideoDim(null);
      setVideoDuration(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setVideoDim(null);
    setVideoDuration(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

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

  // reconcile=true cross-checks YouTube and drops videos deleted there. The bare
  // call is instant (cached) — used for first paint; reconcile runs after / on poll.
  const loadHistory = useCallback((reconcile = false) => {
    fetch(`/api/youtube/history${reconcile ? "?reconcile=1" : ""}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: HistoryItem[] }) => setHistory(d.items ?? []))
      .catch(() => setHistory([]));
  }, []);

  const loadChannels = useCallback(() => {
    return fetch("/api/youtube/channels")
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .then((d: { channels?: Channel[] }) => setChannels(d.channels ?? []))
      .catch(() => setChannels([]));
  }, []);

  useEffect(() => {
    loadChannels();
    loadHistory(); // instant cached paint
    loadHistory(true); // then reconcile in the background
  }, [loadChannels, loadHistory]);

  // While the confirm modal is open, freeze the background scroll and allow Esc
  // to dismiss it (unless a disconnect is in flight).
  useEffect(() => {
    if (!channelToDisconnect) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !disconnecting) setChannelToDisconnect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [channelToDisconnect, disconnecting]);

  async function confirmDisconnect() {
    if (!channelToDisconnect) return;
    setDisconnecting(true);
    try {
      await fetch(
        `/api/youtube/channels/${encodeURIComponent(channelToDisconnect.id)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (channelId === channelToDisconnect.id) setChannelId("");
      await loadChannels();
      setChannelToDisconnect(null);
    } finally {
      setDisconnecting(false);
    }
  }

  // Keep the history live: while it's on screen, re-check against YouTube on a
  // light interval and whenever the tab/window regains focus, so a video deleted
  // directly on YouTube disappears here on its own.
  useEffect(() => {
    if (tab !== "history") return;
    loadHistory(true);
    const onFocus = () => loadHistory(true);
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(() => loadHistory(true), 25_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, [tab, loadHistory]);

  function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setDone(null);
    setError("");
    setUploadIssue(null);
    if (f) setFieldError((prev) => (prev?.field === "file" ? null : prev));
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }

  function removeFile() {
    setFile(null);
    setVideoDim(null);
    setVideoDuration(null);
    setError("");
    setUploadIssue(null);
    // Clear the input so re-picking the SAME file fires onChange again.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function publish() {
    setError("");
    setUploadIssue(null);
    setFieldError(null);
    if (!channelId)
      return failField("channel", t("post.youtube.error_no_channel"));
    if (!file) return failField("file", t("post.youtube.error_no_file"));
    if (!title.trim())
      return failField("title", t("post.youtube.error_no_title"));

    let publishAt: string | undefined;
    if (schedule) {
      const when = new Date(schedule);
      if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        return failField("schedule", t("post.youtube.error_schedule_past"));
      }
      publishAt = when.toISOString();
    }

    const metadata =
      videoDim || videoDuration !== null
        ? {
            durationSeconds: videoDuration,
            width: videoDim?.w ?? null,
            height: videoDim?.h ?? null,
          }
        : await readVideoMetadata(file);
    const localIssue = validateVideoBeforeUpload(file, metadata, videoType, t);
    if (localIssue) {
      setUploadIssue(localIssue);
      return;
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
          tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
          publishAt,
          privacyStatus: privacy,
          videoType,
        }),
      });
      if (!res.ok) {
        throw new UploadRequestError(res.status, parseJson(await res.text()));
      }
      const data: { videoId: string } = await res.json();
      setDone({ videoId: data.videoId });
      loadHistory();
      setTab("history");
    } catch (err) {
      setUploadIssue(issueFromError(err, t));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (channels === null)
    return <div className="skeleton h-40 w-full rounded-2xl" />;

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
              setError("");
              setFieldError(null);
              setTab("post");
            }}
          >
            {t("post.youtube.new_post")}
          </Button>
        </div>
      </div>
    );
  }

  const fieldCls =
    "h-11 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-4 text-sm text-[color:var(--text)] outline-none transition-all duration-200 placeholder:text-[color:var(--muted-soft)] focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20";

  const textareaCls =
    "w-full resize-y rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-4 py-3 text-sm text-[color:var(--text)] outline-none transition-all duration-200 placeholder:text-[color:var(--muted-soft)] focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20";

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

  const FieldError = ({
    field,
    className,
  }: {
    field: FieldKey;
    className?: string;
  }) =>
    fieldError?.field === field ? (
      <p
        className={cn("text-[12px] font-semibold text-red-400", className)}
        role="alert"
      >
        {fieldError.message}
      </p>
    ) : null;

  const typeCards = [
    {
      value: "video" as VideoType,
      icon: Clapperboard,
      label: t("post.youtube.type_video"),
      hint: t("post.youtube.type_video_hint"),
    },
    {
      value: "short" as VideoType,
      icon: Zap,
      label: t("post.youtube.type_short"),
      hint: t("post.youtube.type_short_hint"),
    },
    {
      value: "community" as VideoType,
      icon: Users,
      label: t("post.youtube.type_community"),
      hint: t("post.youtube.type_community_hint"),
    },
  ] as const;

  const tabs = [
    { id: "post" as Tab, label: t("post.youtube.tab_post") },
    { id: "history" as Tab, label: t("post.youtube.tab_history") },
  ];

  return (
    <div>
      {/* ── Abas ── */}
      <div className="mb-6 flex gap-0 border-b border-[color:var(--border)]">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "relative px-5 py-2.5 text-sm font-semibold transition-colors duration-200",
              tab === id
                ? "text-[color:var(--text)]"
                : "text-[color:var(--muted)] hover:text-[color:var(--text)]",
            )}
          >
            {label}
            {tab === id && (
              <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-full bg-[color:var(--accent)] shadow-[0_0_8px_var(--accent-glow)]" />
            )}
          </button>
        ))}
      </div>

      {tab === "history" && (
        <HistoryList
          channelId={channelId}
          items={history}
          onDelete={(videoId) =>
            setHistory((prev) =>
              prev.filter((item) => item.videoId !== videoId),
            )
          }
          onUpdate={(videoId, patch) =>
            setHistory((prev) =>
              prev.map((item) =>
                item.videoId === videoId ? { ...item, ...patch } : item,
              ),
            )
          }
        />
      )}
      {tab === "post" && (
        <>
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
            <FieldError field="channel" />
            <div
              ref={channelSectionRef}
              className="mt-2 grid gap-2 rounded-xl sm:grid-cols-2"
            >
              {channels.map((channel) => {
                const selected = channel.id === channelId;
                return (
                  <div key={channel.id} className="group relative">
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setChannelId(channel.id);
                        clearFieldError("channel");
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 overflow-hidden rounded-xl border px-4 py-3 pr-10 text-left transition-all duration-200",
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
                    </button>
                    <button
                      type="button"
                      aria-label={`Desconectar ${channel.title}`}
                      title="Desconectar canal"
                      onClick={() => setChannelToDisconnect(channel)}
                      className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[color:var(--muted)] opacity-0 transition-all duration-150 hover:bg-red-500/15 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Tipo ── */}
          <section className="border-t border-[color:var(--border)] py-6">
            <SectionLabel>{t("post.youtube.video_type")}</SectionLabel>
            <div className="grid grid-cols-3 gap-2">
              {typeCards.map(({ value, icon: Icon, label, hint }) => {
                const active = videoType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setVideoType(value);
                      setError("");
                      setFieldError(null);
                    }}
                    className={cn(
                      "group relative flex flex-col gap-2 overflow-hidden rounded-xl border px-4 py-3 text-left transition-all duration-200",
                      active
                        ? "border-[color:var(--accent-border)] bg-gradient-to-br from-[color:var(--accent-surface)] to-transparent"
                        : "border-[color:var(--border)] hover:border-[color:var(--accent-border)] hover:bg-[color:var(--accent-surface)]",
                    )}
                  >
                    {active && (
                      <div className="absolute left-0 top-0 h-full w-0.5 rounded-r bg-[color:var(--accent)] shadow-[0_0_10px_var(--accent-glow)]" />
                    )}
                    <span
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200",
                        active
                          ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)] shadow-[0_4px_14px_-4px_var(--accent)]"
                          : "border border-[color:var(--border)] text-[color:var(--muted)] group-hover:border-[color:var(--accent-border)] group-hover:text-[color:var(--accent)]",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[color:var(--text)]">
                        {label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                        {hint}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ══════════════════ VÍDEO / SHORT ══════════════════ */}
          {videoType !== "community" && (
            <>
              {/* ── Arquivo ── */}
              <section className="border-t border-[color:var(--border)] py-6">
                <SectionLabel>{t("post.youtube.video")}</SectionLabel>
                <FieldError field="file" className="mb-2" />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={pickFile}
                />
                <button
                  ref={fileButtonRef}
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
                      {file
                        ? fmtSize(file.size)
                        : t(
                            videoType === "short"
                              ? "post.youtube.choose_hint_short"
                              : "post.youtube.choose_hint",
                          )}
                    </p>
                  </div>
                </button>
                {previewUrl &&
                  (() => {
                    const ratio = videoDim ? videoDim.w / videoDim.h : null;
                    const vertical =
                      ratio !== null ? ratio < 1 : videoType === "short";
                    let displayW: number;
                    let displayH: number;
                    if (ratio) {
                      if (vertical) {
                        displayH = 260;
                        displayW = Math.round(260 * ratio);
                      } else {
                        displayW = 300;
                        displayH = Math.round(300 / ratio);
                      }
                    } else {
                      displayW = vertical ? 146 : 300;
                      displayH = vertical ? 260 : 169;
                    }
                    return (
                      <div className="mt-4 flex flex-col items-center gap-2">
                        <div
                          className="relative overflow-hidden rounded-xl border border-[color:var(--accent-border)] bg-black shadow-[0_8px_32px_-8px_var(--accent-glow)]"
                          style={{ width: displayW, height: displayH }}
                        >
                          <video
                            src={previewUrl}
                            className="h-full w-full object-contain"
                            controls
                            muted
                            onLoadedMetadata={(e) => {
                              const v = e.currentTarget;
                              if (v.videoWidth && v.videoHeight)
                                setVideoDim({
                                  w: v.videoWidth,
                                  h: v.videoHeight,
                                });
                              if (Number.isFinite(v.duration))
                                setVideoDuration(v.duration);
                            }}
                          />
                          {videoDim && (
                            <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-white/70">
                              {videoDim.w}×{videoDim.h}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[color:var(--border)] px-3 text-[11px] font-semibold text-[color:var(--muted)] transition-all duration-200 hover:border-[color:var(--accent-border)] hover:bg-[color:var(--accent-surface)] hover:text-[color:var(--accent-soft)]"
                          >
                            <Upload className="h-3 w-3" />
                            {t("post.youtube.change_file")}
                          </button>
                          <button
                            type="button"
                            onClick={removeFile}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[color:var(--border)] px-3 text-[11px] font-semibold text-[color:var(--muted)] transition-all duration-200 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
                          >
                            <Trash2 className="h-3 w-3" />
                            {t("post.youtube.remove_file")}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
              </section>

              {/* ── Conteúdo: título, descrição, tags ── */}
              <section className="border-t border-[color:var(--border)] py-6 grid gap-4">
                <label className="grid gap-1.5">
                  <span className="text-[11px] font-semibold text-[color:var(--muted)]">
                    {t("post.youtube.field_title")}
                  </span>
                  <input
                    ref={titleInputRef}
                    className={cn(
                      fieldCls,
                      fieldError?.field === "title" &&
                        "border-red-500/60 focus:border-red-500 focus:ring-red-500/20",
                    )}
                    maxLength={100}
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      clearFieldError("title");
                    }}
                  />
                  <FieldError field="title" />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-[11px] font-semibold text-[color:var(--muted)]">
                    {t("post.youtube.field_description")}
                  </span>
                  <textarea
                    className={cn(textareaCls, "min-h-28")}
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

              {/* ── Specs Short ── */}
              {videoType === "short" && (
                <section className="border-t border-[color:var(--border)] py-6">
                  <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/[0.06] p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-yellow-500/20 text-yellow-400">
                        <Zap className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-[11px] font-bold uppercase tracking-widest text-yellow-400/80">
                        {t("post.youtube.short_specs_label")}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: t("post.youtube.short_spec_ratio") },
                        { label: t("post.youtube.short_spec_duration") },
                        { label: t("post.youtube.short_spec_res") },
                        { label: t("post.youtube.short_spec_hashtag") },
                        { label: t("post.youtube.short_spec_thumb") },
                      ].map(({ label }) => (
                        <span
                          key={label}
                          className="inline-flex items-center rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-[11px] font-semibold text-yellow-300/90"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {/* ── Privacidade ── */}
              <section className="border-t border-[color:var(--border)] py-6">
                <span className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--muted)]">
                  <Shield className="h-3.5 w-3.5" />
                  {t("post.youtube.privacy")}
                </span>
                <Select<Privacy>
                  value={privacy}
                  disabled={Boolean(schedule)}
                  onChange={setPrivacy}
                  options={[
                    {
                      value: "private",
                      label: t("post.youtube.privacy_private"),
                    },
                    {
                      value: "unlisted",
                      label: t("post.youtube.privacy_unlisted"),
                    },
                    {
                      value: "public",
                      label: t("post.youtube.privacy_public"),
                    },
                  ]}
                />
              </section>

              {/* ── Agendamento ── */}
              <section
                ref={scheduleSectionRef}
                className="border-t border-[color:var(--border)] py-6 grid gap-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-semibold text-[color:var(--text)]">
                      {t("post.youtube.schedule")}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[color:var(--muted)]">
                      {t("post.youtube.schedule_subtitle")}
                    </p>
                  </div>
                  <Switch
                    checked={scheduleEnabled}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setScheduleEnabled(on);
                      if (!on) clearSchedule();
                    }}
                  />
                </div>

                {scheduleEnabled && (
                  <>
                    <FieldError field="schedule" />
                    <div className="grid grid-cols-2 gap-2">
                      <DatePicker
                        value={scheduleDate}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(v) => {
                          updateSchedulePart("date", v);
                          clearFieldError("schedule");
                        }}
                      />
                      <TimePicker
                        value={scheduleTime}
                        onChange={(v) => {
                          updateSchedulePart("time", v);
                          clearFieldError("schedule");
                        }}
                      />
                    </div>
                    {schedule && (
                      <p className="text-[11px] text-[color:var(--muted)]">
                        {t("post.youtube.schedule_note")}
                      </p>
                    )}
                  </>
                )}
              </section>

              {/* ── Progresso ── */}
              {progress !== null && (
                <div className="border-t border-[color:var(--border)] py-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-[color:var(--muted)]">
                      {t("post.youtube.uploading", {
                        percent: Math.round(progress * 100),
                      })}
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
              )}

              {/* ── Publicar ── */}
              <section className="border-t border-[color:var(--border)] pt-6 grid gap-3">
                {error && (
                  <p className="text-sm font-medium text-red-400">{error}</p>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={publish}
                  className="group relative flex h-12 w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl bg-[color:var(--accent)] text-sm font-bold tracking-wide text-[color:var(--accent-foreground)] shadow-[0_16px_40px_-16px_var(--accent)] transition-all duration-300 hover:brightness-110 hover:shadow-[0_20px_48px_-16px_var(--accent)] disabled:opacity-50 disabled:shadow-none"
                >
                  <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
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
                </button>
              </section>
            </>
          )}

          {/* ══════════════════ COMUNIDADE ══════════════════ */}
          {videoType === "community" && (
            <section className="border-t border-[color:var(--border)] py-8 flex flex-col items-center gap-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-orange-500/30 bg-orange-500/10 text-orange-400">
                <Users className="h-6 w-6" />
              </div>
              <div className="grid gap-1.5 max-w-xs">
                <p className="text-sm font-semibold text-[color:var(--text)]">
                  {t("post.youtube.community_redirect_title")}
                </p>
                <p className="text-[12px] leading-relaxed text-[color:var(--muted)]">
                  {t("post.youtube.community_redirect_body")}
                </p>
              </div>
              <a
                href="https://studio.youtube.com/"
                target="_blank"
                rel="noreferrer"
                className="group relative flex h-12 items-center justify-center gap-2.5 overflow-hidden rounded-xl bg-[color:var(--accent)] px-6 text-sm font-bold tracking-wide text-[color:var(--accent-foreground)] shadow-[0_16px_40px_-16px_var(--accent)] transition-all duration-300 hover:brightness-110 hover:shadow-[0_20px_48px_-16px_var(--accent)]"
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                <ExternalLink className="h-4 w-4" />
                {t("post.youtube.community_open_studio")}
              </a>
            </section>
          )}
        </>
      )}
      {uploadIssue && (
        <UploadIssueModal
          issue={uploadIssue}
          onClose={() => setUploadIssue(null)}
        />
      )}
      {channelToDisconnect && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !disconnecting)
              setChannelToDisconnect(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--accent-border)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
            }}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
                <Trash2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[color:var(--text)]">
                  Desconectar canal
                </h3>
                <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--muted)]">
                  O canal{" "}
                  <strong className="text-[color:var(--text)]">
                    {channelToDisconnect.title}
                  </strong>{" "}
                  será desconectado. O histórico é mantido; para postar de novo,
                  basta reconectar.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={disconnecting}
                onClick={() => setChannelToDisconnect(null)}
                className="rounded-lg px-3 py-2 text-[13px] font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--field)] hover:text-[color:var(--text)] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={disconnecting}
                onClick={confirmDisconnect}
                className="flex items-center gap-2 rounded-lg bg-red-500 px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-red-600 disabled:opacity-60"
              >
                {disconnecting && <Spinner className="h-3.5 w-3.5" />}
                Desconectar
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function UploadIssueModal({
  issue,
  onClose,
}: {
  issue: UploadIssue;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const isYoutube = issue.source === "youtube";

  return (
    <div className="modal-viewport fixed inset-0 z-[150] flex overflow-y-auto overscroll-contain px-4 py-6">
      <button
        aria-label={t("post.youtube.error_modal_close")}
        className="fixed inset-0 bg-[color:var(--overlay)] backdrop-blur-md"
        type="button"
        onClick={onClose}
      />
      <section
        aria-modal="true"
        className="modal-panel modal-panel-md app-panel relative m-auto w-full overflow-hidden border p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-300">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold text-[color:var(--text)]">
                {issue.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[color:var(--muted)]">
                {issue.userMessage || issue.message}
              </p>
            </div>
          </div>
          <button
            aria-label={t("post.youtube.error_modal_close")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-[color:var(--field-hover)] hover:text-[color:var(--text)]"
            type="button"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
            {isYoutube
              ? t("post.youtube.youtube_message_label")
              : t("post.youtube.reason_label")}
          </p>
          <p className="mt-2 break-words text-sm font-semibold leading-relaxed text-[color:var(--text)]">
            {issue.message}
          </p>
          {!!(issue.reason || issue.status) && (
            <p className="mt-3 text-[11px] text-[color:var(--muted)]">
              {[
                issue.status
                  ? t("post.youtube.error_status", { status: issue.status })
                  : "",
                issue.reason
                  ? t("post.youtube.error_reason", { reason: issue.reason })
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("post.youtube.error_modal_close")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function HistoryList({
  channelId,
  items,
  onDelete,
  onUpdate,
}: {
  channelId: string;
  items: HistoryItem[];
  onDelete: (videoId: string) => void;
  onUpdate: (videoId: string, patch: Partial<HistoryItem>) => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<HistoryItem | null>(null);

  if (items.length === 0) return null;

  async function handleDelete(videoId: string, itemChannelId?: string) {
    setDeleting(videoId);
    try {
      const res = await fetch("/api/youtube/video", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: itemChannelId || channelId, videoId }),
      });
      if (res.ok) {
        onDelete(videoId);
      }
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  }

  return (
    <section className="border-t border-[color:var(--border)] pt-5 mt-5">
      <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
        <Clock className="h-3 w-3" />
        {t("post.youtube.history")}
      </p>
      <ul className="grid gap-2">
        {items.map((item, i) => {
          const key = `${item.videoId ?? "v"}-${i}`;
          const isConfirming = confirming === item.videoId;
          const isDeleting = deleting === item.videoId;
          return (
            <li
              key={key}
              className="flex items-center gap-3 rounded-xl border border-[color:var(--border)] p-2.5"
            >
              <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-[color:var(--surface-soft)]">
                {item.thumbnailUrl ? (
                  <img
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    src={item.thumbnailUrl}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[color:var(--muted)]">
                    <FileVideo2 className="h-5 w-5" />
                  </div>
                )}
                {item.durationSeconds ? (
                  <span className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 text-[10px] tabular-nums text-white">
                    {fmtDuration(item.durationSeconds)}
                  </span>
                ) : null}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[color:var(--text)]">
                  {item.title}
                </p>
                {item.publishAt && new Date(item.publishAt) > new Date(item.uploadedAt) ? (
                  <p className="flex items-center gap-1 text-[11px] text-[color:var(--accent)]">
                    <Calendar className="h-3 w-3 shrink-0" />
                    {t("post.youtube.scheduled_for", {
                      date: new Date(item.publishAt).toLocaleString(),
                    })}
                  </p>
                ) : (
                  <p className="text-[11px] text-[color:var(--muted)]">
                    {new Date(item.uploadedAt).toLocaleString()}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {item.videoId ? (
                  <a
                    aria-label={t("post.youtube.view")}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:text-[color:var(--accent)]"
                    href={`https://studio.youtube.com/video/${item.videoId}/edit`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}

                {item.videoId && !isConfirming && (
                  <button
                    type="button"
                    aria-label={t("post.youtube.edit_action")}
                    onClick={() => setEditing(item)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-[color:var(--accent-surface)] hover:text-[color:var(--accent)]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}

                {item.videoId && !isConfirming && (
                  <button
                    type="button"
                    aria-label={t("post.youtube.delete_video")}
                    onClick={() => setConfirming(item.videoId!)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}

                {item.videoId && isConfirming && (
                  <>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={() => handleDelete(item.videoId!, item.channelId)}
                      className="flex h-7 items-center gap-1 rounded-lg bg-red-500/15 px-2 text-[11px] font-semibold text-red-400 transition hover:bg-red-500/25 disabled:opacity-50"
                    >
                      {isDeleting ? (
                        <Spinner className="h-3 w-3" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      {t("post.youtube.delete_confirm")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {editing?.videoId && (
        <EditHistoryModal
          channelId={editing.channelId || channelId}
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {
            onUpdate(editing.videoId!, patch);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

// Modal de edição de um vídeo já postado (título/descrição/privacidade). Salva
// via PATCH /api/youtube/video e devolve o patch para a lista atualizar na hora.
function EditHistoryModal({
  channelId,
  item,
  onClose,
  onSaved,
}: {
  channelId: string;
  item: HistoryItem;
  onClose: () => void;
  onSaved: (patch: Partial<HistoryItem>) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(item.title ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [privacy, setPrivacy] = useState<Privacy>(
    (item.privacyStatus as Privacy) ?? "private",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function save() {
    if (!title.trim()) {
      setError(t("post.youtube.error_no_title"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/youtube/video", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          videoId: item.videoId,
          title: title.trim(),
          description,
          privacyStatus: privacy,
        }),
      });
      if (!res.ok) {
        const payload = parseJson(await res.text());
        throw new Error(payload.message || payload.error || "update_failed");
      }
      onSaved({ title: title.trim(), description, privacyStatus: privacy });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      setError(
        detail && detail !== "update_failed"
          ? `${t("post.youtube.edit_error")} (${detail})`
          : t("post.youtube.edit_error"),
      );
    } finally {
      setBusy(false);
    }
  }

  const fieldCls =
    "h-11 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-4 text-sm text-[color:var(--text)] outline-none transition-all duration-200 focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20";

  return (
    <div className="modal-viewport fixed inset-0 z-[150] flex overflow-y-auto overscroll-contain px-4 py-6">
      <button
        aria-label={t("post.youtube.edit_cancel")}
        className="fixed inset-0 bg-[color:var(--overlay)] backdrop-blur-md"
        type="button"
        onClick={onClose}
      />
      <section
        aria-modal="true"
        role="dialog"
        className="modal-panel modal-panel-md app-panel relative m-auto w-full overflow-hidden border p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-base font-semibold text-[color:var(--text)]">
            <Pencil className="h-4 w-4 text-[color:var(--accent)]" />
            {t("post.youtube.edit_title")}
          </p>
          <button
            aria-label={t("post.youtube.edit_cancel")}
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-[color:var(--field-hover)] hover:text-[color:var(--text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-[11px] font-semibold text-[color:var(--muted)]">
              {t("post.youtube.field_title")}
            </span>
            <input
              className={fieldCls}
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[11px] font-semibold text-[color:var(--muted)]">
              {t("post.youtube.field_description")}
            </span>
            <textarea
              className="min-h-24 w-full resize-y rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-4 py-3 text-sm text-[color:var(--text)] outline-none transition-all duration-200 focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20"
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--muted)]">
              <Shield className="h-3.5 w-3.5" />
              {t("post.youtube.privacy")}
            </span>
            <Select<Privacy>
              value={privacy}
              onChange={setPrivacy}
              options={[
                { value: "private", label: t("post.youtube.privacy_private") },
                {
                  value: "unlisted",
                  label: t("post.youtube.privacy_unlisted"),
                },
                { value: "public", label: t("post.youtube.privacy_public") },
              ]}
            />
          </label>
        </div>

        {error && (
          <p className="mt-3 text-[12px] font-semibold text-red-400">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("post.youtube.edit_cancel")}
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? (
              <Spinner className="h-4 w-4" />
            ) : (
              t("post.youtube.edit_save")
            )}
          </Button>
        </div>
      </section>
    </div>
  );
}
