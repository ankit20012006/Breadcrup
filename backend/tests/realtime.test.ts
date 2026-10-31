import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@breadcrumb/shared";
import { createApp } from "../src/app";
import { isAllowedOrigin } from "../src/config";
import { createServices } from "../src/container";
import { attachSocketServer } from "../src/realtime/realtime";
import { makeStreamer, viewerAuth } from "./helpers";

const servers: Server[] = [];
const sockets: Socket[] = [];

afterEach(() => {
  sockets.splice(0).forEach((s) => s.close());
  servers.splice(0).forEach((s) => s.close());
});

async function start() {
  const services = createServices();
  const server = createServer(createApp(services));
  const rt = attachSocketServer(server, { isAllowedOrigin, getOverlayState: (id) => services.hints.publicOverlay(id) });
  services.realtime.setTarget(rt);
  await new Promise<void>((r) => server.listen(0, r));
  servers.push(server);
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  const client = (auth?: Record<string, string>) => {
    const s = connect(url, { auth, transports: ["websocket"], forceNew: true });
    sockets.push(s);
    return s;
  };
  return { services, client };
}

const once = <T>(s: Socket, ev: string, ms = 2000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
    s.once(ev, (p: T) => {
      clearTimeout(t);
      resolve(p);
    });
  });

describe("Socket.IO scoping", () => {
  it("delivers private events only to the owning streamer and public overlay state to overlay rooms", async () => {
    const { services, client } = await start();
    const streamer = await makeStreamer(services, { demo: true });
    const session = await services.hints.createSession(streamer.connection.id, { game: "G", question: "How?", context: "", showCredits: true });

    const owner = client({ token: streamer.token });
    await once(owner, "auth:ok");
    const stranger = client();
    const intruder = client({ token: "forged" });
    await once(intruder, "auth:error");

    const strangerPrivate: unknown[] = [];
    stranger.on(SOCKET_EVENTS.submissionCreated, (p) => strangerPrivate.push(p));
    intruder.on(SOCKET_EVENTS.submissionCreated, (p) => strangerPrivate.push(p));

    const overlay = client();
    await new Promise<void>((r) => overlay.on("connect", () => r()));
    const initial = once<any>(overlay, SOCKET_EVENTS.overlayUpdate);
    const ack = await new Promise<any>((r) => overlay.emit(SOCKET_EVENTS.joinOverlay, { sessionId: session.id }, r));
    expect(ack.ok).toBe(true);
    expect((await initial).revealed).toBeNull();

    const created = once<any>(owner, SOCKET_EVENTS.submissionCreated);
    const viewer = await viewerAuth(streamer.connection.id);
    const viewerIdentity = { viewerId: viewer.Authorization, channelConnectionId: streamer.connection.id, origin: "anonymous" as const };
    await services.hints.addSubmission(session.id, viewerIdentity, { text: "private clue text", creditOptIn: false });
    expect((await created).text).toBe("private clue text");

    await new Promise((r) => setTimeout(r, 100));
    expect(strangerPrivate).toEqual([]);
  });

  it("rejects joins for unknown or malformed session ids", async () => {
    const { client } = await start();
    const s = client();
    await new Promise<void>((r) => s.on("connect", () => r()));
    expect(await new Promise<any>((r) => s.emit(SOCKET_EVENTS.joinOverlay, { sessionId: "nope" }, r))).toMatchObject({ ok: false });
    expect(await new Promise<any>((r) => s.emit(SOCKET_EVENTS.joinOverlay, { sessionId: crypto.randomUUID() }, r))).toMatchObject({ ok: false });
  });
});
