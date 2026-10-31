/**
 * Socket.IO event names. Private events are only emitted to the authenticated
 * streamer room; `overlay:update` is the only event sent to public overlay rooms.
 */
export const SOCKET_EVENTS = {
  // client -> server
  joinOverlay: "overlay:join",
  leaveOverlay: "overlay:leave",

  // server -> public overlay / viewer rooms
  overlayUpdate: "overlay:update",

  // server -> private streamer room
  submissionCreated: "submission:created",
  hintsGenerated: "hints:generated",
  hintApproval: "hints:approval",
  hintRevealed: "hints:revealed",
  sessionUpdated: "session:updated",
  sessionClosed: "session:closed",
  summaryUpdated: "summary:updated",
  flagCreated: "moderation:flag_created",
  flagUpdated: "moderation:flag_updated",
  moderationActionCompleted: "moderation:action_completed",
  chatStats: "chat:stats",
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
