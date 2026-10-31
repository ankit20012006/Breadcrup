import Link from "next/link";
import { ArrowRight, Eye, Lock, MessagesSquare, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CrumbMark, Wordmark } from "@/components/logo";

const ladder = [
  { tier: 1, label: "Subtle hint", text: "Pay attention to unusual details in this room.", state: "public" as const },
  { tier: 2, label: "Directional hint", text: "Look more closely at the statues and surrounding walls.", state: "private" as const },
  { tier: 3, label: "Specific clue", text: "Inspect the wall behind the gargoyle.", state: "private" as const },
];

export default function Landing() {
  return (
    <div className="crumb-texture min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Wordmark />
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/extension">Viewer panel</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/dashboard">
              Open app <ArrowRight />
            </Link>
          </Button>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="grid items-center gap-12 py-12 md:py-20 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <Badge variant="crust" className="mb-5">
              <Sparkles /> AI companion for Twitch streamers
            </Badge>
            <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-balance sm:text-6xl">
              Get help without losing the joy of discovery.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted text-pretty">
              Stuck on a puzzle? Your viewers send clues privately. Breadcrumb turns them into a three-step hint ladder, from a gentle nudge to a
              specific pointer, and only the step you approve ever reaches your stream.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Open the dashboard <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/dashboard?demo=1">Try the demo, no Twitch needed</Link>
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(ellipse_at_top_right,rgb(164_139_255/0.16),transparent_60%)]" />
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-widest text-subtle">Hint ladder</span>
                <span className="text-[11px] text-subtle">Illustrative example</span>
              </div>
              <ol className="space-y-3">
                {ladder.map((rung) => (
                  <li
                    key={rung.tier}
                    className={
                      rung.state === "public"
                        ? "rounded-xl border border-signal/50 bg-signal-soft p-4"
                        : "rounded-xl border border-dashed border-crust/40 bg-surface-2 p-4"
                    }
                  >
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 font-medium">
                        <CrumbMark className="size-4" lit={rung.tier as 1 | 2 | 3} /> Tier {rung.tier} · {rung.label}
                      </span>
                      {rung.state === "public" ? (
                        <Badge variant="signal">
                          <Eye /> On stream
                        </Badge>
                      ) : (
                        <Badge variant="crust">
                          <Lock /> Only you
                        </Badge>
                      )}
                    </div>
                    <p className={rung.state === "public" ? "text-sm" : "select-none text-sm text-muted blur-[3px]"}>{rung.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="grid gap-4 pb-16 md:grid-cols-3">
          <Feature
            icon={<CrumbMark className="size-5" />}
            title="Hint Ladder"
            tag="Primary"
            body="Viewers submit clues privately. AI drafts three tiers grounded only in what they sent, and each tier lists the clues behind it. You approve, edit, skip or regenerate every tier before it reveals. Hidden tiers stay on the server."
            note="AI can still be wrong or too revealing. That's why every tier needs your approval first."
          />
          <Feature
            icon={<ShieldCheck className="size-5 text-sage" />}
            title="Chat Guard"
            body="Flags copy-paste waves, floods, near-duplicates and repeated promo links, and says why each one was flagged. You can dismiss a flag, confirm it, or delete the message through Twitch's moderation API."
            note="Never bans anyone automatically. Works alongside Twitch AutoMod, not instead of it."
          />
          <Feature
            icon={<MessagesSquare className="size-5 text-signal" />}
            title="Chat Pulse"
            body="Private summaries of recent chat: main topics, questions people keep asking, useful suggestions and reactions. Every item links back to the messages behind it, and spam is left out."
            note="Built only from messages Breadcrumb actually received. Counts are computed, not guessed."
          />
        </section>

        <section className="mb-20 rounded-2xl border border-border bg-surface p-6 sm:p-8">
          <h2 className="font-display text-2xl font-semibold tracking-tight">How a hint session works</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Ask", "Open a session with the game, what you're stuck on, and any context."],
              ["Collect", "Viewers send clues from the panel. Nothing is posted in chat."],
              ["Review", "Generate the ladder, check which clues back each tier, then approve."],
              ["Reveal", "Reveal one tier at a time. Your OBS overlay updates instantly."],
            ].map(([title, body], i) => (
              <li key={title}>
                <span className="font-mono text-xs text-crust">0{i + 1}</span>
                <h3 className="mt-1 font-display font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-subtle">
        Breadcrumb is an independent project and is not affiliated with or endorsed by Twitch.
      </footer>
    </div>
  );
}

function Feature({ icon, title, body, note, tag }: { icon: React.ReactNode; title: string; body: string; note: string; tag?: string }) {
  return (
    <article className="flex flex-col rounded-2xl border border-border bg-surface p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-lg bg-surface-3">{icon}</span>
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        {tag && <Badge variant="crust">{tag}</Badge>}
      </div>
      <p className="text-sm leading-relaxed text-muted">{body}</p>
      <p className="mt-auto border-t border-border pt-4 text-xs leading-relaxed text-subtle">{note}</p>
    </article>
  );
}
