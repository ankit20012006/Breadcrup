import { randomUUID } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config";
import type { Services } from "../container";
import { requireViewer } from "../middleware/auth";
import { HttpError } from "../middleware/errors";
import { signViewerToken } from "../services/appTokens";
import { idParam } from "./sessions";

const tokenRequest = z.object({ sessionId: z.string().uuid().optional() });

export function viewerRoutes(s: Services): Router {
  const r = Router();
  const viewer = requireViewer(s.repo);
  const tokenLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

  /**
   * Anonymous viewer tokens for use outside the Twitch extension iframe (demo, or
   * live when ALLOW_ANONYMOUS_VIEWERS=true). Inside Twitch, the extension JWT is used.
   */
  r.post("/token", tokenLimiter, async (req, res) => {
    if (!config.allowAnonymousViewers) {
      throw new HttpError(403, "Open this panel from the Twitch extension to submit clues", "ANON_DISABLED");
    }
    const { sessionId } = tokenRequest.parse(req.body ?? {});
    let channel: string | null = null;
    if (sessionId) {
      const session = await s.repo.getSession(sessionId);
      if (!session) throw new HttpError(404, "Session not found", "NOT_FOUND");
      channel = session.streamerId;
    } else if (config.demoMode) {
      channel = (await s.demo.ensureDemoStreamer()).id;
    } else {
      throw new HttpError(400, "A session link is required", "SESSION_REQUIRED");
    }
    res.json({ token: await signViewerToken(randomUUID(), channel) });
  });

  /** The latest open session for the viewer's channel (public fields only). */
  r.get("/active", viewer, async (req, res) => {
    const channel = req.viewer!.channelConnectionId;
    if (!channel) throw new HttpError(404, "This channel hasn't connected Breadcrumb yet", "CHANNEL_UNKNOWN");
    res.json({ session: await s.hints.activeSessionForChannel(channel) });
  });

  r.get("/sessions/:id", viewer, async (req, res) => {
    res.json(await s.hints.viewerView(idParam(req), req.viewer!));
  });

  return r;
}
