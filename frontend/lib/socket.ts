import { io, type Socket } from "socket.io-client";
import { getApiUrl } from "./api";

/** One Socket.IO connection. Pass a streamer token for private events; omit it for overlay/viewer use. */
export function connectSocket(token?: string | null): Socket {
  return io(getApiUrl(), {
    auth: token ? { token } : {},
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
}
