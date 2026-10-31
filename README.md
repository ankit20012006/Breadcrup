# Breadcrumb

**Get help without losing the joy of discovery.**

Breadcrumb is an AI-powered companion for Twitch streamers. It has three integrated features:

| Feature | What it does |
| --- | --- |
| **Hint Ladder** (primary) | Viewers send clues privately. AI turns them into three progressively specific hints (subtle → directional → specific), each citing the clues it came from. The streamer approves, edits, rejects, skips or regenerates every tier. Only the approved, explicitly revealed tier ever reaches the OBS overlay. |
| **Chat Guard** | Deterministic detection of repeated messages, near-duplicates, copy-paste waves, floods and repeated promo links. Flags include reasons, confidence, review controls and optional message deletion via the Twitch moderation API. It never bans anyone automatically, and it runs alongside Twitch AutoMod rather than replacing it. |
| **Chat Pulse** | Private, batched summaries of recent chat: topics, repeated questions, gameplay suggestions and reactions. Spam and duplicates are excluded, and every item is backed by real message IDs. Counts are computed server-side. |

---

## Quick start (demo mode, no credentials)

Requirements: **Node.js 20.9+** (22 recommended) and npm 10+.

```bash
cd breadcrumb
npm install
npm run dev
```

- App: <http://localhost:3000>. Click **Try the demo**.
- API: <http://localhost:4000/health>

With no `.env`, Breadcrumb runs in **demo mode**:
- in-memory storage (reset on restart)
- the deterministic **demo heuristic** instead of OpenAI (labelled as "not AI" everywhere)
- a seeded session for a **fictional** game, plus a chat simulator that runs while the demo dashboard is open

Everything demo-generated is tagged `demo` in the data and the UI. Demo "deletions" are labelled as simulated and never call Twitch.
`AI_PROVIDER=demo` is the default and never makes AI-provider network requests, even if OpenAI credentials are present. Select `auto` or `openai` explicitly to opt into the paid OpenAI integration.

For an explicitly credential-free, in-memory demo in PowerShell (also overrides credentials inherited from the shell):

```powershell
Set-Location C:\Users\ADMIN\breadcrumb
$env:NODE_ENV = "development"
$env:AI_PROVIDER = "demo"
$env:OPENAI_API_KEY = ""
$env:OPENAI_MODEL = ""
$env:SUPABASE_URL = ""
$env:SUPABASE_SERVICE_ROLE_KEY = ""
$env:DEMO_MODE = "true"
npm run dev
```

**Try this demo walkthrough:**
1. **Hint Ladder tab:** click **Generate hints**. Clue #3 (disagrees) and clue #4 (a prompt-injection attempt) get flagged for review.
2. **Approve** tier 1, then **Reveal next hint**. Click **Overlay URL** and open it in another tab. It updates live.
3. Click **Viewer link** and open it in a private window to submit a clue as a viewer. It appears on the dashboard instantly.
4. **Chat Guard tab:** click **Simulate spam → All of them**, then review, dismiss or delete the flags.
5. **Chat Pulse tab:** click **Summarise last 10 min**.

## Scripts (repo root)

| Command | Description |
| --- | --- |
| `npm run dev` | Backend (tsx watch, :4000) and frontend (Next dev, :3000) |
| `npm run build` | Backend bundle (`backend/dist`) and Next production build |
| `npm start` | Run both production builds |
| `npm run typecheck` | `tsc --noEmit` for shared, backend and frontend |
| `npm test` | Backend test suite: 95 tests (Vitest + Supertest + Socket.IO client + local OpenAI/Twitch stand-ins) |
| `npm run smoke:openai` | **Live** OpenAI Hint Ladder smoke test using `backend/.env` (one real API call; `-- --with-pulse` adds one more). Prints NOT RUN without credentials. |
| `npm run check` | typecheck, then test, then build |
| `npm run smoke` | API smoke test of the whole demo flow against a running demo server (`API_URL` overrides the URL) |
| `npm run e2e` | Browser end-to-end demo journeys |
| `npm run e2e:browser` | Clicks through every demo journey in headless Edge via DevTools against a running demo server (66 checks; `BROWSER_PATH` / `WEB_URL` / `API_URL` overrides; screenshots go to `e2e-output/`) |

