"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, LogOut, MessagesSquare, RefreshCw, ShieldCheck } from "lucide-react";
import { CrumbMark, TwitchGlyph, Wordmark } from "@/components/logo";
import { useToast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API_URL, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChatGuardPanel } from "./chat-guard-panel";
import { ChatPulsePanel } from "./chat-pulse-panel";
import { SessionSidebar } from "./session-sidebar";
import { SessionWorkspace } from "./session-workspace";
import type { Dashboard, SocketState } from "./useDashboard";

const TABS = ["hints", "guard", "pulse"] as const;
type Tab = (typeof TABS)[number];

export function DashboardShell({ dash }: { dash: Dashboard }) {
  const toast = useToast();
  const [disconnecting, setDisconnecting] = React.useState(false);
  const openFlags = dash.flags.filter((f) => f.reviewStatus === "open").length;
  // ?tab=guard|pulse deep-links to a tab and keeps it across reloads.
  const [tab, setTab] = React.useState<Tab>("hints");
  React.useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (TABS.includes(fromUrl as Tab)) setTab(fromUrl as Tab);
  }, []);
  const changeTab = (value: string) => {
    setTab(value as Tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    url.searchParams.delete("demo");
    history.replaceState(null, "", url);
  };
  const disconnectTwitch = async () => {
    if (disconnecting || !window.confirm("Disconnect Twitch and stop reading live chat?")) return;
    setDisconnecting(true);
    try {
      const revoked = await dash.disconnectTwitch();
      toast("success", revoked ? "Twitch disconnected and its access token revoked." : "Disconnected from Breadcrumb. Twitch token revocation could not be confirmed; check your Twitch connected apps.");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Breadcrumb home">
            <Wordmark />
          </Link>
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <StatusPills dash={dash} />
          </div>
          {dash.me && (
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden text-muted sm:inline">{dash.me.displayName}</span>
              {dash.me.isDemo && dash.status?.twitch.oauthConfigured && (
                <Button asChild size="sm" variant="outline" aria-label="Connect with Twitch">
                  <a href={`${API_URL}/api/auth/twitch/login`}>
                    <TwitchGlyph /> <span className="hidden sm:inline">Connect Twitch</span>
                  </a>
                </Button>
              )}
              {!dash.me.isDemo && (
                <Button variant="ghost" size="sm" onClick={disconnectTwitch} disabled={disconnecting} aria-label="Disconnect Twitch">
                  {disconnecting ? <Loader2 className="animate-spin" /> : <LogOut />}
                  <span className="hidden sm:inline">Disconnect Twitch</span>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={dash.signOut} aria-label="Sign out">
                <LogOut /> <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          )}
        </div>
      </header>

      {dash.status?.ai.issue && (
        <div role="alert" className="mx-auto mt-4 max-w-[1500px] px-4 sm:px-6">
          <p className="rounded-lg border border-ember/30 bg-ember-soft px-4 py-2.5 text-sm text-ember">
            <strong className="font-semibold">AI setup issue:</strong> {dash.status.ai.issue}
          </p>
        </div>
      )}

      {dash.dataLoading && (
        <p role="status" className="mx-auto mt-4 flex max-w-[1500px] items-center gap-2 px-4 text-sm text-muted sm:px-6">
          <Loader2 className="size-4 animate-spin" /> Loading dashboard data…
        </p>
      )}
      {dash.dataError && (
        <div role="alert" className="mx-auto mt-4 flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
          <p className="text-sm text-ember">{dash.dataError}</p>
          <Button size="sm" variant="outline" onClick={() => void dash.reload.all()}>
            <RefreshCw /> Retry
          </Button>
        </div>
      )}
      {dash.me && !dash.me.isDemo && !dash.me.chatConnected && (
        <p role="status" className="mx-auto mt-3 max-w-[1500px] px-4 text-sm text-ember sm:px-6">
          Twitch chat is not connected{dash.chatStatus?.lastError ? `: ${dash.chatStatus.lastError}` : ". Waiting for EventSub subscription."}
        </p>
      )}

      <Tabs value={tab} onValueChange={changeTab} className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
        <TabsList className="mb-5 max-w-full overflow-x-auto">
          <TabsTrigger value="hints">
            <CrumbMark className="size-4" /> Hint Ladder
          </TabsTrigger>
          <TabsTrigger value="guard">
            <ShieldCheck /> Chat Guard
            {openFlags > 0 && <Badge variant="ember">{openFlags}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="pulse">
            <MessagesSquare /> Chat Pulse
          </TabsTrigger>
        </TabsList>

        <TabsContent value="hints">
          <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            <SessionSidebar dash={dash} />
            <SessionWorkspace dash={dash} />
          </div>
        </TabsContent>
        <TabsContent value="guard">
          <ChatGuardPanel dash={dash} />
        </TabsContent>
        <TabsContent value="pulse">
          <ChatPulsePanel dash={dash} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const socketLabel: Record<SocketState, string> = {
  connecting: "App realtime: connecting",
  connected: "App realtime: connected",
  reconnecting: "App realtime: reconnecting",
  offline: "App realtime: offline",
};

function StatusPills({ dash }: { dash: Dashboard }) {
  const { me, status, socketState } = dash;
  return (
    <>
      {me &&
        (me.isDemo ? (
          <Pill tone="crust" title="Demo account. Sample data only, nothing touches Twitch.">
            Demo account
          </Pill>
        ) : (
          <Pill
            tone={dash.chatStatus?.connected && dash.chatStatus.subscribed ? "sage" : "ember"}
            title={dash.chatStatus?.lastError ?? (dash.chatStatus?.connected && dash.chatStatus.subscribed ? "Receiving live chat through Twitch EventSub" : "Twitch EventSub is not connected and subscribed")}
          >
            Twitch: {me.login} · {dash.chatStatus?.connected && dash.chatStatus.subscribed ? "EventSub connected" : "EventSub offline"}
          </Pill>
        ))}
      {me?.isDemo && <Pill tone="muted" title="Demo mode does not connect to Twitch or receive live chat.">Twitch EventSub: not connected (demo)</Pill>}
      {status && (
        <>
          {status.ai.issue ? (
            <Pill tone="ember" title={status.ai.issue}>
              AI: setup issue (using demo heuristic)
            </Pill>
          ) : (
            <Pill tone={status.ai.provider === "openai" ? "sage" : "muted"} title={status.ai.provider === "openai" ? "Using the OpenAI Responses API" : "Using a local deterministic heuristic; no AI-provider requests are made"}>
              {status.ai.provider === "openai" ? `AI: OpenAI ${status.ai.model}` : "AI: demo heuristic"}
            </Pill>
          )}
          <Pill tone="muted" title={status.persistence === "memory" ? "Data is lost when the server restarts" : "Stored in Supabase Postgres"}>
            {status.persistence === "supabase" ? "Supabase" : "In-memory store"}
          </Pill>
        </>
      )}
      <Pill tone={socketState === "connected" ? "sage" : socketState === "offline" ? "ember" : "crust"} dot>
        {socketLabel[socketState]}
      </Pill>
    </>
  );
}

function Pill({ tone, dot, title, children }: { tone: "sage" | "crust" | "ember" | "muted"; dot?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        tone === "sage" && "border-sage/25 text-sage",
        tone === "crust" && "border-crust/30 text-crust",
        tone === "ember" && "border-ember/30 text-ember",
        tone === "muted" && "border-border-strong text-muted",
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full bg-current", tone !== "sage" && "animate-pulse-dot")} />}
      {children}
    </span>
  );
}
