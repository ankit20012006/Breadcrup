"use client";

import * as React from "react";
import { Loader2, Plus } from "lucide-react";
import { LIMITS, type HintSession } from "@breadcrumb/shared";
import { CrumbMark } from "@/components/logo";
import { useToast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import type { Dashboard } from "./useDashboard";

export function SessionSidebar({ dash }: { dash: Dashboard }) {
  const [creating, setCreating] = React.useState(false);
  const hasOpen = dash.sessions.some((s) => s.status === "collecting");

  return (
    <aside className="space-y-4">
      {creating || dash.sessions.length === 0 ? (
        <CreateSessionForm dash={dash} onDone={() => setCreating(false)} canCancel={dash.sessions.length > 0} />
      ) : (
        <Button className="w-full" onClick={() => setCreating(true)}>
          <Plus /> New hint session
        </Button>
      )}
      {hasOpen && creating && <p className="px-1 text-xs text-subtle">The viewer panel always shows your newest open session.</p>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Sessions</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          {dash.sessions.length === 0 ? (
            <p className="px-3 pb-3 text-sm text-muted">No sessions yet.</p>
          ) : (
            <ul className="space-y-1">
              {dash.sessions.map((s) => (
                <SessionRow key={s.id} session={s} active={s.id === dash.selectedId} onSelect={() => dash.setSelectedId(s.id)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}

function SessionRow({ session, active, onSelect }: { session: HintSession; active: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={cn("w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-2", active && "bg-surface-3 hover:bg-surface-3")}
      >
        <div className="flex items-center gap-2">
          <CrumbMark className="size-4 shrink-0" lit={session.currentRevealedTier} />
          <span className="flex-1 truncate text-sm font-medium">{session.game}</span>
          {session.status === "collecting" ? <Badge variant="sage">Open</Badge> : <Badge>Closed</Badge>}
        </div>
        <p className="mt-1 line-clamp-2 pl-6 text-xs text-muted">{session.question}</p>
        <p className="mt-1 pl-6 text-[11px] text-subtle">
          {session.currentRevealedTier}/3 revealed · {timeAgo(session.createdAt)}
        </p>
      </button>
    </li>
  );
}

function CreateSessionForm({ dash, onDone, canCancel }: { dash: Dashboard; onDone: () => void; canCancel: boolean }) {
  const toast = useToast();
  const [game, setGame] = React.useState("");
  const [question, setQuestion] = React.useState("");
  const [context, setContext] = React.useState("");
  const [showCredits, setShowCredits] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const submittingRef = React.useRef(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const session = await dash.call<HintSession>("/api/sessions", { body: { game, question, context, showCredits } });
      await dash.reload.sessions();
      dash.setSelectedId(session.id);
      toast("success", "Session opened. Share the viewer panel to start collecting clues.");
      onDone();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Create hint session</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="game">Game</Label>
            <Input id="game" required maxLength={LIMITS.gameMaxLength} value={game} onChange={(e) => setGame(e.target.value)} placeholder="What are you playing?" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="question">What are you stuck on?</Label>
            <Textarea
              id="question"
              required
              minLength={3}
              maxLength={LIMITS.questionMaxLength}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="How do I open the sealed door?"
              className="min-h-16"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="context">Context (optional)</Label>
            <Textarea
              id="context"
              maxLength={LIMITS.contextMaxLength}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Where you are, what you've tried. The AI only uses what you write here and what viewers send."
              className="min-h-16"
            />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">Credit contributors on overlay</span>
            <Switch checked={showCredits} onCheckedChange={setShowCredits} aria-label="Credit contributors on overlay" />
          </label>
          <div className="flex gap-2 pt-1">
            <Button type="submit" className="flex-1" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Open session
            </Button>
            {canCancel && (
              <Button type="button" variant="ghost" onClick={onDone}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
