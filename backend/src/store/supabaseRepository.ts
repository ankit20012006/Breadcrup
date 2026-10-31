import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage, ChatSummary, HintSession, HintSet, HintSubmission, ModerationFlag } from "@breadcrumb/shared";
import {
  NotFoundError,
  type NewChatMessage,
  type NewConnection,
  type NewFlag,
  type NewHintSet,
  type NewSession,
  type NewSubmission,
  type NewSummary,
  type Repository,
  type StreamerConnection,
} from "./repository";

type Row = Record<string, any>;

// ---- row <-> domain mappers -------------------------------------------------

const toConnection = (r: Row): StreamerConnection => ({
  id: r.id,
  twitchUserId: r.twitch_user_id,
  login: r.login,
  displayName: r.display_name,
  isDemo: r.is_demo,
  scopes: r.scopes ?? [],
  accessTokenEnc: r.access_token_enc,
  refreshTokenEnc: r.refresh_token_enc,
  tokenExpiresAt: r.token_expires_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const fromConnection = (c: Partial<NewConnection>): Row =>
  stripUndefined({
    twitch_user_id: c.twitchUserId,
    login: c.login,
    display_name: c.displayName,
    is_demo: c.isDemo,
    scopes: c.scopes,
    access_token_enc: c.accessTokenEnc,
    refresh_token_enc: c.refreshTokenEnc,
    token_expires_at: c.tokenExpiresAt,
  });

const toSession = (r: Row): HintSession => ({
  id: r.id,
  streamerId: r.streamer_id,
  game: r.game,
  question: r.question,
  context: r.context,
  status: r.status,
  currentRevealedTier: r.current_revealed_tier,
  showCredits: r.show_credits,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  closedAt: r.closed_at,
});

const fromSession = (s: Partial<HintSession>): Row =>
  stripUndefined({
    streamer_id: s.streamerId,
    game: s.game,
    question: s.question,
    context: s.context,
    status: s.status,
    current_revealed_tier: s.currentRevealedTier,
    show_credits: s.showCredits,
    closed_at: s.closedAt,
  });

const toSubmission = (r: Row): HintSubmission => ({
  id: r.id,
  sessionId: r.session_id,
  viewerId: r.viewer_id,
  viewerDisplayName: r.viewer_display_name,
  creditOptIn: r.credit_opt_in,
  text: r.text,
  status: r.status,
  source: r.source,
  createdAt: r.created_at,
});

const toHintSet = (r: Row): HintSet => ({
  id: r.id,
  sessionId: r.session_id,
  version: r.version,
  status: r.status,
  reason: r.reason,
  flaggedSubmissionIds: r.flagged_submission_ids ?? [],
  tiers: r.tiers ?? [],
  provider: r.provider,
  model: r.model,
  inputHash: r.input_hash,
  isActive: r.is_active,
  createdAt: r.created_at,
});

const toChat = (r: Row): ChatMessage => ({
  id: r.id,
  streamerId: r.streamer_id,
  twitchMessageId: r.twitch_message_id,
  chatterUserId: r.chatter_user_id,
  chatterLogin: r.chatter_login,
  chatterDisplayName: r.chatter_display_name,
  text: r.text,
  isPrivileged: r.is_privileged,
  isDuplicate: r.is_duplicate,
  flagId: r.flag_id,
  source: r.source,
  sentAt: r.sent_at,
});

const toFlag = (r: Row): ModerationFlag => ({
  id: r.id,
  streamerId: r.streamer_id,
  chatMessageId: r.chat_message_id,
  twitchMessageId: r.twitch_message_id,
  chatterUserId: r.chatter_user_id,
  chatterLogin: r.chatter_login,
  messageText: r.message_text,
  reasons: r.reasons ?? [],
  category: r.category,
  confidence: r.confidence,
  reviewStatus: r.review_status,
  action: r.action,
  actionDetail: r.action_detail,
  history: r.history ?? [],
  source: r.source,
  messageSentAt: r.message_sent_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const fromFlag = (f: Partial<ModerationFlag>): Row =>
  stripUndefined({
    streamer_id: f.streamerId,
    chat_message_id: f.chatMessageId,
    twitch_message_id: f.twitchMessageId,
    chatter_user_id: f.chatterUserId,
    chatter_login: f.chatterLogin,
    message_text: f.messageText,
    reasons: f.reasons,
    category: f.category,
    confidence: f.confidence,
    review_status: f.reviewStatus,
    action: f.action,
    action_detail: f.actionDetail,
    history: f.history,
    source: f.source,
    message_sent_at: f.messageSentAt,
  });

const toSummary = (r: Row): ChatSummary => ({
  id: r.id,
  streamerId: r.streamer_id,
  windowStart: r.window_start,
  windowEnd: r.window_end,
  status: r.status,
  topics: r.topics ?? [],
  questions: r.questions ?? [],
  suggestions: r.suggestions ?? [],
  reactions: r.reactions ?? [],
  stats: r.stats,
  provider: r.provider,
  model: r.model,
  source: r.source,
  error: r.error,
  createdAt: r.created_at,
});

function stripUndefined(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
}

function check<T>(result: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) throw new Error(`Supabase ${what} failed: ${result.error.message}`);
  if (result.data === null) throw new NotFoundError(what);
  return result.data;
}

// ---- repository -------------------------------------------------------------

export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async upsertConnection(input: NewConnection) {
    const res = await this.db
      .from("streamer_connections")
      .upsert(fromConnection(input), { onConflict: "twitch_user_id" })
      .select()
      .single();
    return toConnection(check(res, "upsert connection"));
  }

  async getConnection(id: string) {
    const res = await this.db.from("streamer_connections").select().eq("id", id).maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return res.data ? toConnection(res.data) : null;
  }

  async getConnectionByTwitchId(twitchUserId: string) {
    const res = await this.db.from("streamer_connections").select().eq("twitch_user_id", twitchUserId).maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return res.data ? toConnection(res.data) : null;
  }

  async listTokenConnections() {
    const res = await this.db
      .from("streamer_connections")
      .select()
      .eq("is_demo", false)
      .not("access_token_enc", "is", null);
    return check(res, "list connections").map(toConnection);
  }

  async updateConnection(id: string, patch: Partial<NewConnection>) {
    const res = await this.db.from("streamer_connections").update(fromConnection(patch)).eq("id", id).select().single();
    return toConnection(check(res, "update connection"));
  }

  async createSession(input: NewSession) {
    const res = await this.db.from("hint_sessions").insert(fromSession(input)).select().single();
    return toSession(check(res, "create session"));
  }

  async getSession(id: string) {
    const res = await this.db.from("hint_sessions").select().eq("id", id).maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return res.data ? toSession(res.data) : null;
  }

  async listSessions(streamerId: string, limit: number) {
    const res = await this.db
      .from("hint_sessions")
      .select()
      .eq("streamer_id", streamerId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return check(res, "list sessions").map(toSession);
  }

  async getLatestOpenSession(streamerId: string) {
    const res = await this.db
      .from("hint_sessions")
      .select()
      .eq("streamer_id", streamerId)
      .eq("status", "collecting")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return res.data ? toSession(res.data) : null;
  }

  async updateSession(id: string, patch: Partial<HintSession>) {
    const res = await this.db.from("hint_sessions").update(fromSession(patch)).eq("id", id).select().single();
    return toSession(check(res, "update session"));
  }

  async addSubmission(input: NewSubmission) {
    const res = await this.db
      .from("hint_submissions")
      .insert({
        session_id: input.sessionId,
        viewer_id: input.viewerId,
        viewer_display_name: input.viewerDisplayName,
        credit_opt_in: input.creditOptIn,
        text: input.text,
        source: input.source,
      })
      .select()
      .single();
    return toSubmission(check(res, "add submission"));
  }

  async listSubmissions(sessionId: string) {
    const res = await this.db
      .from("hint_submissions")
      .select()
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    return check(res, "list submissions").map(toSubmission);
  }

  async updateSubmission(id: string, patch: Partial<HintSubmission>) {
    const res = await this.db
      .from("hint_submissions")
      .update(stripUndefined({ status: patch.status }))
      .eq("id", id)
      .select()
      .single();
    return toSubmission(check(res, "update submission"));
  }

  async insertHintSet(input: NewHintSet) {
    const res = await this.db
      .rpc("insert_hint_set", {
        p: {
          session_id: input.sessionId,
          status: input.status,
          reason: input.reason,
          flagged_submission_ids: input.flaggedSubmissionIds,
          tiers: input.tiers,
          provider: input.provider,
          model: input.model,
          input_hash: input.inputHash,
        },
      })
      .single();
    return toHintSet(check(res as { data: Row | null; error: any }, "insert hint set"));
  }

  async getActiveHintSet(sessionId: string) {
    const res = await this.db.from("hint_sets").select().eq("session_id", sessionId).eq("is_active", true).maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return res.data ? toHintSet(res.data) : null;
  }

  async updateHintSet(id: string, patch: Partial<HintSet>) {
    const res = await this.db
      .from("hint_sets")
      .update(
        stripUndefined({
          status: patch.status,
          reason: patch.reason,
          tiers: patch.tiers,
          flagged_submission_ids: patch.flaggedSubmissionIds,
        }),
      )
      .eq("id", id)
      .select()
      .single();
    return toHintSet(check(res, "update hint set"));
  }

  async insertChatMessage(input: NewChatMessage) {
    const row = {
      streamer_id: input.streamerId,
      twitch_message_id: input.twitchMessageId,
      chatter_user_id: input.chatterUserId,
      chatter_login: input.chatterLogin,
      chatter_display_name: input.chatterDisplayName,
      text: input.text,
      is_privileged: input.isPrivileged,
      source: input.source,
      sent_at: input.sentAt,
    };
    const res = await this.db.from("chat_messages").insert(row).select().single();
    return toChat(check(res, "insert chat message"));
  }

  async updateChatMessage(id: string, patch: Partial<ChatMessage>) {
    const res = await this.db
      .from("chat_messages")
      .update(stripUndefined({ is_duplicate: patch.isDuplicate, flag_id: patch.flagId }))
      .eq("id", id);
    if (res.error) throw new Error(res.error.message);
  }

  async listChatMessages(streamerId: string, since: string, until: string, limit: number) {
    const res = await this.db
      .from("chat_messages")
      .select()
      .eq("streamer_id", streamerId)
      .gt("sent_at", since)
      .lte("sent_at", until)
      .order("sent_at", { ascending: false })
      .limit(limit);
    return check(res, "list chat").map(toChat).reverse();
  }

  async countChatMessages(streamerId: string, since: string) {
    const res = await this.db
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("streamer_id", streamerId)
      .gt("sent_at", since);
    if (res.error) throw new Error(res.error.message);
    return res.count ?? 0;
  }

  async insertFlag(input: NewFlag) {
    const res = await this.db.from("moderation_events").insert(fromFlag(input)).select().single();
    return toFlag(check(res, "insert flag"));
  }

  async getFlag(id: string) {
    const res = await this.db.from("moderation_events").select().eq("id", id).maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return res.data ? toFlag(res.data) : null;
  }

  async listFlags(streamerId: string, status: ModerationFlag["reviewStatus"] | "all", limit: number) {
    let query = this.db.from("moderation_events").select().eq("streamer_id", streamerId);
    if (status !== "all") query = query.eq("review_status", status);
    const res = await query.order("created_at", { ascending: false }).limit(limit);
    return check(res, "list flags").map(toFlag);
  }

  async updateFlag(id: string, patch: Partial<ModerationFlag>) {
    const res = await this.db.from("moderation_events").update(fromFlag(patch)).eq("id", id).select().single();
    return toFlag(check(res, "update flag"));
  }

  async insertSummary(input: NewSummary) {
    const res = await this.db
      .from("chat_summaries")
      .insert({
        streamer_id: input.streamerId,
        window_start: input.windowStart,
        window_end: input.windowEnd,
        status: input.status,
        topics: input.topics,
        questions: input.questions,
        suggestions: input.suggestions,
        reactions: input.reactions,
        stats: input.stats,
        provider: input.provider,
        model: input.model,
        source: input.source,
        error: input.error,
      })
      .select()
      .single();
    return toSummary(check(res, "insert summary"));
  }

  async listSummaries(streamerId: string, limit: number) {
    const res = await this.db
      .from("chat_summaries")
      .select()
      .eq("streamer_id", streamerId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return check(res, "list summaries").map(toSummary);
  }
}
