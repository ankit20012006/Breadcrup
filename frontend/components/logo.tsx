import { cn } from "@/lib/utils";

/** Three crumbs growing toward the goal — mirrors the three hint tiers. */
export function CrumbMark({ className, lit = 3 }: { className?: string; lit?: 0 | 1 | 2 | 3 }) {
  const crumbs = [
    { cx: 5, cy: 19, r: 2.2 },
    { cx: 11.5, cy: 13, r: 3 },
    { cx: 19.5, cy: 6, r: 4 },
  ];
  return (
    <svg viewBox="0 0 26 26" className={cn("size-6", className)} aria-hidden="true">
      <path d="M5 19 Q 8 14 11.5 13 T 19.5 6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.2" strokeDasharray="1.5 2.5" />
      {crumbs.map((c, i) => (
        <circle key={i} {...c} fill={i < lit ? "var(--crust)" : "var(--border-strong)"} stroke={i < lit ? "var(--honey)" : "var(--subtle)"} strokeWidth="0.8" />
      ))}
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight", className)}>
      <CrumbMark />
      Breadcrumb
    </span>
  );
}

export function TwitchGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden="true" fill="currentColor">
      <path d="M4.3 3 3 6.4v13.1h4.5V22h2.6l2.5-2.5h3.6l4.9-4.9V3H4.3Zm15.1 10.8-2.8 2.8h-4.5l-2.4 2.4v-2.4H5.9V4.8h13.5v9Zm-2.8-5.7h-1.8v5h1.8v-5Zm-4.9 0H9.9v5h1.8v-5Z" />
    </svg>
  );
}
