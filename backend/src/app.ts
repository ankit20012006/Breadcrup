import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { config, isAllowedOrigin } from "./config";
import type { Services } from "./container";
import { errorHandler, notFound } from "./middleware/errors";
import { authRoutes, systemStatus } from "./routes/auth";
import { chatRoutes, moderationRoutes } from "./routes/chat";
import { demoRoutes } from "./routes/demo";
import { sessionRoutes } from "./routes/sessions";
import { viewerRoutes } from "./routes/viewer";

export function createApp(s: Services) {
  const app = express();
  app.set("trust proxy", 1); // Render/Vercel sit behind one proxy hop; needed for per-IP rate limits.
  app.disable("x-powered-by");

  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  // Non-browser clients (no Origin), configured frontends, and the Twitch extension CDN.
  app.use(cors({ origin: (origin, cb) => cb(null, isAllowedOrigin(origin)), credentials: true }));
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", rateLimit({ windowMs: 60_000, limit: config.isTest ? 10_000 : 600, standardHeaders: "draft-8", legacyHeaders: false }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, ...systemStatus(s) });
  });

  app.use("/api/auth", authRoutes(s));
  app.use("/api/sessions", sessionRoutes(s));
  app.use("/api/viewer", viewerRoutes(s));
  app.use("/api/chat", chatRoutes(s));
  app.use("/api/moderation", moderationRoutes(s));
  app.use("/api/demo", demoRoutes(s));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
