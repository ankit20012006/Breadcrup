import { createServer } from "node:http";
import { AiConfigError } from "./ai";
import { createApp } from "./app";
import { config, isAllowedOrigin } from "./config";
import { createServices } from "./container";
import { attachSocketServer } from "./realtime/realtime";

async function main() {
  const services = createServices();
  const app = createApp(services);
  const server = createServer(app);

  const rt = attachSocketServer(server, {
    isAllowedOrigin,
    getOverlayState: (sessionId) => services.hints.publicOverlay(sessionId),
  });
  services.realtime.setTarget(rt);

  // Streamers with an open, authenticated dashboard socket.
  const watchedStreamers = () =>
    [...rt.io.sockets.adapter.rooms.keys()].filter((room) => room.startsWith("streamer:")).map((room) => room.slice("streamer:".length));

  if (config.demoMode) {
    const demoStreamer = await services.demo.seed();
    if (config.demoChatSimulator) {
      services.demo.startSimulator(() => (rt.io.sockets.adapter.rooms.get(`streamer:${demoStreamer.id}`)?.size ?? 0) > 0);
    }
  }
  services.pulse.start(watchedStreamers);
  if (config.twitch.oauthConfigured) {
    services.eventsub.startAll().catch((err) => console.error("[eventsub] startup failed", err));
  }

  const onListening = () => {
    console.log(`[breadcrumb] API listening on http://localhost:${config.port}`);
    console.log(
      `[breadcrumb] mode=${config.demoMode ? "demo" : "live"} store=${services.repo.kind} ai=${services.ai.name}${services.ai.model ? `(${services.ai.model})` : ""} twitch=${config.twitch.oauthConfigured ? "configured" : "not configured"}`,
    );
  };
  if (config.isProduction) server.listen(config.port, onListening);
  else server.listen(config.port, "0.0.0.0", onListening);

  const shutdown = () => {
    console.log("[breadcrumb] shutting down");
    services.pulse.stop();
    services.demo.stopSimulator();
    services.eventsub.stopAll();
    rt.io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // Configuration mistakes get a one-line message; anything else keeps its stack.
  if (err instanceof AiConfigError) console.error(`[breadcrumb] failed to start: ${err.message}`);
  else console.error("[breadcrumb] failed to start", err);
  process.exit(1);
});
