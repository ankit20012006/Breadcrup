"use client";

import * as React from "react";
import type { Socket } from "socket.io-client";
import {
  SOCKET_EVENTS,
  type ChatSummary,
  type HintSession,
  type ModerationFlag,
  type SessionDetail,
  type StreamerProfile,
  type SystemStatus,
} from "@breadcrumb/shared";
import { api, ApiError, errorMessage, streamerToken, STREAMER_TOKEN_EVENT } from "@/lib/api";
import { connectSocket } from "@/lib/socket";

export interface ChatStats {
  windowMinutes: number;
  messages: number;
  uniqueChatters: number;
  flagged: number;
  duplicates: number;
  openFlags: number;
  sources: ("live" | "demo")[];
  recent: { id: string; chatter: string; text: string; flagged: boolean; duplicate: boolean; source: "live" | "demo"; sentAt: string }[];
}

export type SocketState = "connecting" | "connected" | "reconnecting" | "offline";

export interface ChatConnectionStatus {
  connected: boolean;
  subscribed: boolean;
  lastError: string | null;
}

export function useDashboard() {
  const [token, setToken] = React.useState<string | null>(null);
  const [booting, setBooting] = React.useState(true);
  const [status, setStatus] = React.useState<SystemStatus | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [me, setMe] = React.useState<StreamerProfile | null>(null);
  const [chatStatus, setChatStatus] = React.useState<ChatConnectionStatus | null>(null);
  const [sessions, setSessions] = React.useState<HintSession[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<SessionDetail | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [dataError, setDataError] = React.useState<string | null>(null);
  const [dataLoading, setDataLoading] = React.useState(false);
  const [flags, setFlags] = React.useState<ModerationFlag[]>([]);
  const [summaries, setSummaries] = React.useState<ChatSummary[]>([]);
  const [stats, setStats] = React.useState<ChatStats | null>(null);
  const [socketState, setSocketState] = React.useState<SocketState>("offline");
  const selectedRef = React.useRef<string | null>(null);
  selectedRef.current = selectedId;

  // ---- boot: system status + stored token ---------------------------------
  React.useEffect(() => {
    setToken(streamerToken.get());
    setBooting(false);
    const syncToken = (event: Event) => setToken((event as CustomEvent<string | null>).detail);
    window.addEventListener(STREAMER_TOKEN_EVENT, syncToken);
    // Keep retrying until the backend answers, so a restart mid-demo heals without a page refresh.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () =>
      api<SystemStatus>("/api/auth/status")
        .then((s) => {
          setStatus(s);
          setStatusError(null);
        })
        .catch((e) => {
          setStatusError(e.message);
          timer = setTimeout(check, 5000);
        });
    void check();
    return () => {
      window.removeEventListener(STREAMER_TOKEN_EVENT, syncToken);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const signOut = React.useCallback(() => {
    streamerToken.clear();
    setToken(null);
    setMe(null);
    setChatStatus(null);
    setSessions([]);
    setDetail(null);
    setSelectedId(null);
  }, []);

  const call = React.useCallback(
    async <T,>(path: string, opts: { method?: string; body?: unknown } = {}) => {
      try {
        return await api<T>(path, { ...opts, token });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) signOut();
        throw err;
      }
    },
    [token, signOut],
  );

  const loginDemo = React.useCallback(async () => {
    const res = await api<{ token: string; streamer: StreamerProfile }>("/api/auth/demo", { method: "POST" });
    streamerToken.set(res.token);
    setToken(res.token);
  }, []);

  const disconnectTwitch = React.useCallback(async () => {
    const result = await call<{ revoked: boolean }>("/api/auth/twitch/disconnect", { method: "POST" });
    signOut();
    return result.revoked;
  }, [call, signOut]);

  // ---- loaders --------------------------------------------------------------
  const loadSessions = React.useCallback(async () => {
    const list = await call<HintSession[]>("/api/sessions");
    setSessions(list);
    setSelectedId((current) => current ?? list.find((s) => s.status === "collecting")?.id ?? list[0]?.id ?? null);
  }, [call]);

  const loadDetail = React.useCallback(
    async (id: string | null = selectedRef.current) => {
      if (!id) {
        setDetail(null);
        setDetailError(null);
        return;
      }
      setDetailError(null);
      try {
        const d = await call<SessionDetail>(`/api/sessions/${id}`);
        if (selectedRef.current === id) setDetail(d);
      } catch (err) {
        if (selectedRef.current === id) setDetailError(errorMessage(err));
        throw err;
      }
    },
    [call],
  );

  const loadFlags = React.useCallback(async () => setFlags(await call<ModerationFlag[]>("/api/moderation/flags?status=all")), [call]);
  const loadSummaries = React.useCallback(async () => setSummaries(await call<ChatSummary[]>("/api/chat/summaries")), [call]);
  const loadStats = React.useCallback(async () => setStats(await call<ChatStats>("/api/chat/stats")), [call]);

  const loadAll = React.useCallback(
    async () => {
      setDataLoading(true);
      try {
        const results = await Promise.allSettled([
          call<{ streamer: StreamerProfile; chat: ChatConnectionStatus }>("/api/auth/me").then((r) => {
            setMe(r.streamer);
            setChatStatus(r.chat);
          }),
          loadSessions(),
          loadFlags(),
          loadSummaries(),
          loadStats(),
        ]);
        const failures = results.flatMap((result) => (result.status === "rejected" ? [errorMessage(result.reason)] : []));
        setDataError(failures.length > 0 ? `Some dashboard data could not be loaded: ${failures.join("; ")}` : null);
      } finally {
        setDataLoading(false);
      }
    },
    [call, loadSessions, loadFlags, loadSummaries, loadStats],
  );

  React.useEffect(() => {
    if (token) void loadAll();
  }, [token, loadAll]);

  React.useEffect(() => {
    if (!token || me?.isDemo) return;
    const refreshChatStatus = () => {
      call<{ streamer: StreamerProfile; chat: ChatConnectionStatus }>("/api/auth/me")
        .then(({ streamer, chat }) => {
          setMe(streamer);
          setChatStatus(chat);
        })
        .catch((err) => setChatStatus({ connected: false, subscribed: false, lastError: `Could not refresh Twitch chat status: ${errorMessage(err)}` }));
    };
    const timer = setInterval(refreshChatStatus, 5000);
    return () => clearInterval(timer);
  }, [token, me?.isDemo, call]);

  React.useEffect(() => {
    setDetail(null);
    setDetailError(null);
    if (token && selectedId) loadDetail(selectedId).catch(() => undefined);
  }, [token, selectedId, loadDetail]);

  // ---- realtime -------------------------------------------------------------
  React.useEffect(() => {
    if (!token) return;
    const socket: Socket = connectSocket(token);
    setSocketState("connecting");
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshSession = (sessionId?: string) => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        loadSessions().catch(() => undefined);
        if (!sessionId || sessionId === selectedRef.current) loadDetail().catch(() => undefined);
      }, 150);
    };
    const sessionIdOf = (p: any): string | undefined => p?.sessionId ?? p?.id;

    socket.on("connect", () => {
      setSocketState("connected");
      // Catch up on anything missed while disconnected (also covers a backend restart).
      refreshSession();
      void loadAll();
    });
    socket.on("disconnect", () => setSocketState("reconnecting"));
    socket.io.on("reconnect_attempt", () => setSocketState("reconnecting"));
    socket.on("auth:error", () => signOut());

    for (const ev of [
      SOCKET_EVENTS.submissionCreated,
      SOCKET_EVENTS.hintsGenerated,
      SOCKET_EVENTS.hintApproval,
      SOCKET_EVENTS.hintRevealed,
      SOCKET_EVENTS.sessionUpdated,
      SOCKET_EVENTS.sessionClosed,
    ]) {
      socket.on(ev, (payload: unknown) => refreshSession(sessionIdOf(payload)));
    }
    const upsertFlag = (flag: ModerationFlag) => setFlags((all) => [flag, ...all.filter((f) => f.id !== flag.id)]);
    socket.on(SOCKET_EVENTS.flagCreated, upsertFlag);
    socket.on(SOCKET_EVENTS.flagUpdated, upsertFlag);
    socket.on(SOCKET_EVENTS.moderationActionCompleted, (p: { flag: ModerationFlag }) => upsertFlag(p.flag));
    socket.on(SOCKET_EVENTS.summaryUpdated, (s: ChatSummary) => setSummaries((all) => [s, ...all.filter((x) => x.id !== s.id)].slice(0, 10)));
    socket.on(SOCKET_EVENTS.chatStats, (s: ChatStats) => setStats(s));

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.close();
      setSocketState("offline");
    };
  }, [token, loadSessions, loadDetail, loadFlags, loadAll, signOut]);

  return {
    booting,
    token,
    status,
    statusError,
    me,
    chatStatus,
    sessions,
    selectedId,
    setSelectedId,
    detail,
    flags,
    summaries,
    stats,
    socketState,
    dataLoading,
    dataError,
    detailError,
    call,
    loginDemo,
    signOut,
    disconnectTwitch,
    reload: { all: loadAll, sessions: loadSessions, detail: loadDetail, flags: loadFlags, summaries: loadSummaries, stats: loadStats },
  };
}

export type Dashboard = ReturnType<typeof useDashboard>;
