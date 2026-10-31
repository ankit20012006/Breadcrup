/**
 * Domain types shared by backend and frontend. Anything with a `Public` prefix is
 * safe to send to unauthenticated clients (viewer panel, OBS overlay). Everything
 * else is private to the owning streamer.
 */

export type DataSource = "live" | "demo";
export type AiProviderName = "openai" | "demo-heuristic";

export type HintTier = 1 | 2 | 3;
export type HintSetStatus = "READY" | "NEED_MORE_CLUES" | "NEED_REVIEW" | "ERROR";
export type TierApproval = "pending" | "approved" | "rejected" | "skipped";
export type SessionStatus = "collecting" | "closed";
export type SubmissionStatus = "pending" | "rejected";

export interface StreamerProfile {
  id: string;
  twitchUserId: string;
  login: string;
  displayName: string;
  isDemo: boolean;
  scopes: string[];
  chatConnected: boolean;
  canDeleteMessages: boolean;
}

export interface HintSession {
  id: string;
  streamerId: string;
  game: string;
  question: string;
  context: string;
  status: SessionStatus;
  currentRevealedTier: 0 | HintTier;
  showCredits: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface HintSubmission {
  id: string;
  sessionId: string;
  viewerId: string;
  viewerDisplayName: string | null;
  creditOptIn: boolean;
  text: string;
  status: SubmissionStatus;
  source: DataSource;
  createdAt: string;
}

export interface HintTierEntry {
  tier: HintTier;
  text: string;
  supportingSubmissionIds: string[];
  approval: TierApproval;
  revealedAt: string | null;
}

export interface HintSet {
  id: string;
  sessionId: string;
  version: number;
  status: HintSetStatus;
  reason: string | null;
  /** Submission IDs the model said were contradictory or unclear. Kept visible for review. */
  flaggedSubmissionIds: string[];
  tiers: HintTierEntry[];
  provider: AiProviderName;
  model: string | null;
  inputHash: string;
  isActive: boolean;
  createdAt: string;
}

export interface Contributor {
  displayName: string;
}

/** The only hint data that ever leaves the server unauthenticated. */
export interface PublicOverlayState {
  sessionId: string;
  game: string;
  status: SessionStatus;
  revealed: {
    tier: HintTier;
    label: string;
    text: string;
    revealedAt: string;
    credits: Contributor[];
  } | null;
  totalTiers: 3;
}

export interface PublicSessionInfo {
  id: string;
  game: string;
  question: string;
  status: SessionStatus;
  currentRevealedTier: 0 | HintTier;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  streamerId: string;
  twitchMessageId: string | null;
  chatterUserId: string;
  chatterLogin: string;
  chatterDisplayName: string;
  text: string;
  isPrivileged: boolean;
  isDuplicate: boolean;
  flagId: string | null;
  source: DataSource;
  sentAt: string;
}

export type FlagCategory = "duplicate" | "near_duplicate" | "flood" | "link_promo" | "copypasta";
export type FlagConfidence = "low" | "medium" | "high";
export type ReviewStatus = "open" | "dismissed" | "confirmed_spam";
export type ModerationAction = "none" | "deleted" | "delete_failed" | "demo_deleted";

export interface FlagReason {
  category: FlagCategory;
  detail: string;
}

export interface ModerationHistoryEntry {
  at: string;
  kind: "flagged" | "review" | "action";
  detail: string;
}

export interface ModerationFlag {
  id: string;
  streamerId: string;
  chatMessageId: string;
  twitchMessageId: string | null;
  chatterUserId: string;
  chatterLogin: string;
  messageText: string;
  reasons: FlagReason[];
  category: FlagCategory;
  confidence: FlagConfidence;
  reviewStatus: ReviewStatus;
  action: ModerationAction;
  actionDetail: string | null;
  history: ModerationHistoryEntry[];
  source: DataSource;
  messageSentAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SummaryItem {
  label: string;
  detail: string;
  /** Number of distinct supporting messages, computed server-side from evidence. */
  mentionCount: number;
  evidenceMessageIds: string[];
}

export interface ChatSummaryStats {
  totalMessages: number;
  uniqueChatters: number;
  analysedMessages: number;
  excludedSpam: number;
  collapsedDuplicates: number;
  openFlags: number;
}

export interface ChatSummary {
  id: string;
  streamerId: string;
  windowStart: string;
  windowEnd: string;
  status: "READY" | "EMPTY" | "ERROR";
  topics: SummaryItem[];
  questions: SummaryItem[];
  suggestions: SummaryItem[];
  reactions: SummaryItem[];
  stats: ChatSummaryStats;
  provider: AiProviderName;
  model: string | null;
  source: DataSource;
  error: string | null;
  createdAt: string;
}

export interface SystemStatus {
  mode: "demo" | "live";
  persistence: "supabase" | "memory";
  /** issue: an AI setup problem to show the streamer (e.g. OPENAI_MODEL missing), or null. */
  ai: { provider: AiProviderName; model: string | null; issue: string | null };
  twitch: { oauthConfigured: boolean; extensionConfigured: boolean };
  anonymousViewers: boolean;
  chatPulseIntervalSeconds: number;
}

/** Session detail as returned to the owning streamer. */
export interface SessionDetail {
  session: HintSession;
  submissions: HintSubmission[];
  hintSet: HintSet | null;
  overlay: PublicOverlayState;
  contributors: Contributor[];
}
