import { EventEmitter } from "node:events";
import type { RealtimeEvent } from "@opslens/shared-types";

/**
 * The entire pub/sub this project needs: one process, one in-memory
 * EventEmitter. server.ts (the composition root) feeds alert-evaluation-job
 * changes into publish(); each open SSE connection in realtime.routes.ts
 * calls subscribe() for the lifetime of the request. No external broker —
 * see docs/spec/06-realtime-architecture.md for why that would be solving
 * a multi-instance fan-out problem this single-process app doesn't have.
 */
export class EventBroadcaster {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Many concurrent SSE connections are many listeners on one instance.
    this.emitter.setMaxListeners(0);
  }

  publish(event: RealtimeEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: RealtimeEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}

export const eventBroadcaster = new EventBroadcaster();
