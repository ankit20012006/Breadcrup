"use client";

import * as React from "react";
import { CheckCircle2, EyeOff, Loader2, Lock, Send } from "lucide-react";
import { DISPLAY_NAME_PATTERN, LIMITS, SOCKET_EVENTS, type PublicOverlayState, type PublicSessionInfo } from "@breadcrumb/shared";
import { CrumbMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, ApiError, errorMessage } from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { getTwitchExtensionToken, isInTwitchExtension } from "@/lib/twitchExt";
import { cn, timeAgo } from "@/lib/utils";

interface MySubmission {
  id: string;
  text: string;
  status: "pending" | "rejected";
  createdAt: string;
}
interface ViewerView {
  session: PublicSessionInfo;
  mySubmissions: MySubmission[];
  remaining: number;
}

type Phase = { kind: "loading" } | { kind: "no-session"; message: string } | { kind: "error"; message: string } | { kind: "ready" };

const VIEWER_TOKEN_KEY = "breadcrumb.viewerToken";
const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  remove: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export default function ViewerPanel() {
  const [phase, setPhase] = React.useState<Phase>({ kind: "loading" });
  const [token, setToken] = React.useState<string | null>(null);
  const [view, setView] = React.useState<ViewerView | null>(null);
  const [overlay, setOverlay] = React.useState<PublicOverlayState | null>(null);

  const sessionId = view?.session.id;
  const sessionIdRef = React.useRef<string | undefined>(undefined);
  sessionIdRef.current = sessionId;
  const tokenRef = React.useRef<string | null>(null);

  // ---- identify viewer & session -------------------------------------------
  const load = React.useCallback(async (allowRetry = true): Promise<void> => {
    const sessionParam = new URLSearchParams(window.location.search).get("session");
    const tokenKey = `${VIEWER_TOKEN_KEY}:${sessionParam ?? "default"}`;
    const inExtension = isInTwitchExtension();
    try {
      let viewerToken: string;
      if (inExtension) {
        viewerToken = await getTwitchExtensionToken();
      } else {
        viewerToken = storage.get(tokenKey) ?? (await api<{ token: string }>("/api/viewer/token", { body: sessionParam ? { sessionId: sessionParam } : {} })).token;
        storage.set(tokenKey, viewerToken);
      }
      tokenRef.current = viewerToken;

      let target = sessionParam;
      if (!target) {
        const active = await api<{ session: PublicSessionInfo | null }>("/api/viewer/active", { token: viewerToken });
        if (!active.session) {
          setView(null);
          setPhase({ kind: "no-session", message: "The streamer hasn't opened a hint session yet. This panel updates on its own when they do." });
          return;
        }
        target = active.session.id;
      }
      const v = await api<ViewerView>(`/api/viewer/sessions/${target}`, { token: viewerToken });
      setToken(viewerToken);
      setView(v);
      setPhase({ kind: "ready" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && allowRetry && !inExtension) {
        // Stored anonymous token expired (or its channel no longer exists): get a fresh one once.
        storage.remove(tokenKey);
        return load(false);
      }
      if (err instanceof ApiError && err.code === "NETWORK") {
        // Backend unreachable (e.g. restarting): keep retrying instead of getting stuck.
        setPhase({ kind: "error", message: `${errorMessage(err)} Retrying…` });
        setTimeout(() => void load(), 5000);
        return;
      }
      setPhase({ kind: "error", message: errorMessage(err) });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Without a ?session= link, follow the channel's newest open session (e.g. the streamer opens a new one).
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get("session")) return;
    const timer = setInterval(async () => {
      if (!tokenRef.current) return;
      try {
        const active = await api<{ session: PublicSessionInfo | null }>("/api/viewer/active", { token: tokenRef.current });
        if ((active.session?.id ?? undefined) !== sessionIdRef.current) void load();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) void load();
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  // ---- public live state (same feed as the overlay) -------------------------
  React.useEffect(() => {
    if (!sessionId) return;
    const socket = connectSocket();
    socket.on("connect", () => socket.emit(SOCKET_EVENTS.joinOverlay, { sessionId }, () => undefined));
    socket.on(SOCKET_EVENTS.overlayUpdate, (s: PublicOverlayState) => s.sessionId === sessionId && setOverlay(s));
    return () => {
      socket.close();
    };
  }, [sessionId]);

  const refresh = React.useCallback(async () => {
    if (!token || !sessionId) return;
    setView(await api<ViewerView>(`/api/viewer/sessions/${sessionId}`, { token }));
  }, [token, sessionId]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-3 py-3 text-sm">
      <header className="mb-3 flex items-center gap-2">
        <CrumbMark className="size-5" lit={overlay?.revealed?.tier ?? view?.session.currentRevealedTier ?? 0} />
        <span className="font-display font-bold tracking-tight">Breadcrumb</span>
        <span className="ml-auto text-[11px] text-subtle">Send the streamer a hint</span>
      </header>

      {phase.kind === "loading" && (
        <div className="grid flex-1 place-items-center text-muted">
          <Loader2 className="size-5 animate-spin" aria-label="Loading" />
        </div>
      )}
      {(phase.kind === "no-session" || phase.kind === "error") && (
        <div role={phase.kind === "error" ? "alert" : undefined} className={cn("rounded-xl border p-4", phase.kind === "error" ? "border-ember/30 bg-ember-soft text-ember" : "border-border bg-surface text-muted")}>
          {phase.message}
        </div>
      )}
      {phase.kind === "ready" && view && token && <ReadyPanel view={view} overlay={overlay} token={token} onSubmitted={refresh} onAuthExpired={() => void load()} />}
    </main>
  );
}

function ReadyPanel({
  view,
  overlay,
  token,
  onSubmitted,
  onAuthExpired,
}: {
  view: ViewerView;
  overlay: PublicOverlayState | null;
  token: string;
  onSubmitted: () => Promise<void>;
  onAuthExpired: () => void;
}) {
  const [text, setText] = React.useState("");
  const [name, setName] = React.useState("");
  const [credit, setCredit] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const submittingRef = React.useRef(false);
  const [feedback, setFeedback] = React.useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const closed = (overlay?.status ?? view.session.status) === "closed";
  const revealedTier = overlay?.revealed?.tier ?? view.session.currentRevealedTier;
  const tooShort = text.trim().length < LIMITS.submissionMinLength;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await api<{ note: string }>(`/api/sessions/${view.session.id}/submissions`, {
        token,
        body: { text, displayName: name.trim() || undefined, creditOptIn: credit && Boolean(name.trim()) },
      });
      setText("");
      setFeedback({ tone: "ok", message: res.note });
      await onSubmitted();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setFeedback({ tone: "error", message: "Your viewer session expired. Reconnecting, please send your clue again in a moment." });
        onAuthExpired();
      } else {
        setFeedback({ tone: "error", message: errorMessage(err) });
      }
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };
  const nameInvalid = name.trim() !== "" && !DISPLAY_NAME_PATTERN.test(name.trim());

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <p className="flex-1 truncate text-xs text-muted">{view.session.game}</p>
          {closed ? <Badge>Closed</Badge> : <Badge variant="sage">Taking clues</Badge>}
        </div>
        <p className="mt-1 font-medium">{view.session.question}</p>
        <p className="mt-2 text-[11px] text-subtle">{revealedTier}/3 hints revealed on stream so far</p>
      </section>

      {overlay?.revealed && (
        <section className="rounded-xl border border-signal/40 bg-signal-soft p-3">
          <p className="text-[11px] font-medium text-signal">
            On stream now · Hint {overlay.revealed.tier} ({overlay.revealed.label})
          </p>
          <p className="mt-1">{overlay.revealed.text}</p>
        </section>
      )}

      {closed ? (
        <p className="rounded-xl border border-border bg-surface p-3 text-muted">This session is closed. Thanks for helping!</p>
      ) : (
        <form onSubmit={submit} className="space-y-2.5 rounded-xl border border-border bg-surface p-3">
          <div className="space-y-1">
            <Label htmlFor="clue">Your clue</Label>
            <Textarea
              id="clue"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={LIMITS.submissionMaxLength}
              placeholder="What would help? Be as specific as you like. The streamer decides how much to reveal."
              disabled={view.remaining === 0}
              aria-describedby="clue-help"
            />
            <div id="clue-help" className="flex justify-between text-[11px] text-subtle">
              <span>{view.remaining} of {LIMITS.submissionsPerViewerPerSession} clues left</span>
              <span className={cn(text.length > LIMITS.submissionMaxLength - 20 && "text-crust")}>
                {text.length}/{LIMITS.submissionMaxLength}
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="name">Name for credit (optional)</Label>
            <Input
              id="name"
              value={name}
              maxLength={LIMITS.displayNameMaxLength}
              onChange={(e) => setName(e.target.value)}
              placeholder="Leave blank to stay anonymous"
              aria-invalid={nameInvalid}
              aria-describedby="name-help"
            />
            {nameInvalid && (
              <p id="name-help" className="text-[11px] text-ember">
                Use letters, numbers, spaces, _ or - only.
              </p>
            )}
          </div>
          <label className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>Show my name on stream if my clue is used</span>
            <Switch checked={credit && Boolean(name.trim())} disabled={!name.trim()} onCheckedChange={setCredit} aria-label="Credit me on stream" />
          </label>
          <Button type="submit" className="w-full" disabled={busy || tooShort || nameInvalid || view.remaining === 0}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />} Send privately
          </Button>
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-subtle">
            <EyeOff className="mt-px size-3.5 shrink-0" />
            Clues go only to the streamer. They are not posted in chat, and other viewers can&apos;t see them.
          </p>
          {feedback && (
            <p role={feedback.tone === "error" ? "alert" : "status"} className={cn("rounded-md px-2 py-1.5 text-xs", feedback.tone === "ok" ? "bg-sage-soft text-sage" : "bg-ember-soft text-ember")}>
              {feedback.message}
            </p>
          )}
        </form>
      )}

      {view.mySubmissions.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-3">
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Lock className="size-3.5" /> Your clues (only you and the streamer see these)
          </h2>
          <ul className="space-y-1.5">
            {view.mySubmissions.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-xs">
                <CheckCircle2 className={cn("mt-0.5 size-3.5 shrink-0", s.status === "rejected" ? "text-subtle" : "text-sage")} />
                <span className="flex-1 break-words">{s.text}</span>
                <span className="shrink-0 text-subtle">{s.status === "rejected" ? "not used" : `received ${timeAgo(s.createdAt)}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