There is no linter configured. Next.js 16 removed `next lint`, and strict TypeScript across all three packages is the static check.

### Development from this PC's LAN IP (Windows)

Run `npm run dev` from the repository root, then open either <http://localhost:3000> or <http://172.16.12.85:3000> on this PC. In development, the API and Socket.IO clients use the browser's hostname on port 4000; the backend binds to `0.0.0.0`. Only `http://localhost:3000` and `http://172.16.12.85:3000` are added as development browser origins.

### Demo day (Windows PowerShell)

```powershell
cd C:\Users\ADMIN\breadcrumb
npm install          # first time only
npm run build        # production builds (backend/dist + frontend/.next)
npm start            # API on :4000, web on :3000

# leave the first window running; in a second PowerShell window:
npm run smoke        # should end with "SMOKE TEST PASSED"
npm run e2e          # optional: should end with "ALL JOURNEYS PASSED"
```

Then open <http://localhost:3000> and click **Try the demo**. For OBS, add a Browser Source with the dashboard's **Overlay URL**.

Tips:
- The in-memory store resets whenever the API restarts. Without `APP_JWT_SECRET`, every restart also signs everyone out, and the dashboard and viewer panel then reconnect on their own. To keep logins across restarts, set `APP_JWT_SECRET` in `backend/.env` (any long random string).
- Use `npm start` (production build) for the demo rather than `npm run dev`. It's faster and has no Next.js dev badge on the overlay.

---

## Architecture

```
breadcrumb/
├─ shared/src/            Domain types, zod request schemas, limits, socket event names
├─ backend/src/
│  ├─ index.ts            HTTP + Socket.IO server, schedulers, EventSub start-up
│  ├─ app.ts              Express app (helmet, CORS, rate limits, routes)
│  ├─ container.ts        Service wiring (repo, AI provider, services)
│  ├─ routes/             auth, sessions, viewer, chat + moderation, demo
│  ├─ services/           hintService, chatGuard, chatService, chatPulse, moderationService, tokens/crypto
│  ├─ ai/                 OpenAI Responses provider, demo heuristic, JSON schemas, prompts, output validation
│  ├─ integrations/twitch OAuth, Helix, EventSub WebSocket client, token refresh, extension JWT
│  ├─ realtime/           Socket.IO rooms (private streamer room / public overlay room)
│  ├─ store/              Repository interface; Supabase and in-memory implementations
│  └─ demo/               Fictional sample data and simulator
├─ scripts/              smoke.mjs (API demo flow), e2e-browser.mjs (headless Edge journeys)
├─ backend/tests/         95 tests: API flows, security, guard, validation, sockets, OpenAI + Twitch protocol stand-ins
├─ frontend/
│  ├─ app/                / · /dashboard · /extension · /overlay/[sessionId] · /auth/complete
│  ├─ components/         dashboard panels, overlay card, shadcn/ui primitives
│  └─ lib/                API client, socket, Twitch extension helper
└─ supabase/
   ├─ migrations/         Schema, constraints, indexes, RLS, insert_hint_set()
   └─ seed.sql            Optional demo rows
```

**Request flow for a hint:** viewer `POST /api/sessions/:id/submissions` → stored privately and pushed to the streamer's private socket room. The streamer then calls `POST /generate`: clues are relabelled `C1..Cn`, sent to the AI as untrusted data, and the output is validated before being stored as a new hint-set version. Next comes approve, then `POST /reveal-next`. The server builds a `PublicOverlayState` holding only the revealed tier and pushes it to the public overlay room.

### Stack decisions

- **Next.js 16, React 19, Tailwind v4, shadcn/ui.** Components follow shadcn's structure (`components.json` is included), and the shadcn CLI can add more.
- **Express 5 + Socket.IO 4** on a persistent Node host. Socket.IO and the EventSub WebSocket need long-lived connections.
- **Supabase Postgres** via the service-role key from the backend only.
- **OpenAI Responses API** with `text.format: { type: "json_schema", strict: true }`.
- **Twitch EventSub over WebSocket** (not webhooks), so no public HTTPS callback is needed for chat.
- **No Redis, queues or microservices.** Rate limits, locks and the guard window are in-process, which assumes a **single backend instance** (see limitations).
- **TypeScript 5.9** is pinned rather than 7.x, for Next.js tooling compatibility.

