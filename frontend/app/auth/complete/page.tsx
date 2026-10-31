"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { streamerToken } from "@/lib/api";

/** Twitch OAuth lands here. The token arrives in the URL fragment so it never hits server logs. */
export default function AuthComplete() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");
    history.replaceState(null, "", window.location.pathname);
    if (token) {
      streamerToken.set(token);
      router.replace("/dashboard");
    } else {
      setError(params.get("error") ?? "Login did not complete.");
    }
  }, [router]);

  return (
    <main className="crumb-texture grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center">
        <Wordmark className="justify-center" />
        {error ? (
          <>
            <p role="alert" className="mt-5 text-sm text-ember">
              {error}
            </p>
            <Button asChild className="mt-5 w-full">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </>
        ) : (
          <p className="mt-5 inline-flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Finishing Twitch sign-in…
          </p>
        )}
      </div>
    </main>
  );
}
