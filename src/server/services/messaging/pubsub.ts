// src/server/services/messaging/pubsub.ts
//
// In-process pub/sub for SSE message broadcast. Single Node process only.
// Multi-process scaling requires a Postgres LISTEN/NOTIFY adapter (deferred).

import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
emitter.setMaxListeners(1000); // SSE connections can pile up under load

export const messagingPubsub = {
  emit(channel: string, message: unknown): void {
    emitter.emit(channel, message);
  },
  on(channel: string, handler: (message: unknown) => void): () => void {
    emitter.on(channel, handler);
    return () => emitter.off(channel, handler);
  },
};