---

## Demo mode vs live mode

| | Demo (`DEMO_MODE=true`) | Live (`DEMO_MODE=false`) |
| --- | --- | --- |
| Sign-in | "Explore demo mode" plus Twitch (if configured) | Twitch OAuth only |
| Chat | Simulated, tagged `demo` | Twitch EventSub `channel.chat.message`, tagged `live` |
| Deletion | Simulated and labelled; no API call | `DELETE /helix/moderation/chat`; the real HTTP status is recorded |
| Viewers | Anonymous viewer tokens allowed | Twitch Extension JWT (anonymous links only if `ALLOW_ANONYMOUS_VIEWERS=true`) |
| Demo controls | Simulate clue / spam | Refused (403) for real Twitch accounts |

AI and storage are configured independently of the mode. Set the OpenAI or Supabase variables in either mode. The dashboard header always shows which AI provider and store are active.

---

## Configuration

All variables are documented in [`.env.example`](.env.example). Copy the backend section to `backend/.env` and the frontend section to `frontend/.env.local`.

### Supabase

1. Create a project at <https://supabase.com>.
2. Apply the schema: either paste `supabase/migrations/20261025000000_init.sql` into the SQL editor, or with the Supabase CLI run `supabase link` then `supabase db push`.
3. Optional: run `supabase/seed.sql`.
4. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API) in `backend/.env`.

**Security model:** RLS is enabled on every table with **no policies**, and privileges are revoked from `anon` and `authenticated`. The public anon key can't read anything, including unrevealed hints or encrypted tokens. Only the backend, using the service-role key, can access data, and it enforces ownership on every route. Twitch tokens are stored AES-256-GCM encrypted (`TOKEN_ENCRYPTION_KEY`).

Retention: `select purge_old_chat_messages(7);` deletes buffered chat older than 7 days. You can schedule it with Supabase `pg_cron`.

### OpenAI

**Local setup.** The key lives only in `backend/.env`, which is git-ignored. Never put it in `frontend/` or any `NEXT_PUBLIC_*` variable.

```powershell
cd C:\Users\ADMIN\breadcrumb
Copy-Item backend\.env.example backend\.env   # skip if backend\.env already exists
notepad backend\.env                           # set OPENAI_API_KEY=... and OPENAI_MODEL=...
npm run smoke:openai                           # one real Hint Ladder call; add "-- --with-pulse" for a Chat Pulse call too
npm run dev                                    # restart the backend so it picks up the new values
```

`OPENAI_MODEL` must be a model ID available to your account that supports the Responses API with Structured Outputs (`json_schema`). Breadcrumb has no default model and never substitutes one.

`npm run smoke:openai` runs the real service code against `api.openai.com`, using an in-memory store. It never prints the key. It checks that:
- only eligible clues are used as evidence; rejected and injection-like clues are held back
- the output validates against real clue IDs
- nothing is public until a tier is approved and revealed

It ends with `LIVE OPENAI SMOKE TEST PASSED`, or explains why it failed. With no credentials it prints `NOT RUN` and exits with code 2. It never reports a pass without a real response. If `OPENAI_BASE_URL` points somewhere else, it says the run is not a real OpenAI test.

**Provider selection** (`AI_PROVIDER`):

| Value | Behaviour |
| --- | --- |
| `demo` (default) | Always use the local heuristic; never makes AI-provider network requests, even if OpenAI credentials are set |
| `auto` | OpenAI when both `OPENAI_API_KEY` and `OPENAI_MODEL` are set; otherwise the demo heuristic, labelled "not AI" everywhere |
| `openai` | Require OpenAI. The backend refuses to start if either variable is missing. |

OpenAI requests are only possible after explicitly selecting `AI_PROVIDER=auto` or `AI_PROVIDER=openai`. If only one of the two OpenAI variables is set with `auto`, the dashboard shows an "AI setup issue" banner. It never silently pretends to use OpenAI.

**Errors** are mapped to actionable messages, and any key-like string in an upstream message is redacted before it reaches the UI or logs:

