// Browser-driven end-to-end demo journeys via the Chrome DevTools Protocol (headless Edge/Chrome).
// Clicks real buttons and reads the real DOM. Requires the app running in demo mode on :3000/:4000.
// Usage: npm run e2e:browser   (BROWSER_PATH overrides the Edge location; WEB_URL overrides http://localhost:3000;
//        screenshots are written to the directory given as the first argument, default ./e2e-output)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(new URL("../backend/package.json", import.meta.url));
const WebSocket = require("ws");

const EDGE = process.env.BROWSER_PATH ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const OUT = process.argv[2] ?? "e2e-output";
const WEB = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
try {
  const [web, api] = await Promise.all([fetch(WEB), fetch(`${API}/health`)]);
  const health = api.ok ? await api.json() : null;
  if (!web.ok || !api.ok || health?.mode !== "demo") {
    console.error(`Demo app is not ready at ${WEB} (web HTTP ${web.status}) and ${API} (API HTTP ${api.status}, mode ${health?.mode ?? "unknown"}). Start npm run dev in another PowerShell window.`);
    process.exit(1);
  }
} catch {
  console.error(`Can't reach the demo app at ${WEB} and ${API}. Start npm run dev in another PowerShell window, wait for both services, then retry npm run e2e:browser.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), "bc-e2e-"));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures++;
};

async function failNextApiRequest(page, path, method = "POST") {
  await page.eval(`
    const original = window.fetch;
    let intercepted = false;
    window.__breadcrumbOriginalFetch = original;
    window.fetch = (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (!intercepted && url.pathname === ${JSON.stringify(path)} && (init.method ?? "GET") === ${JSON.stringify(method)}) {
        intercepted = true;
        return Promise.resolve(new Response(JSON.stringify({ error: "E2E injected API failure", code: "E2E_TEST" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return original(input, init);
    };
    return true;`);
}

async function restoreFetch(page) {
  await page.eval(`window.fetch = window.__breadcrumbOriginalFetch; delete window.__breadcrumbOriginalFetch; return true;`);
}

async function newPage() {
  for (let i = 0; i < 50; i++) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
      const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
      await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
      let id = 0;
      const pending = new Map();
      const consoleErrors = [];
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.id && pending.has(m.id)) (pending.get(m.id)(m), pending.delete(m.id));
        if (m.method === "Runtime.exceptionThrown") consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
        if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
      });
      const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
      await send("Runtime.enable");
      await send("Page.enable");
      const page = {
        consoleErrors,
        async goto(url) { await send("Page.navigate", { url }); await sleep(1500); },
        async eval(expr) {
          const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
          if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed");
          return r.result?.result?.value;
        },
        async waitFor(expr, ms = 15000) {
          const start = Date.now();
          while (Date.now() - start < ms) { if (await page.eval(`return !!(${expr})`).catch(() => false)) return true; await sleep(250); }
          return false;
        },
        /** Click the first enabled button/link whose visible text includes `text` (optionally inside a container). */
        async click(text, within = "document", waitMs = 5000) {
          // Real-mouse sequence (Radix Tabs activate on mousedown), waiting for an enabled match.
          const js = `const root = ${within}; const el = root && [...root.querySelectorAll("button, a, [role=tab]")].find(e => e.textContent.replace(/\\s+/g," ").includes(${JSON.stringify(text)}) && !e.disabled); if (!el) return false;
            const o = { bubbles: true, cancelable: true, button: 0 };
            el.dispatchEvent(new PointerEvent("pointerdown", o)); el.dispatchEvent(new MouseEvent("mousedown", o));
            el.dispatchEvent(new PointerEvent("pointerup", o)); el.dispatchEvent(new MouseEvent("mouseup", o)); el.click(); return true;`;
          const start = Date.now();
          do { if (await page.eval(js)) return true; await sleep(200); } while (Date.now() - start < waitMs);
          return false;
        },
        text: () => page.eval(`return document.body.innerText`),
        async shot(name) { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name), Buffer.from(r.result.data, "base64")); },
        close: () => ws.close(),
      };
      return page;
    } catch { await sleep(300); }
  }
  throw new Error("Could not connect to Edge DevTools");
}

try {
  const app = await newPage();

  // 1. Landing → demo
  await app.goto(WEB + "/");
  check(await app.waitFor(`document.body.innerText.includes("Get help without losing the joy of discovery")`), "landing page renders tagline");
  check(await app.click("Open app"), "open dashboard from landing page");
  check(await app.waitFor(`document.body.innerText.includes("Streamer dashboard") && document.body.innerText.includes("Explore demo mode")`), "dashboard connect screen loads");
  await failNextApiRequest(app, "/api/auth/demo");
  check(await app.click("Explore demo mode"), "submit demo login for API-error recovery test");
  check(await app.waitFor(`document.body.innerText.includes("E2E injected API failure")`), "demo login shows API error");
  check(
    await app.waitFor(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Explore demo mode")); return !!b && !b.disabled && !b.querySelector("svg.animate-spin"); })()`),
    "demo login spinner resets after API error",
  );
  await restoreFetch(app);
  await app.goto(WEB + "/");
  check(await app.click("Try the demo"), "click 'Try the demo'");
  check(await app.waitFor(`document.body.innerText.includes("Demo account") && document.body.innerText.includes("Incoming clues")`, 20000), "dashboard loads in demo mode with seeded session");
  check(await app.waitFor(`document.body.innerText.includes("App realtime: connected")`), "application realtime socket connected");
  check(await app.waitFor(`document.body.innerText.includes("Twitch EventSub: not connected (demo)")`), "demo account is not presented as a Twitch connection");
  check(await app.waitFor(`document.body.innerText.includes("Connect Twitch")`), "demo dashboard offers Twitch account connection");

  // Fresh session for a deterministic run.
  await app.click("New hint session");
  await app.eval(`
    const set = (id, v) => { const el = document.getElementById(id); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set("game", "E2E Quest"); set("question", "How do I cross the broken bridge?"); set("context", "Canyon level");`);
  await failNextApiRequest(app, "/api/sessions");
  check(await app.click("Open session"), "submit session creation for API-error recovery test");
  check(await app.waitFor(`document.body.innerText.includes("E2E injected API failure")`), "session creation shows API error");
  check(
    await app.waitFor(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Open session")); return !!b && !b.disabled && !b.querySelector("svg.animate-spin"); })()`),
    "session creation spinner resets after API error",
  );
  await restoreFetch(app);
  check(await app.click("Open session"), "submit Create Session form");
  check(await app.waitFor(`document.querySelector("h2")?.textContent.includes("E2E Quest")`), "new session selected");
  const sessionId = await app.eval(`return [...document.querySelectorAll("p")].map(p => p.textContent).find(t => t.includes("/overlay/"))?.split("/overlay/")[1]`);
  check(/^[0-9a-f-]{36}$/.test(sessionId ?? ""), `session id read from overlay URL (${sessionId})`);

  // 2. Viewer submits clues in a separate page (separate localStorage identity per tab via ?session).
  const viewer = await newPage();
  await viewer.goto(`${WEB}/extension?session=${sessionId}`);
  check(await viewer.waitFor(`document.body.innerText.includes("How do I cross the broken bridge?")`), "viewer panel shows session question");
  await failNextApiRequest(viewer, `/api/sessions/${sessionId}/submissions`);
  await viewer.eval(`
    const set = (id, v) => { const el = document.getElementById(id); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set("clue", "use the rope on the left side of the bridge"); set("name", "Rope_Fan");`);
  check(await viewer.click("Send privately"), "submit viewer clue for API-error recovery test");
  check(await viewer.waitFor(`document.body.innerText.includes("E2E injected API failure")`), "viewer shows API error instead of success");
  check(
    await viewer.waitFor(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Send privately")); return !!b && !b.disabled && !b.querySelector("svg.animate-spin"); })()`),
    "viewer submission spinner resets after API error",
  );
  await restoreFetch(viewer);
  const sendClue = async (text, name) => {
    await viewer.eval(`
      const set = (id, v) => { const el = document.getElementById(id); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
      set("clue", ${JSON.stringify(text)}); set("name", ${JSON.stringify(name)});`);
    await sleep(200);
    await viewer.click("Send privately");
    return viewer.waitFor(`document.body.innerText.includes("sent privately to the streamer")`);
  };
  check(await sendClue("use the rope on the left side of the bridge", "Rope_Fan"), "viewer clue 1 accepted");
  await viewer.eval(`location.reload()`); await sleep(2000);
  check(await viewer.waitFor(`document.body.innerText.includes("Your clues") && document.body.innerText.includes("use the rope")`), "viewer sees own clue after refresh (identity persisted)");
  await sleep(61000 / 60); // burst limit is 2/min per viewer; second clue fine
  check(await sendClue("the rope on the left of the bridge can be climbed", ""), "viewer clue 2 accepted");
  // Name validation in the browser
  await viewer.eval(`const el = document.getElementById("name"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "visit evil.com"); el.dispatchEvent(new Event("input", { bubbles: true }));`);
  check(await viewer.waitFor(`document.body.innerText.includes("Use letters, numbers, spaces")`), "invalid credit name shows inline error");

  // 3. Dashboard receives clues live, generate, approve, reveal.
  check(await app.waitFor(`document.body.innerText.includes("use the rope on the left side")`), "dashboard receives viewer clues in real time");
  await failNextApiRequest(app, `/api/sessions/${sessionId}/generate`);
  check(await app.click("Generate hints"), "submit hint generation for API-error recovery test");
  check(await app.waitFor(`document.body.innerText.includes("E2E injected API failure")`), "hint generation shows API error");
  check(
    await app.waitFor(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Generate hints")); return !!b && !b.disabled && !b.querySelector("svg.animate-spin"); })()`),
    "hint generation spinner resets after API error",
  );
  await restoreFetch(app);
  check(await app.click("Generate hints"), "click Generate hints");
  check(await app.waitFor(`document.body.innerText.includes("Pending review")`), "three-tier ladder generated");
  const tierTexts = await app.eval(`return [...document.querySelectorAll("section[aria-label^='Tier']")].map(s => s.querySelector("p")?.textContent)`);
  console.log("      tiers:", tierTexts);
  check(await app.waitFor(`document.body.innerText.includes("clue #1")`), "tiers cite supporting clues");
  check(!(await app.click("Reveal next hint", "document", 0)) && (await app.waitFor(`document.body.innerText.includes("Approve tier 1")`)), "reveal disabled before approval");
  check(await app.click("Approve", `document.querySelector("section[aria-label='Tier 1']")`), "approve tier 1");
  check(await app.waitFor(`document.querySelector("section[aria-label='Tier 1']").innerText.includes("Approved")`), "tier 1 shows approved");
  check(await app.click("Reveal next hint"), "reveal tier 1");
  check(await app.waitFor(`document.body.innerText.includes("Tier 1 is on stream")`), "dashboard shows tier 1 on stream");

  // 4. Overlay page shows only the permitted tier; updates live on next reveal.
  const overlay = await newPage();
  await overlay.goto(`${WEB}/overlay/${sessionId}`);
  check(await overlay.waitFor(`document.body.innerText.includes("Hint 1 of 3")`), "overlay shows Hint 1 of 3");
  const overlayText1 = await overlay.text();
  check(!overlayText1.includes(tierTexts[1]) && !overlayText1.includes(tierTexts[2]), "overlay does not contain tier 2/3 text");
  check(!overlayText1.includes("use the rope on the left side"), "overlay does not contain raw clue text");
  const bg = await overlay.eval(`return getComputedStyle(document.body).backgroundColor + " / " + getComputedStyle(document.documentElement).colorScheme`);
  check(bg.startsWith("rgba(0, 0, 0, 0)"), `overlay background transparent (${bg})`);
  // Edit tier 2, approve, reveal → overlay updates live.
  await app.click("Edit", `document.querySelector("section[aria-label='Tier 2']")`);
  await app.eval(`const el = document.querySelector("section[aria-label='Tier 2'] textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, "Look at the left side of the bridge."); el.dispatchEvent(new Event("input", { bubbles: true }));`);
  await app.click("Save", `document.querySelector("section[aria-label='Tier 2']")`);
  check(await app.waitFor(`document.querySelector("section[aria-label='Tier 2']").innerText.includes("Look at the left side of the bridge.")`), "tier 2 edited");
  await app.click("Approve", `document.querySelector("section[aria-label='Tier 2']")`);
  await app.waitFor(`document.querySelector("section[aria-label='Tier 2']").innerText.includes("Approved")`);
  await app.click("Reveal next hint");
  check(await overlay.waitFor(`document.body.innerText.includes("Hint 2 of 3") && document.body.innerText.includes("Look at the left side of the bridge.")`), "overlay updated live to edited tier 2");
  check(!(await overlay.text()).includes(tierTexts[2]), "overlay still hides tier 3");
  check(await viewer.waitFor(`document.body.innerText.includes("On stream now · Hint 2")`), "viewer panel shows the revealed tier live");
  // Reject + regenerate tier 3
  await app.click("Reject", `document.querySelector("section[aria-label='Tier 3']")`);
  check(await app.waitFor(`document.querySelector("section[aria-label='Tier 3']").innerText.includes("Rejected")`), "tier 3 rejected");
  await app.click("Regenerate", `document.querySelector("section[aria-label='Tier 3']")`);
  check(await app.waitFor(`document.querySelector("section[aria-label='Tier 3']").innerText.includes("Pending review")`), "tier 3 regenerated back to pending");
  await app.click("Approve", `document.querySelector("section[aria-label='Tier 3']")`);
  check(await app.waitFor(`document.querySelector("section[aria-label='Tier 3']").innerText.includes("Approved")`), "regenerated tier 3 approved");
  await app.click("Reveal next hint");
  check(await overlay.waitFor(`document.body.innerText.includes("Hint 3 of 3")`), "tier 3 revealed after approval");
  await overlay.shot("e2e-overlay.png");
  await app.shot("e2e-hints.png");

  // 5. Chat Guard
  await app.click("Chat Guard");
  check(await app.waitFor(`document.body.innerText.includes("Moderation queue")`), "Chat Guard tab opens");
  await failNextApiRequest(app, "/api/demo/chat/burst");
  check(await app.click("All of them"), "submit Chat Guard action for API-error recovery test");
  check(await app.waitFor(`document.body.innerText.includes("E2E injected API failure")`), "Chat Guard shows API error");
  check(
    await app.waitFor(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("All of them")); return !!b && !b.disabled && !b.querySelector("svg.animate-spin"); })()`),
    "Chat Guard spinner resets after API error",
  );
  await restoreFetch(app);
  await app.click("All of them");
  check(await app.waitFor(`document.body.innerText.includes("Copy-paste wave") && document.body.innerText.includes("Flooding") && document.body.innerText.includes("Link / promo")`), "simulated spam produces copypasta, flood and link flags");
  const dismissed = await app.eval(`const li = document.querySelector("main li, ul li"); return !!li`);
  check(dismissed, "flag rows rendered");
  await app.click("Delete message");
  check(await app.waitFor(`document.body.innerText.includes("Confirm (simulated)")`), "delete requires a second explicit confirmation, labelled simulated");
  await app.click("Confirm (simulated)");
  check(await app.waitFor(`document.body.innerText.includes("Simulated removal (moved to Spam)")`), "demo deletion toast says it was simulated");
  await app.click("Spam", `document.querySelector("[aria-label='Filter flags']")`);
  check(await app.waitFor(`document.body.innerText.includes("removed (simulated, not on Twitch)") && document.body.innerText.includes("Simulated: Demo mode: simulated removal. No Twitch API request was made.")`), "removed flag keeps a durable 'simulated' label");
  await app.click("Open", `document.querySelector("[aria-label='Filter flags']")`);
  const dismissedBefore = await app.eval(`return Number(document.querySelector("[aria-label='Filter flags']").innerText.match(/Dismissed\\s+(\\d+)/)?.[1] ?? 0)`);
  await app.click("Dismiss", `document.querySelector("ul li")`);
  check(
    await app.waitFor(`Number(document.querySelector("[aria-label='Filter flags']").innerText.match(/Dismissed\\s+(\\d+)/)?.[1] ?? 0) === ${dismissedBefore + 1}`),
    "dismiss moves a flag to Dismissed",
  );
  await app.shot("e2e-guard.png");

  // 6. Chat Pulse
  await app.click("Chat Pulse");
  await failNextApiRequest(app, "/api/chat/summaries/generate");
  check(await app.click("Summarise last 10 min"), "submit Chat Pulse for API-error recovery test");
  check(await app.waitFor(`document.body.innerText.includes("E2E injected API failure")`), "Chat Pulse shows API error");
  check(
    await app.waitFor(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Summarise last 10 min")); return !!b && !b.disabled && !b.querySelector("svg.animate-spin"); })()`),
    "Chat Pulse spinner resets after API error",
  );
  await restoreFetch(app);
  await app.click("Summarise last 10 min");
  check(await app.waitFor(`document.body.innerText.includes("Main topics") && document.body.innerText.includes("spam excluded")`), "Chat Pulse summary renders with computed stats");
  const pulseText = await app.text();
  check(!/STUCK FOREVER/i.test(pulseText.split("Recent messages")[0]), "copypasta not in summary");
  check(!/cheapviewz/i.test(pulseText.split("Recent messages")[0]), "promo spam not in summary");
  await app.shot("e2e-pulse.png");

  // 7. Refresh keeps state & tab; unknown overlay shows error; closed session in viewer.
  await app.eval(`location.reload()`);
  check(await app.waitFor(`document.body.innerText.includes("Main topics")`, 20000), "refresh keeps login and the Chat Pulse tab");
  await overlay.goto(`${WEB}/overlay/00000000-0000-4000-8000-000000000000`);
  check(await overlay.waitFor(`document.body.innerText.includes("Session not found")`), "unknown overlay id shows an error state");
  await app.click("Hint Ladder");
  await app.waitFor(`document.body.innerText.includes("Close session")`);
  await app.eval(`window.confirm = () => true`);
  await app.click("Close session");
  check(await viewer.waitFor(`document.body.innerText.includes("This session is closed")`), "viewer panel reflects closed session live");

  const errs = [...app.consoleErrors, ...viewer.consoleErrors, ...overlay.consoleErrors].filter((e) => !/favicon|404 \(Not Found\)|Failed to load resource/.test(e));
  check(errs.length === 0, `no uncaught browser errors${errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""}`);
} catch (err) {
  console.log("FAIL  e2e crashed:", err.message);
  failures++;
} finally {
  edge.kill();
  console.log(`\n${failures === 0 ? "ALL JOURNEYS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures ? 1 : 0);
}
