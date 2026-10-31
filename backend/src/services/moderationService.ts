import { SOCKET_EVENTS, type ModerationFlag, type ReviewStatus } from "@breadcrumb/shared";
import { deleteChatMessage, type HelixResult } from "../integrations/twitch/helix";
import type { TwitchTokenManager } from "../integrations/twitch/tokenManager";
import { HttpError } from "../middleware/errors";
import type { Realtime } from "../realtime/realtime";
import type { Repository, StreamerConnection } from "../store/repository";

export const DELETE_SCOPE = "moderator:manage:chat_messages";
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

type DeleteFn = typeof deleteChatMessage;

export class ModerationService {
  constructor(
    private repo: Repository,
    private tokens: TwitchTokenManager,
    private rt: Realtime,
    /** Injectable for tests. */
    private deleteMessage: DeleteFn = deleteChatMessage,
  ) {}

  list(streamerId: string, status: ReviewStatus | "all") {
    return this.repo.listFlags(streamerId, status, 100);
  }

  private async owned(streamerId: string, flagId: string): Promise<ModerationFlag> {
    const flag = await this.repo.getFlag(flagId);
    if (!flag || flag.streamerId !== streamerId) throw new HttpError(404, "Flag not found", "NOT_FOUND");
    return flag;
  }

  async review(streamerId: string, flagId: string, status: ReviewStatus): Promise<ModerationFlag> {
    const flag = await this.owned(streamerId, flagId);
    const updated = await this.repo.updateFlag(flagId, {
      reviewStatus: status,
      history: [...flag.history, { at: new Date().toISOString(), kind: "review", detail: `Marked as ${status.replace("_", " ")}` }],
    });
    this.rt.toStreamer(streamerId, SOCKET_EVENTS.flagUpdated, updated);
    return updated;
  }

  /**
   * Deletes the flagged message via Twitch only after an explicit streamer action.
   * Demo flags never call Twitch and are recorded as "demo_deleted".
   */
  async deleteFlaggedMessage(streamer: StreamerConnection, flagId: string): Promise<{ flag: ModerationFlag; ok: boolean }> {
    const flag = await this.owned(streamer.id, flagId);
    if (flag.action === "deleted" || flag.action === "demo_deleted") {
      throw new HttpError(409, "This message was already removed", "ALREADY_DELETED");
    }

    const at = new Date().toISOString();
    if (streamer.isDemo || flag.source === "demo") {
      return this.record(streamer.id, flag, {
        ok: true,
        action: "demo_deleted",
        detail: "Demo mode: simulated removal. No Twitch API request was made.",
        at,
      });
    }

    if (!streamer.scopes.includes(DELETE_SCOPE)) {
      throw new HttpError(403, `Reconnect Twitch and grant "${DELETE_SCOPE}" to delete messages`, "MISSING_SCOPE");
    }
    if (!flag.twitchMessageId) throw new HttpError(409, "This flag has no Twitch message ID", "NO_MESSAGE_ID");
    if (Date.now() - Date.parse(flag.messageSentAt) > SIX_HOURS_MS) {
      throw new HttpError(409, "Twitch only allows deleting messages from the last 6 hours", "MESSAGE_TOO_OLD");
    }

    let result: HelixResult;
    try {
      let token = await this.tokens.getAccessToken(streamer);
      // The broadcaster acts as their own moderator: moderator_id must match the token's user.
      result = await this.deleteMessage(token, streamer.twitchUserId, streamer.twitchUserId, flag.twitchMessageId);
      if (result.status === 401) {
        token = await this.tokens.getAccessToken(streamer, { forceRefresh: true });
        result = await this.deleteMessage(token, streamer.twitchUserId, streamer.twitchUserId, flag.twitchMessageId);
      }
    } catch (err) {
      result = { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : String(err) };
    }

    return this.record(streamer.id, flag, {
      ok: result.ok,
      action: result.ok ? "deleted" : "delete_failed",
      detail: result.ok
        ? `Twitch confirmed deletion (HTTP ${result.status}).`
        : `Twitch rejected the deletion${result.status ? ` (HTTP ${result.status})` : ""}: ${result.error ?? "unknown error"}`,
      at,
    });
  }

  private async record(
    streamerId: string,
    flag: ModerationFlag,
    r: { ok: boolean; action: ModerationFlag["action"]; detail: string; at: string },
  ) {
    const updated = await this.repo.updateFlag(flag.id, {
      action: r.action,
      actionDetail: r.detail,
      reviewStatus: r.ok ? "confirmed_spam" : flag.reviewStatus,
      history: [...flag.history, { at: r.at, kind: "action", detail: r.detail }],
    });
    this.rt.toStreamer(streamerId, SOCKET_EVENTS.moderationActionCompleted, { flag: updated, ok: r.ok });
    return { flag: updated, ok: r.ok };
  }
}
