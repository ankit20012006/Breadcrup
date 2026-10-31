import type { PublicOverlayState } from "@breadcrumb/shared";
import { CrumbMark } from "@/components/logo";
import { cn } from "@/lib/utils";

/**
 * Renders a PublicOverlayState. Only receives public data by construction: it is
 * the same shape the unauthenticated /overlay endpoint returns.
 */
export function OverlayCard({ state, hideEmpty = false, className }: { state: PublicOverlayState | null; hideEmpty?: boolean; className?: string }) {
  if (!state || !state.revealed) {
    if (hideEmpty) return null;
    return (
      <div className={cn("inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-[#0e0c10]/80 px-4 py-2 text-sm text-[#cfc6d4] backdrop-blur", className)}>
        <CrumbMark className="size-5" lit={0} />
        {state?.status === "closed" ? "Hint session ended" : "Breadcrumb · no hint revealed yet"}
      </div>
    );
  }

  const { revealed } = state;
  return (
    <div
      key={`${revealed.tier}-${revealed.revealedAt}`}
      className={cn(
        "w-full max-w-xl animate-rise overflow-hidden rounded-2xl border border-[#a48bff]/40 bg-[#0e0c10]/88 text-[#ede7df] shadow-[0_10px_40px_rgb(0_0_0/0.45)] backdrop-blur",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-white/8 px-5 py-3">
        <CrumbMark className="size-6" lit={revealed.tier} />
        <div className="flex-1">
          <p className="font-display text-sm font-semibold tracking-tight">
            Hint {revealed.tier} of {state.totalTiers}
            <span className="font-sans font-normal text-[#a48bff]"> · {revealed.label}</span>
          </p>
          <p className="truncate text-[11px] text-[#9a919f]">{state.game}</p>
        </div>
        <div className="flex gap-1" aria-hidden="true">
          {[1, 2, 3].map((t) => (
            <span key={t} className={cn("h-1.5 w-5 rounded-full", t <= revealed.tier ? "bg-[#f2a541]" : "bg-white/12")} />
          ))}
        </div>
      </div>
      <p className="px-5 py-4 font-display text-xl leading-snug font-medium text-balance">{revealed.text}</p>
      {revealed.credits.length > 0 && (
        <p className="border-t border-white/8 px-5 py-2.5 text-xs text-[#9a919f]">
          Clues from <span className="text-[#ffcb74]">{revealed.credits.map((c) => c.displayName).join(", ")}</span>
        </p>
      )}
    </div>
  );
}
