import { createServer } from "node:net";
import { developmentUrl } from "./environment";
import { defaultManagerPort, validateManagerPort } from "./launch-options";

// Where the bundled web server listens for this launch. Only this launcher's window talks to it,
// so the port is chosen at startup: the preferred port when free, otherwise one the OS hands out.
// PSM_PORT pins it for test harnesses and must then be free.
let activePort: number | null = null;
export function port(): number { if (activePort === null) throw new Error("The manager port has not been bound yet."); return activePort; }
// Loopback only; PSM_HOST=0.0.0.0 exists for test harnesses, never for a user setting.
export const host = process.env.PSM_HOST === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";

function probe(candidate: number): Promise<number | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(null));
    server.listen(candidate, host, () => { const address = server.address(); server.close(() => resolve(address && typeof address === "object" ? address.port : null)); });
  });
}

export async function bindPort(): Promise<number> {
  if (activePort !== null) return activePort;
  if (developmentUrl) return (activePort = validateManagerPort(developmentUrl.port || "80"));
  if (process.env.PSM_PORT) {
    const pinned = validateManagerPort(process.env.PSM_PORT);
    if (await probe(pinned) === null) throw new Error(`Port ${pinned} from PSM_PORT is already in use.`);
    return (activePort = pinned);
  }
  const chosen = await probe(defaultManagerPort) ?? await probe(0);
  if (chosen === null) throw new Error("No free local port is available for the manager.");
  return (activePort = chosen);
}
