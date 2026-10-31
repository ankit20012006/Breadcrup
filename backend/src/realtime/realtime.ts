import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { SOCKET_EVENTS, type PublicOverlayState, type SocketEventName } from "@breadcrumb/shared";
import { z } from "zod";
import { verifyAppToken } from "../services/appTokens";

export interface Realtime {
  /** Private: only the authenticated streamer's sockets receive this. */
  toStreamer(streamerId: string, event: SocketEventName, payload: unknown): void;
  /** Public: overlay/viewer sockets for a session. Accepts only the public overlay shape. */
  toOverlay(sessionId: string, state: PublicOverlayState): void;
}

/** No-op/recording implementation used in tests and before the socket server starts. */
export class RecordingRealtime implements Realtime {
  events: { room: string; event: string; payload: unknown }[] = [];
  toStreamer(streamerId: string, event: SocketEventName, payload: unknown) {
    this.events.push({ room: `streamer:${streamerId}`, event, payload });
  }
  toOverlay(sessionId: string, state: PublicOverlayState) {
    this.events.push({ room: `overlay:${sessionId}`, event: SOCKET_EVENTS.overlayUpdate, payload: state });
  }
}

const joinSchema = z.object({ sessionId: z.string().uuid() });
const MAX_OVERLAY_ROOMS_PER_SOCKET = 3;

export function attachSocketServer(
  httpServer: HttpServer,
  opts: {
    isAllowedOrigin: (origin: string | undefined) => boolean;
    getOverlayState: (sessionId: string) => Promise<PublicOverlayState | null>;
  },
): Realtime & { io: Server } {
  const io = new Server(httpServer, {
    cors: { origin: (origin, cb) => cb(null, opts.isAllowedOrigin(origin)), credentials: false },
    // Small payloads only; nothing legitimate needs more.
    maxHttpBufferSize: 16 * 1024,
  });

  io.on("connection", async (socket) => {
    const token = typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : null;
    if (token) {
      const claims = await verifyAppToken(token);
      if (claims?.kind === "streamer") {
        socket.data.streamerId = claims.sub;
        await socket.join(`streamer:${claims.sub}`);
        socket.emit("auth:ok", { role: "streamer" });
      } else {
        socket.emit("auth:error", { error: "Invalid or expired token" });
      }
    }

    // Join-rate limiting: a socket may only try a handful of joins per minute.
    let joinAttempts = 0;
    const resetTimer = setInterval(() => (joinAttempts = 0), 60_000);

    socket.on(SOCKET_EVENTS.joinOverlay, async (raw: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === "function" ? ack : () => undefined;
      if (++joinAttempts > 10) return reply({ ok: false, error: "Too many join attempts" });
      const parsed = joinSchema.safeParse(raw);
      if (!parsed.success) return reply({ ok: false, error: "Invalid session id" });
      const overlayRooms = [...socket.rooms].filter((r) => r.startsWith("overlay:"));
      if (overlayRooms.length >= MAX_OVERLAY_ROOMS_PER_SOCKET) return reply({ ok: false, error: "Too many overlays on one connection" });

      const state = await opts.getOverlayState(parsed.data.sessionId);
      if (!state) return reply({ ok: false, error: "Session not found" });
      await socket.join(`overlay:${parsed.data.sessionId}`);
      reply({ ok: true });
      socket.emit(SOCKET_EVENTS.overlayUpdate, state);
    });

    socket.on(SOCKET_EVENTS.leaveOverlay, (raw: unknown) => {
      const parsed = joinSchema.safeParse(raw);
      if (parsed.success) void socket.leave(`overlay:${parsed.data.sessionId}`);
    });

    socket.on("disconnect", () => clearInterval(resetTimer));
  });

  return {
    io,
    toStreamer(streamerId, event, payload) {
      io.to(`streamer:${streamerId}`).emit(event, payload);
    },
    toOverlay(sessionId, state) {
      io.to(`overlay:${sessionId}`).emit(SOCKET_EVENTS.overlayUpdate, state);
    },
  };
}

/** Lets services hold a stable reference while the socket server is attached later. */
export class RealtimeProxy implements Realtime {
  private target: Realtime = { toStreamer: () => undefined, toOverlay: () => undefined };
  setTarget(target: Realtime) {
    this.target = target;
  }
  toStreamer(streamerId: string, event: SocketEventName, payload: unknown) {
    this.target.toStreamer(streamerId, event, payload);
  }
  toOverlay(sessionId: string, state: PublicOverlayState) {
    this.target.toOverlay(sessionId, state);
  }
}
