import { Router } from "express";
import rateLimit from "express-rate-limit";
import { flagActionSchema, reviewFlagSchema } from "@breadcrumb/shared";
import { z } from "zod";
import { config } from "../config";
import type { Services } from "../container";
import { requireStreamer } from "../middleware/auth";
import { idParam } from "./sessions";

export function chatRoutes(s: Services): Router {
  const r = Router();
  r.use(requireStreamer(s.repo));
  const summaryLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many summary requests; wait a minute", code: "RATE_LIMITED" } });

  r.get("/summaries", async (req, res) => {
    res.json(await s.pulse.list(req.streamer!.id));
  });

  r.post("/summaries/generate", summaryLimiter, async (req, res) => {
    res.json(await s.pulse.generate(req.streamer!.id, { manual: true }));
  });

  r.get("/stats", async (req, res) => {
    res.json(await s.chat.stats(req.streamer!.id));
  });

  return r;
}

const statusQuery = z.enum(["open", "dismissed", "confirmed_spam", "all"]).default("open");

export function moderationRoutes(s: Services): Router {
  const r = Router();
  r.use(requireStreamer(s.repo));
  const actionLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });

  r.get("/flags", async (req, res) => {
    const status = statusQuery.parse(req.query.status ?? undefined);
    res.json(await s.moderation.list(req.streamer!.id, status));
  });

  r.post("/flags/:id/review", async (req, res) => {
    const { status } = reviewFlagSchema.parse(req.body);
    res.json(await s.moderation.review(req.streamer!.id, idParam(req), status));
  });

  r.post("/flags/:id/action", actionLimiter, async (req, res) => {
    flagActionSchema.parse(req.body);
    res.json(await s.moderation.deleteFlaggedMessage(req.streamer!, idParam(req)));
  });

  r.get("/config", (_req, res) => {
    res.json({ thresholds: config.guard, autoBan: false, note: "Breadcrumb only flags messages. Bans are never automatic, and deletions need an explicit action." });
  });

  return r;
}
