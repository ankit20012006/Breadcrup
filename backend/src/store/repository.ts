import type {
  ChatMessage,
  ChatSummary,
  HintSession,
  HintSet,
  HintSubmission,
  ModerationFlag,
} from "@breadcrumb/shared";

/** Server-side streamer record. Token fields are AES-GCM ciphertext, never plaintext. */
export interface StreamerConnection {
  id: string;
  twitchUserId: string;
  login: string;
  displayName: string;
  isDemo: boolean;
  scopes: string[];
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NewConnection = Omit<StreamerConnection, "id" | "createdAt" | "updatedAt">;
export type NewSession = Omit<HintSession, "id" | "createdAt" | "updatedAt" | "closedAt" | "currentRevealedTier" | "status">;
export type NewSubmission = Omit<HintSubmission, "id" | "createdAt" | "status">;
export type NewHintSet = Omit<HintSet, "id" | "createdAt" | "isActive" | "version">;
export type NewChatMessage = Omit<ChatMessage, "id" | "flagId" | "isDuplicate">;
export type NewFlag = Omit<ModerationFlag, "id" | "createdAt" | "updatedAt">;
export type NewSummary = Omit<ChatSummary, "id" | "createdAt">;

/**
 * Persistence boundary. Two implementations: Supabase Postgres (production) and
 * in-memory (demo mode / tests). Ownership checks happen in the service layer.
 */
export interface Repository {
  readonly kind: "supabase" | "memory";

  upsertConnection(input: NewConnection): Promise<StreamerConnection>;
  getConnection(id: string): Promise<StreamerConnection | null>;
  getConnectionByTwitchId(twitchUserId: string): Promise<StreamerConnection | null>;
  listTokenConnections(): Promise<StreamerConnection[]>;
  updateConnection(id: string, patch: Partial<NewConnection>): Promise<StreamerConnection>;

  createSession(input: NewSession): Promise<HintSession>;
  getSession(id: string): Promise<HintSession | null>;
  listSessions(streamerId: string, limit: number): Promise<HintSession[]>;
  getLatestOpenSession(streamerId: string): Promise<HintSession | null>;
  updateSession(id: string, patch: Partial<HintSession>): Promise<HintSession>;

  addSubmission(input: NewSubmission): Promise<HintSubmission>;
  listSubmissions(sessionId: string): Promise<HintSubmission[]>;
  updateSubmission(id: string, patch: Partial<HintSubmission>): Promise<HintSubmission>;

  /** Inserts a new version and marks it as the only active set for the session. */
  insertHintSet(input: NewHintSet): Promise<HintSet>;
  getActiveHintSet(sessionId: string): Promise<HintSet | null>;
  updateHintSet(id: string, patch: Partial<HintSet>): Promise<HintSet>;

  insertChatMessage(input: NewChatMessage): Promise<ChatMessage>;
  updateChatMessage(id: string, patch: Partial<ChatMessage>): Promise<void>;
  listChatMessages(streamerId: string, since: string, until: string, limit: number): Promise<ChatMessage[]>;
  countChatMessages(streamerId: string, since: string): Promise<number>;

  insertFlag(input: NewFlag): Promise<ModerationFlag>;
  getFlag(id: string): Promise<ModerationFlag | null>;
  listFlags(streamerId: string, status: ModerationFlag["reviewStatus"] | "all", limit: number): Promise<ModerationFlag[]>;
  updateFlag(id: string, patch: Partial<ModerationFlag>): Promise<ModerationFlag>;

  insertSummary(input: NewSummary): Promise<ChatSummary>;
  listSummaries(streamerId: string, limit: number): Promise<ChatSummary[]>;
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
  }
}
