import "server-only";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { ManagerEvent } from "@/contracts/job";

class ManagerEventBus extends EventEmitter {
  publish(event: Omit<ManagerEvent, "id" | "timestamp">): ManagerEvent {
    const complete = { ...event, id: randomUUID(), timestamp: Date.now() } satisfies ManagerEvent;
    this.emit("event", complete);
    return complete;
  }

  subscribe(listener: (event: ManagerEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }
}

declare global { var __psmEventBus: ManagerEventBus | undefined; }
export function eventBus(): ManagerEventBus { globalThis.__psmEventBus ??= new ManagerEventBus(); return globalThis.__psmEventBus; }
