// Realtime frames from the server, handled by domain. The socket outlives
// renders, so App hands these handlers the current render's state and
// functions (see RealtimeAppHandlers) instead of the ones from when it connected.

import type { RealtimeFrame } from "../connection";
import { handleChatEvent, type ChatEventContext } from "./chat";
import { handleHubEvent, type HubEventContext } from "./hubs";
import { handleSessionEvent, type SessionEventContext } from "./session";
import { handleSocialEvent, type SocialEventContext } from "./social";
import { handleVoiceEvent, type VoiceEventContext } from "./voice";

export type RealtimeEventContexts = {
  hub: HubEventContext;
  social: SocialEventContext;
  chat: ChatEventContext;
  voice: VoiceEventContext;
  session: SessionEventContext;
};

export type RealtimeAppHandlers = {
  events: RealtimeEventContexts;
  onAuthError: (data: RealtimeFrame) => void;
  onIdentified: (data: RealtimeFrame, socket: WebSocket) => void;
  onClosed: () => void;
};

export function handleRealtimeEvent(data: RealtimeFrame, contexts: RealtimeEventContexts): void {
  if (handleHubEvent(data, contexts.hub)) return;
  if (handleSocialEvent(data, contexts.social)) return;
  if (handleChatEvent(data, contexts.chat)) return;
  if (handleVoiceEvent(data, contexts.voice)) return;
  handleSessionEvent(data, contexts.session);
}
