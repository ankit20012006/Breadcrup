import type { FlagCategory, FlagConfidence, FlagReason } from "@breadcrumb/shared";
import type { GuardConfig } from "../config";
import { extractDomains, jaccard, normalize, shingles } from "./text";

export interface GuardInput {
  id: string;
  chatterUserId: string;
  text: string;
  /** Broadcaster/moderator/VIP: never flagged. */
  isPrivileged: boolean;
  sentAtMs: number;
}

export interface GuardVerdict {
  /** Message repeats recent chat; excluded from Chat Pulse analysis. Not a flag by itself. */
  isDuplicate: boolean;
  flag: { reasons: FlagReason[]; category: FlagCategory; confidence: FlagConfidence } | null;
}

interface Entry {
  id: string;
  user: string;
  norm: string;
  grams: Set<string>;
  domains: string[];
  at: number;
}

const PROMO_RE = /\b(follow(ers)?|viewers|subs|cheap|promo|discount|free|giveaway|check out my|visit|buy|sell|best .{1,20} on|primes?)\b/i;
const RANK: Record<FlagConfidence, number> = { low: 0, medium: 1, high: 2 };
const BY_RANK: FlagConfidence[] = ["low", "medium", "high"];
const MAX_ENTRIES_PER_CHANNEL = 2000;
/** Normalised messages shorter than this count as reactions, not repeat spam. */
const SHORT_REACTION_MAX_LENGTH = 8;

/**
 * Deterministic first-pass spam heuristics. It is an assistant to Twitch AutoMod,
 * not a replacement: it only *flags* for human review and never bans or deletes.
 */
export class ChatGuard {
  private history = new Map<string, Entry[]>();

  constructor(private cfg: GuardConfig) {}

  evaluate(channelId: string, msg: GuardInput): GuardVerdict {
    const now = msg.sentAtMs;
    const horizon = Math.max(this.cfg.linkWindowSeconds, this.cfg.duplicateWindowSeconds * 2, this.cfg.floodWindowSeconds) * 1000;
    const entries = (this.history.get(channelId) ?? []).filter((e) => now - e.at <= horizon);

    const entry: Entry = {
      id: msg.id,
      user: msg.chatterUserId,
      norm: normalize(msg.text),
      grams: shingles(msg.text),
      domains: extractDomains(msg.text),
      at: now,
    };

    const within = (seconds: number) => entries.filter((e) => now - e.at <= seconds * 1000);
    const dupWindow = within(this.cfg.duplicateWindowSeconds);
    const identicalAny = dupWindow.filter((e) => e.norm === entry.norm && entry.norm.length > 0);
    const sameUser = (list: Entry[]) => list.filter((e) => e.user === entry.user);

    const reasons: (FlagReason & { confidence: FlagConfidence })[] = [];
    let isDuplicate = identicalAny.length > 0;

    if (!msg.isPrivileged) {
      // 1. Same account repeating the exact same message. Short reactions ("LUL", "W",
      //    "gg") repeated by one person are normal chat; only the flood rule covers those.
      const repeats = sameUser(identicalAny).length;
      if (entry.norm.length >= SHORT_REACTION_MAX_LENGTH && repeats >= this.cfg.duplicateThreshold - 1) {
        reasons.push({
          category: "duplicate",
          detail: `Same message sent ${repeats + 1} times by this account within ${this.cfg.duplicateWindowSeconds}s`,
          confidence: repeats >= this.cfg.duplicateThreshold ? "high" : "medium",
        });
      }

      // 2. Same account posting slightly altered copies (evading exact matching).
      const nearSelf = sameUser(within(this.cfg.duplicateWindowSeconds * 2)).filter(
        (e) => e.norm !== entry.norm && jaccard(e.grams, entry.grams) >= this.cfg.similarityThreshold,
      );
      if (nearSelf.length > 0) isDuplicate = true;
      if (nearSelf.length + sameUser(identicalAny).length >= this.cfg.duplicateThreshold - 1 && nearSelf.length > 0) {
        reasons.push({
          category: "near_duplicate",
          detail: `${nearSelf.length + 1} near-identical messages from this account`,
          confidence: "medium",
        });
      }

      // 3. Long copy-paste blocks spreading across several accounts. Short repeated
      //    messages ("W", "LUL", "gg") are normal hype and are never flagged.
      if (entry.norm.length >= this.cfg.copypastaMinLength) {
        const similarOthers = dupWindow.filter(
          (e) => e.user !== entry.user && (e.norm === entry.norm || jaccard(e.grams, entry.grams) >= this.cfg.similarityThreshold),
        );
        const accounts = new Set(similarOthers.map((e) => e.user)).size;
        if (similarOthers.length > 0) isDuplicate = true;
        if (accounts >= this.cfg.duplicateThreshold - 1) {
          reasons.push({
            category: "copypasta",
            detail: `Copy-pasted by ${accounts + 1} accounts within ${this.cfg.duplicateWindowSeconds}s`,
            confidence: accounts >= this.cfg.duplicateThreshold + 1 ? "medium" : "low",
          });
        }
      }

      // 4. Flooding: too many messages from one account in a short window.
      const recentByUser = sameUser(within(this.cfg.floodWindowSeconds)).length + 1;
      if (recentByUser >= this.cfg.floodThreshold) {
        reasons.push({
          category: "flood",
          detail: `${recentByUser} messages in ${this.cfg.floodWindowSeconds}s from this account`,
          confidence: recentByUser >= this.cfg.floodThreshold * 2 ? "high" : "medium",
        });
      }

      // 5. Links: a single link is fine. Repeated domains or promo wording are not.
      if (entry.domains.length > 0) {
        const linkWindow = within(this.cfg.linkWindowSeconds);
        const promo = PROMO_RE.test(msg.text);
        for (const domain of new Set(entry.domains)) {
          const withDomain = linkWindow.filter((e) => e.domains.includes(domain));
          const byUser = sameUser(withDomain).length;
          if (withDomain.length >= this.cfg.linkThreshold - 1 || byUser >= 1) {
            reasons.push({
              category: "link_promo",
              detail:
                byUser >= 1
                  ? `This account posted ${domain} ${byUser + 1} times`
                  : `${domain} posted ${withDomain.length + 1} times in ${Math.round(this.cfg.linkWindowSeconds / 60)} min`,
              confidence: promo ? "high" : "medium",
            });
          } else if (promo) {
            reasons.push({ category: "link_promo", detail: `Link to ${domain} with promotional wording`, confidence: "low" });
          }
        }
      }
    }

    entries.push(entry);
    if (entries.length > MAX_ENTRIES_PER_CHANNEL) entries.splice(0, entries.length - MAX_ENTRIES_PER_CHANNEL);
    this.history.set(channelId, entries);

    if (reasons.length === 0) return { isDuplicate, flag: null };

    const top = [...reasons].sort((a, b) => RANK[b.confidence] - RANK[a.confidence])[0]!;
    // Independent signals agreeing raise confidence by one level.
    const distinctCategories = new Set(reasons.map((r) => r.category)).size;
    const confidence = BY_RANK[Math.min(2, RANK[top.confidence] + (distinctCategories >= 2 ? 1 : 0))]!;
    return {
      isDuplicate,
      flag: { reasons: reasons.map(({ category, detail }) => ({ category, detail })), category: top.category, confidence },
    };
  }

  reset(channelId?: string) {
    if (channelId) this.history.delete(channelId);
    else this.history.clear();
  }
}