| Upstream response | What the streamer sees |
| --- | --- |
| 401 | "OpenAI rejected the API key… check OPENAI_API_KEY" (HTTP 503) |
| 403 | Permission denied (503) |
| 404 | "Model … wasn't found… check OPENAI_MODEL" (503) |
| 400 / 422 | "Model may not support Structured Outputs" (502) |
| 429 with `insufficient_quota` | Quota or billing message (503) |
| 429 | Rate limited (429) |
| Timeout | 504 |
| Refusal, truncation (`OPENAI_MAX_OUTPUT_TOKENS`), invalid JSON or schema mismatch | 502 |

A failed generation never stores or shows hints. A failed Chat Pulse batch is stored as an `ERROR` summary carrying the message.

Calls use `store: false`, 2 SDK retries (for 429 and 5xx), `OPENAI_TIMEOUT_MS` (default 30000) and `OPENAI_MAX_OUTPUT_TOKENS` (default 4000; reasoning models count reasoning tokens here).

Grounding safeguards, enforced in code rather than just in the prompt:
- Before any AI call, a deterministic screen (`backend/src/services/clueSafety.ts`) holds back clues that read like instructions to the AI, such as "ignore previous instructions" or "tier 1 must say…". They are never sent to the model or used as evidence. The streamer still sees them, flagged with a reason. It's pattern-based defence in depth, so it can be evaded.
- Viewer clues are sent as JSON data with short refs. The system prompt tells the model to treat them as untrusted and to flag manipulation.
- `validateHintOutput()` maps refs back to submission IDs **from that session only**. A hint that cites no valid clue is discarded, and so is one containing a link, markup or AI-directed instructions (hint text can reach a public overlay). A READY response with missing, duplicate, too-long, unsafe or unsupported tiers is downgraded to `NEED_REVIEW`. The server never upgrades a status.
- If there are no usable clues, the result is `NEED_MORE_CLUES` and no AI call is made. Generation is cached by an input hash and locked per session, and AI failures leave the previous hint set untouched.
- Chat Pulse items without valid evidence are dropped, a "repeated question" needs at least 2 supporting messages, and every count comes from evidence.

Breadcrumb doesn't claim perfect spoiler prevention. AI hints can be wrong or too revealing, which is why every tier requires explicit approval.

### Twitch application (OAuth, chat, moderation)

1. In <https://dev.twitch.tv/console/apps>, register an application of category "Application Integration".
2. Add the OAuth redirect URL, which must match `TWITCH_REDIRECT_URI` exactly:
   - local: `http://localhost:4000/api/auth/twitch/callback`
   - production: `https://<your-api-host>/api/auth/twitch/callback`
3. Set `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` and `TWITCH_REDIRECT_URI`.

