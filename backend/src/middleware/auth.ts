import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifyAppToken } from "../services/appTokens";
import { verifyExtensionJwt } from "../integrations/twitch/extensionJwt";
import type { Repository, StreamerConnection } from "../store/repository";
import { HttpError } from "./errors";

export interface ViewerIdentity {
  /** Opaque, Breadcrumb-scoped viewer id (prefixed by origin). */
  viewerId: string;
  /** Streamer connection the viewer is attached to, when known (extension context). */
  channelConnectionId: string | null;
  origin: "twitch-extension" | "anonymous";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      streamer?: StreamerConnection;
      viewer?: ViewerIdentity;
    }
  }
}

export function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

export function requireStreamer(repo: Repository): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) return next(new HttpError(401, "Sign in required", "UNAUTHENTICATED"));
    const claims = await verifyAppToken(token);
    if (!claims || claims.kind !== "streamer") return next(new HttpError(401, "Invalid or expired session", "UNAUTHENTICATED"));
    const connection = await repo.getConnection(claims.sub);
    if (!connection) return next(new HttpError(401, "Streamer account no longer exists", "UNAUTHENTICATED"));
    req.streamer = connection;
    next();
  };
}

/**
 * Accepts either a Twitch Extension JWT (verified with the extension secret) or a
 * Breadcrumb anonymous viewer token (issued only when anonymous viewers are allowed).
 */
export function requireViewer(repo: Repository): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) return next(new HttpError(401, "Viewer token required", "UNAUTHENTICATED"));

    const app = await verifyAppToken(token);
    if (app?.kind === "viewer") {
      // A token can outlive its channel (e.g. the in-memory demo store restarted). Force a refresh.
      if (app.channel && !(await repo.getConnection(app.channel))) {
        return next(new HttpError(401, "Viewer session expired; reload to continue", "UNAUTHENTICATED"));
      }
      req.viewer = { viewerId: `anon:${app.sub}`, channelConnectionId: app.channel, origin: "anonymous" };
      return next();
    }

    const ext = await verifyExtensionJwt(token);
    if (ext) {
      const connection = await repo.getConnectionByTwitchId(ext.channelId);
      req.viewer = {
        viewerId: `ext:${ext.opaqueUserId}`,
        channelConnectionId: connection?.id ?? null,
        origin: "twitch-extension",
      };
      return next();
    }

    next(new HttpError(401, "Invalid or expired viewer token", "UNAUTHENTICATED"));
  };
}

/** Wraps async handlers so rejections reach the error middleware (Express 5 does this too; kept explicit). */
export const asyncHandler =
  <T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req as T, res, next).catch(next);
  };
