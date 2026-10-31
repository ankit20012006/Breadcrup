import { createAiProvider } from "./ai";
import type { AiProvider } from "./ai/types";
import { config } from "./config";
import { DemoService } from "./demo/demoService";
import { EventSubManager } from "./integrations/twitch/eventsub";
import type { deleteChatMessage } from "./integrations/twitch/helix";
import { TwitchTokenManager } from "./integrations/twitch/tokenManager";
import { RealtimeProxy } from "./realtime/realtime";
import { ChatGuard } from "./services/chatGuard";
import { ChatPulse } from "./services/chatPulse";
import { ChatService } from "./services/chatService";
import { HintService } from "./services/hintService";
import { ModerationService } from "./services/moderationService";
import { MemoryRepository } from "./store/memoryRepository";
import type { Repository } from "./store/repository";
import { SupabaseRepository } from "./store/supabaseRepository";

export interface Services {
  repo: Repository;
  ai: AiProvider;
  /** Human-readable AI setup problem shown in the dashboard, or null. */
  aiIssue: string | null;
  realtime: RealtimeProxy;
  hints: HintService;
  chat: ChatService;
  guard: ChatGuard;
  pulse: ChatPulse;
  moderation: ModerationService;
  tokens: TwitchTokenManager;
  eventsub: EventSubManager;
  demo: DemoService;
}

export function createServices(overrides: { repo?: Repository; ai?: AiProvider; deleteMessage?: typeof deleteChatMessage } = {}): Services {
  const repo = overrides.repo ?? (config.supabase ? new SupabaseRepository(config.supabase.url, config.supabase.serviceRoleKey) : new MemoryRepository());
  const { provider: ai, issue: aiIssue } = overrides.ai ? { provider: overrides.ai, issue: null } : createAiProvider();
  const realtime = new RealtimeProxy();
  const guard = new ChatGuard(config.guard);
  const tokens = new TwitchTokenManager(repo);
  const hints = new HintService(repo, ai, realtime);
  const chat = new ChatService(repo, guard, realtime);
  const pulse = new ChatPulse(repo, ai, realtime, config.chatPulse);
  const moderation = new ModerationService(repo, tokens, realtime, overrides.deleteMessage);
  const eventsub = new EventSubManager(repo, tokens, (connectionId, msg) => {
    chat.ingest(connectionId, { ...msg, source: "live" }).catch((err) => console.error("[chat] ingest failed", err));
  });
  const demo = new DemoService(repo, hints, chat);
  return { repo, ai, aiIssue, realtime, hints, chat, guard, pulse, moderation, tokens, eventsub, demo };
}
