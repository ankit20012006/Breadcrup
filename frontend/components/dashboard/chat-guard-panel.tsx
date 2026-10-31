"use client";

import * as React from "react";
import { Ban, Check, FlaskConical, Info, Loader2, RotateCcw, ShieldCheck, Trash2, X } from "lucide-react";
import type { FlagCategory, ModerationFlag, ReviewStatus } from "@breadcrumb/shared";
import { useToast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage } from "@/lib/api";
import { clockTime, cn } from "@/lib/utils";
import type { Dashboard } from "./useDashboard";

const CATEGORY_LABEL: Record<FlagCategory, string> = {
  duplicate: "Repeated message",
  near_duplicate: "Near-duplicate",
  flood: "Flooding",
  link_promo: "Link / promo",
  copypasta: "Copy-paste wave",
};

type Filter = ReviewStatus | "all";

export function ChatGuardPanel({ dash }: { dash: Dashboard }) {
  const toast = useToast();
  const [filter, setFilter] = React.useState<Filter>("open");
  const [busy, setBusy] = React.useState<string | null>(null);
  const actionInFlight = React.useRef(false);
  const counts = {
    open: dash.flags.filter((f) => f.reviewStatus === "open").length,
    confirmed_spam: dash.flags.filter((f) => f.reviewStatus === "confirmed_spam").length,
    dismissed: dash.flags.filter((f) => f.reviewStatus === "dismissed").length,
    all: dash.flags.length,
  };
  const visible = dash.flags.filter((f) => filter === "all" || f.reviewStatus === filter);
  const isDemo = dash.me?.isDemo ?? false;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      actionInFlight.current = false;
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="min-w-0">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-sage" /> Moderation queue
            </CardTitle>
            <CardDescription>Messages flagged by Breadcrumb&apos;s heuristics. Nothing is removed until you choose to.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1" role="tablist" aria-label="Filter flags">
            {(["open", "confirmed_spam", "dismissed", "all"] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn("cursor-pointer rounded-md px-2.5 py-1 text-xs text-muted hover:text-foreground", filter === f && "bg-surface-3 text-foreground")}
              >
                {f === "confirmed_spam" ? "Spam" : f[0]!.toUpperCase() + f.slice(1)} <span className="text-subtle">{counts[f]}</span>
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-strong p-8 text-center text-sm text-muted">
              {filter === "open" ? "No open flags. Chat looks clean." : "Nothing here."}
              {isDemo && filter === "open" && <p className="mt-1 text-xs text-subtle">Use “Simulate spam” to see how flags appear.</p>}
            </div>
          ) : (
            <ul className="space-y-2">
              {visible.map((flag) => (
                <FlagRow key={flag.id} flag={flag} busy={busy} dash={dash} run={run} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">How Chat Guard works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs leading-relaxed text-muted">
            <p>Deterministic checks for repeated messages, near-duplicates, floods, copy-paste waves and repeated links or promotions.</p>
            <p>Short hype repeats like “W” or “LUL” from many people are normal chat and are never flagged.</p>
            <p className="flex gap-1.5 text-subtle">
              <Info className="mt-0.5 size-3.5 shrink-0" /> Breadcrumb never bans anyone automatically. Keep Twitch AutoMod on. Breadcrumb works alongside it.
            </p>
            <div className="rounded-lg border border-border bg-surface-2 p-2.5">
              <p className="font-medium text-foreground">Message deletion</p>
              {isDemo ? (
                <p className="mt-0.5">Demo account: deletions are simulated and clearly labelled. No Twitch requests are made.</p>
              ) : dash.me?.canDeleteMessages ? (
                <p className="mt-0.5 text-sage">Available. Uses Twitch&apos;s Delete Chat Messages API with your moderator permission.</p>
              ) : (
                <p className="mt-0.5 text-ember">Unavailable. Reconnect Twitch and grant moderator:manage:chat_messages.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {isDemo && (
          <Card className="border-crust/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FlaskConical className="size-4 text-crust" /> Simulate spam
              </CardTitle>
              <CardDescription>Plays scripted spam into the demo chat.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {(
                [
                  ["link", "Promo links"],
                  ["copypasta", "Copy-paste wave"],
                  ["flood", "Flooding"],
                  ["mixed", "All of them"],
                ] as const
              ).map(([kind, label]) => (
                <Button
                  key={kind}
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => run(`burst-${kind}`, async () => {
                    await dash.call(`/api/demo/chat/burst`, { body: { kind } });
                    await dash.reload.flags();
                  })}
                >
                  {busy === `burst-${kind}` && <Loader2 className="animate-spin" />} {label}
                </Button>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function FlagRow({
  flag,
  busy,
  dash,
  run,
}: {
  flag: ModerationFlag;
  busy: string | null;
  dash: Dashboard;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const removed = flag.action === "deleted" || flag.action === "demo_deleted";

  const review = (status: ReviewStatus) =>
    run(`review-${flag.id}`, () => dash.call(`/api/moderation/flags/${flag.id}/review`, { body: { status } }).then(() => dash.reload.flags()));

  const remove = () =>
    run(`delete-${flag.id}`, async () => {
      const res = await dash.call<{ ok: boolean; flag: ModerationFlag }>(`/api/moderation/flags/${flag.id}/action`, { body: { action: "delete_message" } });
      setConfirmDelete(false);
      await dash.reload.flags();
      const detail = res.flag.actionDetail ?? (res.ok ? "Message removed" : "Deletion failed");
      toast(res.ok ? "success" : "error", res.flag.action === "demo_deleted" ? `Simulated removal (moved to Spam). ${detail}` : detail);
    });

  return (
    <li className={cn("rounded-lg border border-border bg-surface-2 p-3", flag.reviewStatus !== "open" && "opacity-75")}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-medium text-foreground">{flag.chatterLogin}</span>
        <Badge variant={flag.confidence === "high" ? "ember" : flag.confidence === "medium" ? "crust" : "default"}>{flag.confidence} confidence</Badge>
        <Badge variant="outline">{CATEGORY_LABEL[flag.category]}</Badge>
        <Badge variant={flag.source === "demo" ? "crust" : "signal"}>{flag.source === "demo" ? "demo data" : "live chat"}</Badge>
        {flag.reviewStatus === "confirmed_spam" && <Badge variant="ember">marked spam</Badge>}
        {flag.reviewStatus === "dismissed" && <Badge>dismissed</Badge>}
        {flag.action === "demo_deleted" && <Badge variant="crust">removed (simulated, not on Twitch)</Badge>}
        {flag.action === "deleted" && <Badge variant="signal">deleted on Twitch</Badge>}
        {flag.action === "delete_failed" && <Badge variant="ember">Twitch delete failed</Badge>}
        <span className="ml-auto text-subtle">{clockTime(flag.messageSentAt)}</span>
      </div>
      <p className="mt-1.5 break-words text-sm">{flag.messageText}</p>
      <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
        {flag.reasons.map((r, i) => (
          <li key={i}>• {r.detail}</li>
        ))}
      </ul>
      {flag.actionDetail && (
        <p className={cn("mt-2 rounded-md px-2 py-1 text-xs", flag.action === "delete_failed" ? "bg-ember-soft text-ember" : "bg-surface-3 text-muted")}>
          {flag.action === "demo_deleted" ? "Simulated: " : ""}
          {flag.actionDetail}
        </p>
      )}
      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        {flag.reviewStatus === "open" ? (
          <>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => review("dismissed")}>
              <Check /> Dismiss
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => review("confirmed_spam")}>
              <Ban /> Mark spam
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => review("open")}>
            <RotateCcw /> Reopen
          </Button>
        )}
        {!removed &&
          (confirmDelete ? (
            <>
              <Button size="sm" variant="danger" disabled={busy !== null} onClick={remove}>
                {busy === `delete-${flag.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
                {flag.source === "demo" ? "Confirm (simulated)" : "Confirm delete on Twitch"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} aria-label="Cancel delete">
                <X />
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger" disabled={busy !== null || (!dash.me?.canDeleteMessages && flag.source !== "demo")} onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete message
            </Button>
          ))}
      </div>
    </li>
  );
}
