"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { SOCKET_EVENTS, type PublicOverlayState } from "@breadcrumb/shared";
import { OverlayCard } from "@/components/overlay-card";
import { api } from "@/lib/api";
import { connectSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";

/**
 * OBS Browser Source. Query options:
 *   ?empty=hide      render nothing until a hint is revealed
 *   ?position=top    anchor to the top instead of the bottom
 *   ?align=center|right
 */
export default function OverlayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [state, setState] = React.useState<PublicOverlayState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [opts, setOpts] = React.useState({ hideEmpty: false, top: false, align: "left" });

  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setOpts({ hideEmpty: p.get("empty") === "hide", top: p.get("position") === "top", align: p.get("align") ?? "left" });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    api<PublicOverlayState>(`/api/sessions/${sessionId}/overlay`)
      .then((s) => !cancelled && setState(s))
      .catch((e) => !cancelled && setError(e.message));

    const socket = connectSocket();
    const join = () =>
      socket.emit(SOCKET_EVENTS.joinOverlay, { sessionId }, (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) setError(res?.error ?? "Couldn't join overlay");
        else setError(null);
      });
    socket.on("connect", join); // also re-joins after reconnects
    socket.on(SOCKET_EVENTS.overlayUpdate, (s: PublicOverlayState) => {
      if (s.sessionId === sessionId) setState(s);
    });
    return () => {
      cancelled = true;
      socket.close();
    };
  }, [sessionId]);

  return (
    <main
      className={cn(
        "flex min-h-dvh p-8",
        opts.top ? "items-start" : "items-end",
        opts.align === "center" ? "justify-center" : opts.align === "right" ? "justify-end" : "justify-start",
      )}
    >
      {error && !state ? (
        opts.hideEmpty ? null : <p className="rounded-full bg-black/70 px-4 py-2 text-sm text-[#ef6461]">Breadcrumb overlay: {error}</p>
      ) : (
        <OverlayCard state={state} hideEmpty={opts.hideEmpty} />
      )}
    </main>
  );
}