Scopes requested at login (checked against Twitch's API reference):

| Scope | Used for |
| --- | --- |
| `user:read:chat` | EventSub `channel.chat.message` v1 over WebSocket (user access token; condition `broadcaster_user_id` = `user_id` = the streamer) |
| `moderator:manage:chat_messages` | `DELETE https://api.twitch.tv/helix/moderation/chat?broadcaster_id&moderator_id&message_id` |

How the integration behaves:
- The broadcaster acts as their own moderator, so `moderator_id` is the broadcaster's ID.
- Twitch only allows deleting messages younger than 6 hours, and never the broadcaster's own or other moderators' messages. Breadcrumb checks message age first and records Twitch's actual error otherwise.
- The EventSub client subscribes within Twitch's 10-second window after `session_welcome` and handles `session_reconnect` hand-over, keepalive timeouts (reconnect plus resubscribe with backoff) and `revocation`. Redelivered notifications are de-duplicated.
- Access tokens are refreshed automatically before expiry and retried once on a 401. "Disconnect" revokes the token at `id.twitch.tv/oauth2/revoke`.
- The dashboard's stored Breadcrumb session determines the displayed account. If it says **Demo account**, choose **Connect Twitch** in the header to replace that session through OAuth. **App realtime** is Breadcrumb's Socket.IO connection and does not indicate Twitch chat status; **Twitch EventSub** reports the separate live-chat subscription.
- After Twitch redirects back, Breadcrumb loads `/api/auth/me` for the authorized broadcaster profile. Verify **Twitch: <login> · EventSub connected**, then send a new chat message in that channel and confirm it appears as a `live` chat message in Chat Guard. Demo chat remains isolated and never contacts Twitch.

### Twitch Extension (viewer panel)

The `/extension` page works in two ways:
- **Standalone:** `/extension?session=<id>`, for demo use or live with `ALLOW_ANONYMOUS_VIEWERS=true`.
- **Inside Twitch's extension iframe:** it loads Twitch's extension helper, gets the JWT from `onAuthorized`, and the backend verifies it with `TWITCH_EXTENSION_SECRET` (HS256, base64-decoded). The viewer is identified by `opaque_user_id` and the channel by `channel_id`.

**Local Test setup** (Twitch Developer Console → Extensions):
1. Create an extension with the **Panel** type.
2. Asset hosting: set the Testing Base URI to your frontend origin and the Panel Viewer Path to `extension`.
3. Capabilities: add your API origin (for example `https://breadcrumb-api.onrender.com`) to **Allowlist for URL Fetching Domains**, covering both REST and the Socket.IO WebSocket.
4. Set `TWITCH_EXTENSION_CLIENT_ID` and `TWITCH_EXTENSION_SECRET` (Settings → Extension Secrets).

The backend's CORS policy already accepts `https://<id>.ext-twitch.tv` origins.

> **Release note:** Hosted Test and Released extensions must be uploaded to Twitch as **static assets**, and Twitch's review requires the helper script to be included via a `<script>` tag in the HTML. The Next.js page works for Local Test. A store release needs a static export of the panel. That work isn't done in this MVP (see limitations).

### OBS overlay

Add a **Browser Source** with:
- URL: `https://<frontend>/overlay/<sessionId>`. Use the **Overlay URL** button on the dashboard.
- Width/height: for example 1000 × 400. The page background is transparent.

Optional query parameters:
- `?empty=hide`: render nothing until a hint is revealed
- `?position=top`: anchor the card to the top
- `?align=center` or `?align=right`

The overlay only ever receives `PublicOverlayState`: game title, session status, and the single revealed tier with credits for viewers who opted in. Hidden tiers, clues, viewer IDs and moderation data never reach it.

---

## Deployment

1. **Supabase:** create the project and apply the migration (see above).
2. **Backend → Render.** Use [`render.yaml`](render.yaml) as a Blueprint, or create a Web Service manually:
   - build: `npm ci --include=dev && npm run build -w backend`
   - start: `npm run start -w backend`
   - health check: `/health`
   - Set `NODE_ENV=production`, `DEMO_MODE=false` (or `true` for a public demo), `APP_JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `FRONTEND_URL` (your Vercel URL), `PUBLIC_API_URL`, plus the Supabase, OpenAI and Twitch variables. The server refuses to start in production without `APP_JWT_SECRET`, or without `TOKEN_ENCRYPTION_KEY` when Twitch is configured.
   - Use an always-on instance. Sleeping free instances drop the chat and overlay connections.
3. **Frontend → Vercel.** Import the repo and set **Root Directory = `frontend`**. Vercel detects the npm workspace and installs from the repo root, which `@breadcrumb/shared` needs. Set `NEXT_PUBLIC_API_URL=https://<your-api-host>`.
4. **Twitch:** add the production redirect URL to the Twitch app and update the extension's URLs and allowlist.

---

## API reference

All private routes need `Authorization: Bearer <streamer token>`. Viewer routes need either a Twitch Extension JWT or an anonymous viewer token.

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /health`, `GET /api/auth/status` | public | Mode, store, AI provider, Twitch configuration |
| `POST /api/auth/demo` | public (demo mode only) | Demo streamer token |
| `GET /api/auth/twitch/login` → `/callback` | public | OAuth with signed state plus cookie check; redirects to `/auth/complete#token=…` |
| `GET /api/auth/me`, `POST /api/auth/twitch/disconnect` | streamer | Profile with chat/delete capability; revoke tokens |
| `POST /api/sessions`, `GET /api/sessions`, `GET /api/sessions/:id` | streamer (owner) | Create, list and inspect sessions (detail includes clues and the private hint set) |
| `POST /api/sessions/:id/generate` `{force?, tier?}` | streamer | Generate or regenerate (cached by input hash; revealed tiers are locked) |
| `POST /api/sessions/:id/tiers/decision` `{tier, decision}` | streamer | approved / rejected / skipped / pending |
| `PATCH /api/sessions/:id/tiers` `{tier, text}` | streamer | Edit a tier (resets it to pending) |
| `POST /api/sessions/:id/reveal-next` | streamer | Reveal the next non-skipped tier (it must be approved) |
| `POST /api/sessions/:id/close` | streamer | Close the session |
| `PATCH /api/sessions/:id/submissions/:sid` `{status}` | streamer | Exclude or restore a clue |
| `GET /api/sessions/:id/overlay` | **public** | `PublicOverlayState` only |
| `POST /api/sessions/:id/submissions` | viewer | Private clue: 3–280 chars, at most 5 per viewer per session, at most 2 per minute, no exact duplicates |
| `POST /api/viewer/token`, `GET /api/viewer/active`, `GET /api/viewer/sessions/:id` | public / viewer | Anonymous token, active session, the viewer's own clues only |
| `GET /api/chat/summaries`, `POST /api/chat/summaries/generate`, `GET /api/chat/stats` | streamer | Chat Pulse |
| `GET /api/moderation/flags?status=`, `POST /api/moderation/flags/:id/review`, `POST /api/moderation/flags/:id/action` | streamer | Chat Guard queue, review, delete |
| `POST /api/demo/chat/burst`, `/chat/message`, `/sessions/:id/clue` | demo streamer only | Simulators |

**Socket.IO.** The client connects with `auth: { token }` to join the private room `streamer:<id>`. Any client may `emit("overlay:join", { sessionId })` to get `overlay:update` for that session.
- Private events: `submission:created`, `hints:generated`, `hints:approval`, `hints:revealed`, `session:updated`, `session:closed`, `summary:updated`, `moderation:flag_created`, `moderation:flag_updated`, `moderation:action_completed`, `chat:stats`
- Public event: `overlay:update` only

Clients refetch on reconnect to catch up.

---

## Testing

`npm test` runs 90 backend tests against the in-memory store, with scripted AI and local stand-ins for OpenAI and Twitch:
- **Hint Ladder:** the full submit → generate → approve → reveal flow, plus:
  - the overlay and public socket payloads never contain unrevealed tiers or clue text
  - reveal is blocked until approval; skip works; revealed tiers are locked; edits require re-approval
  - generation caching; `NEED_MORE_CLUES` without an AI call; hallucinated refs are discarded; AI failure keeps the previous set
- **Authorization:** sessions are invisible to other streamers (404); viewer tokens can't call streamer routes; viewers see only their own clues; cross-channel and closed-session submissions are rejected; rate limits work.
- **Prompt injection:** on-topic injection clues are held back from the AI, flagged and never used as evidence. The detector is checked against benign look-alikes ("ignore the first door").
- **Closed sessions** are read-only: no decisions, edits, generation or reveals.
- **Chat Guard:** duplicates, near-duplicates, copypasta, floods and link promos are flagged. Hype repeats aren't, whether from many people or one person repeating "LUL", and neither are moderators or single normal links.
- **Credit names** shown on stream reject URLs and markup.
- **Moderation:** demo deletion makes no Twitch call; live deletion needs the scope and records Twitch's real failure and success responses with history.
- **Chat Pulse:**
  - spam and copypasta are excluded (including unflagged first copies); duplicates are collapsed but counted; the EMPTY state works
  - scheduled batches skip small windows and use contiguous windows
  - every evidence ID is a real, non-spam message, and every count equals the evidence count
- **OpenAI provider:**
  - request shape (strict json_schema, clues only in the data payload), refusal, truncated output and invalid JSON
  - the **real OpenAI SDK** against a local HTTP stand-in for `/v1/responses`: wire body, SDK-side `output_text` parsing, 429 → rate-limited, 500 or unreachable → upstream error
- **Twitch:**
  - the EventSub client against a local WebSocket server speaking the documented protocol: subscribe after `session_welcome`, notification mapping, moderator badges, redelivery de-duplication, `session_reconnect` hand-over without resubscribing, token refresh on 401, and skipping accounts without `user:read:chat`
  - Helix Delete Chat Messages and Create EventSub Subscription requests checked against the documented URLs and bodies
  - a missing Twitch config returns a clear 503 setup error, and forged OAuth callbacks are rejected
- **Socket.IO:** private events reach only the owner, forged tokens are rejected, and invalid overlay joins are refused.
- **Stale viewer tokens** (for example after an in-memory restart) get a 401, so the panel re-authenticates instead of getting stuck.

`npm run e2e:browser` drives a real headless Edge through every demo journey: landing page, then demo, then create session. Then:
- a viewer submits clues (identity survives a refresh; invalid names are caught inline)
- the clues arrive live, and the streamer generates, approves, reveals, edits, rejects and regenerates tiers
- the overlay updates live, shows only the permitted tier, has a transparent background, and contains no clue text
- the Chat Guard simulation is reviewed: two-step deletion with a durable "simulated" label, and dismissal
- a Chat Pulse summary is generated with spam excluded, followed by a refresh, an unknown overlay error, and a session close reflected in the viewer panel
- the run also checks that no browser errors occur

In addition, the migration and seed were applied to a scratch PostgreSQL 18 instance. There, `insert_hint_set()`, the one-active-set index, the check constraints and the `anon` permission denial were verified, and the Supabase repository's column names were cross-checked against the migration.

---

## Limitations and honest caveats

- **Not exercised against live services yet.** The OpenAI, Twitch (OAuth, EventSub, Helix) and Supabase (PostgREST) code paths were built from the official docs and tested against local stand-ins: the real OpenAI SDK against a local HTTP server, and EventSub against a local WebSocket server. None of them have been run with real credentials. In particular:
  - OpenAI model behaviour and real grounding quality
  - Twitch's OAuth consent, scopes and EventSub delivery
  - Supabase's PostgREST and RPC behaviour

  The safest next step is to add one integration at a time (OpenAI first, then Supabase, then Twitch). After each one, run `npm run smoke` and try the flow in the UI. The header shows which provider and store are active.
- **Twitch moderation authority:** deleting messages uses the broadcaster's own token (`moderator_id` = broadcaster). Moderators logging in as themselves aren't supported.
- **Anonymous viewer tokens** are scoped to a channel, not a single session. Per-viewer limits still apply to each session.
- **Single backend instance.** Rate limits, generation locks, the Chat Guard window and Twitch-message de-duplication live in process memory. Running several instances would need shared state.
- **Twitch Extension release** requires a static asset bundle (see above). Local Test works with the hosted Next page.
- **"Authorised staff"** access to the private dashboard is currently the broadcaster's account only; there's no moderator/editor sharing yet.
- **Chat Guard is heuristic** and English-centric (for example the promo keyword list). Thresholds are configurable and AI classification isn't used. Breadcrumb flags messages; people decide.
- **AI output can be wrong or too revealing** even when grounded. Spoiler prevention isn't perfect, which is why approval is mandatory.
- **In-memory store** (when Supabase isn't configured) loses everything on restart, by design.

## Troubleshooting

- **Dashboard says "Backend unreachable":** start the API (`npm run dev`) or set `NEXT_PUBLIC_API_URL`.
- **Twitch login fails with `redirect_mismatch`:** `TWITCH_REDIRECT_URI` must exactly match a URL registered on the Twitch app.
- **Twitch EventSub is offline:** app realtime is a separate connection. Check the server log for `[eventsub]` lines; reconnect Twitch if `user:read:chat` is missing or the subscription was revoked.
- **The OBS overlay shows a dark box:** make sure you're using the `/overlay/<id>` URL and not the dashboard.
- **Fonts:** fonts load at runtime from Google Fonts, with system fallbacks if that's blocked. Builds don't depend on the font CDN.
- **`npm install` crashes with "Cannot read properties of null (reading 'edgesOut')":** this is an npm 10.9 bug with some optional peer chains. Update npm (`npm i -g npm@latest`) or retry with `--legacy-peer-deps`.

Breadcrumb is an independent project and is not affiliated with or endorsed by Twitch.
