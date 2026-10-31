"use client";

import * as React from "react";
import { Activity, CircleHelp, Lightbulb, Loader2, MessagesSquare, RefreshCw, Smile, Tags } from "lucide-react";
import type { ChatSummary, SummaryItem } from "@breadcrumb/shared";
import { useToast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage } from "@/lib/api";
import { clockTime, cn, timeAgo } from "@/lib/utils";
import type { Dashboard } from "./useDashboard";

export function ChatPulsePanel({ dash }: { dash: Dashboard }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const refreshingRef = React.useRef(false);
  const latest = dash.summaries[0] ?? null;
  const stats = dash.stats;
  const interval = dash.status?.chatPulseIntervalSeconds ?? 0;

  const refresh = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setBusy(true);
    try {
      await dash.call<ChatSummary>("/api/chat/summaries/generate", { method: "POST", body: {} });
      await Promise.all([dash.reload.summaries(), dash.reload.stats()]);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      refreshingRef.current = false;
      setBusy(false);
    }
  };

  const sourceLabel = !stats || stats.messages === 0 ? null : stats.sources.includes("live") ? "Live Twitch chat" : "Simulated demo chat";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessagesSquare className="size-4 text-signal" /> Chat Pulse
              </CardTitle>
              <CardDescription>
                Private summary of recent chat. Spam and duplicates are left out.
                {interval > 0 ? ` New batches roughly every ${interval}s while this dashboard is open.` : " Automatic batches are off. Refresh manually."}
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Summarise last 10 min
            </Button>
          </CardHeader>
          <CardContent>
            {!latest ? (
              <Empty>No summaries yet. Breadcrumb summarises chat once messages arrive, or you can refresh manually.</Empty>
            ) : (
              <SummaryView summary={latest} />
            )}
          </CardContent>
        </Card>

        {dash.summaries.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Earlier batches</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-xs">
                {dash.summaries.slice(1).map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-mono text-subtle">
                      {clockTime(s.windowStart)}–{clockTime(s.windowEnd)}
                    </span>
                    <span className="text-muted">
                      {s.stats.analysedMessages} analysed · {s.topics.length} topics · {s.questions.length} questions
                    </span>
                    <StatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="size-4 text-sage" /> Last 10 minutes
            </CardTitle>
            <CardDescription>{sourceLabel ? `Counted from stored messages · ${sourceLabel}` : "No chat data received yet."}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2">
              <Stat label="Messages" value={stats?.messages} />
              <Stat label="Chatters" value={stats?.uniqueChatters} />
              <Stat label="Flagged" value={stats?.flagged} tone="ember" />
              <Stat label="Duplicates" value={stats?.duplicates} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent messages</CardTitle>
          </CardHeader>
          <CardContent>
            {!stats || stats.recent.length === 0 ? (
              <p className="text-xs text-muted">Nothing yet.</p>
            ) : (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1 text-xs">
                {[...stats.recent].reverse().map((m) => (
                  <li key={m.id} className={cn("break-words", m.flagged && "text-ember", m.duplicate && !m.flagged && "text-subtle")}>
                    <span className="font-medium text-muted">{m.chatter}:</span> {m.text}
                    {m.flagged && <span className="ml-1 text-[10px] uppercase">flagged</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryView({ summary }: { summary: ChatSummary }) {
  const s = summary.stats;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <StatusBadge status={summary.status} />
        <span>
          {clockTime(summary.windowStart)}–{clockTime(summary.windowEnd)} · {timeAgo(summary.createdAt)}
        </span>
        <Badge variant={summary.source === "live" ? "signal" : "crust"}>{summary.source === "live" ? "live chat" : "demo data"}</Badge>
        <Badge>{summary.provider === "openai" ? `OpenAI ${summary.model ?? ""}` : "demo heuristic (not AI)"}</Badge>
      </div>
      <p className="text-xs text-subtle">
        {s.totalMessages} messages from {s.uniqueChatters} chatters · {s.analysedMessages} analysed · {s.excludedSpam} spam excluded · {s.collapsedDuplicates} duplicates
        collapsed · {s.openFlags} open flags
      </p>

      {summary.status === "ERROR" ? (
        <p role="alert" className="rounded-lg border border-ember/30 bg-ember-soft p-3 text-sm text-ember">
          {summary.error ?? "Summary failed."}
        </p>
      ) : summary.status === "EMPTY" ? (
        <Empty>No usable messages in this window.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Section icon={<Tags className="text-signal" />} title="Main topics" items={summary.topics} />
          <Section icon={<CircleHelp className="text-crust" />} title="Repeated questions" items={summary.questions} empty="No question was asked more than once." />
          <Section icon={<Lightbulb className="text-honey" />} title="Gameplay suggestions" items={summary.suggestions} />
          <Section icon={<Smile className="text-sage" />} title="Reactions & requests" items={summary.reactions} />
        </div>
      )}
    </div>
  );
}

function Section({ icon, title, items, empty = "Nothing stood out." }: { icon: React.ReactNode; title: string; items: SummaryItem[]; empty?: string }) {
  return (
    <section className="rounded-xl border border-border bg-surface-2 p-4">
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold [&_svg]:size-4">
        {icon} {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-subtle">{empty}</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item, i) => (
            <li key={i}>
              <div className="flex items-start gap-2">
                <p className="flex-1 text-sm font-medium break-words">{item.label}</p>
                <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-muted" title="Distinct supporting messages">
                  ×{item.mentionCount}
                </span>
              </div>
              <p className="text-xs text-muted">{item.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: ChatSummary["status"] }) {
  return status === "READY" ? <Badge variant="sage">ready</Badge> : status === "EMPTY" ? <Badge>empty</Badge> : <Badge variant="ember">error</Badge>;
}

function Stat({ label, value, tone }: { label: string; value: number | undefined; tone?: "ember" }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <dt className="text-[11px] text-subtle">{label}</dt>
      <dd className={cn("mt-0.5 font-display text-xl font-semibold tabular-nums", tone === "ember" && value ? "text-ember" : "")}>{value ?? "–"}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-muted">{children}</div>;
}
