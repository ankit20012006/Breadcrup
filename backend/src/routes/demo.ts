import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { config } from "../config";
import type { Services } from "../container";
import { requireStreamer } from "../middleware/auth";
import { HttpError } from "../middleware/errors";
import { idParam } from "./sessions";

const burstSchema = z.object({ kind: z.enum(["link", "copypasta", "flood", "mixed"]).default("mixed") });

/** Demo-only controls. Refused for real Twitch accounts so demo data can't mix into live data. */
export function demoRoutes(s: Services): Router {
  const r = Router();
  const demoOnly: RequestHandler = (req, _res, next) => {
    if (!config.demoMode) return next(new HttpError(403, "Demo mode is disabled", "DEMO_DISABLED"));
    if (!req.streamer?.isDemo) return next(new HttpError(403, "Demo controls are only available to the demo account", "DEMO_ONLY"));
    next();
  };
  r.use(requireStreamer(s.repo), demoOnly);

  r.post("/chat/message", async (req, res) => {
    await s.demo.randomChat(req.streamer!.id);
    res.status(204).end();
  });

  r.post("/chat/burst", async (req, res) => {
    const { kind } = burstSchema.parse(req.body ?? {});
    await s.demo.spamBurst(req.streamer!.id, kind);
    res.status(204).end();
  });

  r.post("/sessions/:id/clue", async (req, res) => {
    const sessionId = idParam(req);
    await s.hints.getOwnedSession(req.streamer!.id, sessionId);
    res.status(201).json(await s.demo.addSimulatedClue(sessionId));
  });

  return r;
}
