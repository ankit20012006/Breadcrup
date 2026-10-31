import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import {
  createSessionSchema,
  createSubmissionSchema,
  editTierSchema,
  generateHintsSchema,
  submissionDecisionSchema,
  tierDecisionSchema,
  uuidParam,
} from "@breadcrumb/shared";
import type { Services } from "../container";
import { requireStreamer, requireViewer } from "../middleware/auth";
import { HttpError } from "../middleware/errors";

export const idParam = (req: Request, name = "id") => {
  const parsed = uuidParam.safeParse(req.params[name]);
  if (!parsed.success) throw new HttpError(404, "Not found", "NOT_FOUND");
  return parsed.data;
};

export function sessionRoutes(s: Services): Router {
  const r = Router();
  const streamer = requireStreamer(s.repo);
  const viewer = requireViewer(s.repo);

  const generateLimiter = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many generation requests; wait a minute", code: "RATE_LIMITED" } });
  const submitLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many submissions from this network; slow down", code: "RATE_LIMITED" } });

  // ---- streamer -------------------------------------------------------------
  r.post("/", streamer, async (req, res) => {
    const input = createSessionSchema.parse(req.body);
    res.status(201).json(await s.hints.createSession(req.streamer!.id, input));
  });

  r.get("/", streamer, async (req, res) => {
    res.json(await s.hints.listSessions(req.streamer!.id));
  });

  r.get("/:id", streamer, async (req, res) => {
    res.json(await s.hints.detail(req.streamer!.id, idParam(req)));
  });

  r.post("/:id/generate", streamer, generateLimiter, async (req, res) => {
    const body = generateHintsSchema.parse(req.body ?? {});
    res.json(await s.hints.generate(req.streamer!.id, idParam(req), body));
  });

  r.post("/:id/tiers/decision", streamer, async (req, res) => {
    const { tier, decision } = tierDecisionSchema.parse(req.body);
    res.json(await s.hints.decideTier(req.streamer!.id, idParam(req), tier, decision));
  });

  r.patch("/:id/tiers", streamer, async (req, res) => {
    const { tier, text } = editTierSchema.parse(req.body);
    res.json(await s.hints.editTier(req.streamer!.id, idParam(req), tier, text));
  });

  r.post("/:id/reveal-next", streamer, async (req, res) => {
    res.json(await s.hints.revealNext(req.streamer!.id, idParam(req)));
  });

  r.post("/:id/close", streamer, async (req, res) => {
    res.json(await s.hints.close(req.streamer!.id, idParam(req)));
  });

  r.patch("/:id/submissions/:submissionId", streamer, async (req, res) => {
    const { status } = submissionDecisionSchema.parse(req.body);
    res.json(await s.hints.setSubmissionStatus(req.streamer!.id, idParam(req), idParam(req, "submissionId"), status));
  });

  // ---- public (OBS overlay) -------------------------------------------------
  r.get("/:id/overlay", async (req, res) => {
    const state = await s.hints.publicOverlay(idParam(req));
    if (!state) throw new HttpError(404, "Session not found", "NOT_FOUND");
    res.set("Cache-Control", "no-store").json(state);
  });

  // ---- viewer ---------------------------------------------------------------
  r.post("/:id/submissions", submitLimiter, viewer, async (req, res) => {
    const input = createSubmissionSchema.parse(req.body);
    const result = await s.hints.addSubmission(idParam(req), req.viewer!, input);
    res.status(201).json({ ...result, note: "Your clue was sent privately to the streamer. It is not posted in chat." });
  });

  return r;
}
