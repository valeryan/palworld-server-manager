import type { ManagerEvent } from "@/contracts/job";
import { route } from "@/server/http";
import { eventBus } from "@/server/services/events";

export const GET = route(async (request) => {
  const encoder = new TextEncoder(); let unsubscribe = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ManagerEvent) => controller.enqueue(encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      unsubscribe = eventBus().subscribe(send);
      controller.enqueue(encoder.encode(": connected\n\n"));
      request.signal.addEventListener("abort", () => { unsubscribe(); try { controller.close(); } catch {} }, { once: true });
    },
    cancel() { unsubscribe(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
});
