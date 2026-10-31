"use client";

import * as React from "react";
import Link from "next/link";
import { FlaskConical, Loader2, ServerCrash } from "lucide-react";
import { TwitchGlyph, Wordmark } from "@/components/logo";
import { useToast } from "@/components/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { API_URL, errorMessage, getApiUrl } from "@/lib/api";
import type { Dashboard } from "./useDashboard";

export function ConnectScreen({ dash }: { dash: Dashboard }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [apiUrl, setApiUrl] = React.useState(API_URL);
  const startingRef = React.useRef(false);
  const { status, statusError } = dash;

  React.useEffect(() => {
    setApiUrl(getApiUrl());
  }, []);

  const startDemo = React.useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setBusy(true);
    try {
      await dash.loginDemo();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      startingRef.current = false;
      setBusy(false);
    }
  }, [dash, toast]);

  // /dashboard?demo=1 (from the landing page) jumps straight into the demo.
  const autoStarted = React.useRef(false);
  React.useEffect(() => {
    if (autoStarted.current || status?.mode !== "demo") return;
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      autoStarted.current = true;
      void startDemo();
    }
  }, [status, startDemo]);

  return (
    <main className="crumb-texture grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 inline-block">
          <Wordmark />
        </Link>
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Streamer dashboard</h1>
          <p className="mt-1.5 text-sm text-muted">Connect your Twitch channel, or try everything with sample data first.</p>

          {statusError ? (
            <div role="alert" className="mt-6 rounded-lg border border-ember/30 bg-ember-soft p-4 text-sm">
              <p className="flex items-center gap-2 font-medium text-ember">
                <ServerCrash className="size-4" /> Backend unreachable
              </p>
              <p className="mt-1 text-muted">
                Couldn&apos;t reach <code className="font-mono text-xs">{apiUrl}</code>. Start it with <code className="font-mono text-xs">npm run dev</code>, or
                set <code className="font-mono text-xs">NEXT_PUBLIC_API_URL</code>.
              </p>
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-subtle">
                <Loader2 className="size-3 animate-spin" /> Retrying every 5 seconds…
              </p>
            </div>
          ) : !status ? (
            <p className="mt-6 inline-flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" /> Checking server…
            </p>
          ) : (
            <div className="mt-6 space-y-3">
              {status.twitch.oauthConfigured ? (
                <Button asChild size="lg" variant="signal" className="w-full">
                  <a href={`${API_URL}/api/auth/twitch/login`}>
                    <TwitchGlyph /> Connect with Twitch
                  </a>
                </Button>
              ) : (
                <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
                  Twitch login isn&apos;t configured on this server yet. Set <code className="font-mono">TWITCH_CLIENT_ID</code>,{" "}
                  <code className="font-mono">TWITCH_CLIENT_SECRET</code> and <code className="font-mono">TWITCH_REDIRECT_URI</code> (see README).
                </div>
              )}
              {status.mode === "demo" && (
                <Button size="lg" variant="outline" className="w-full" onClick={startDemo} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <FlaskConical />} Explore demo mode
                </Button>
              )}

              {status.ai.issue && (
                <p role="alert" className="rounded-lg border border-ember/30 bg-ember-soft p-3 text-xs text-ember">
                  {status.ai.issue}
                </p>
              )}
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4 text-xs">
                <div>
                  <dt className="text-subtle">Mode</dt>
                  <dd className="mt-1">{status.mode === "demo" ? <Badge variant="crust">Demo</Badge> : <Badge variant="signal">Live</Badge>}</dd>
                </div>
                <div>
                  <dt className="text-subtle">AI</dt>
                  <dd className="mt-1">
                    {status.ai.issue ? <Badge variant="ember">Setup issue</Badge> : status.ai.provider === "openai" ? <Badge variant="sage">OpenAI</Badge> : <Badge>Demo heuristic</Badge>}
                  </dd>
                </div>
                <div>
                  <dt className="text-subtle">Storage</dt>
                  <dd className="mt-1">
                    <Badge>{status.persistence === "supabase" ? "Supabase" : "In-memory"}</Badge>
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
