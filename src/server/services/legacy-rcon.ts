import "server-only";
import { createConnection, type Socket } from "node:net";
import { database } from "@/server/db";
import { events } from "@/server/db/schema";
import { getWorld } from "./worlds";

type RconPacket = { id: number; type: number; payload: string };
type PacketWaiter = { resolve(packet: RconPacket): void; reject(error: Error): void; timer: NodeJS.Timeout };

const MAX_PACKET_BYTES = 1_048_576;
const RCON_TIMEOUT_MS = 5_000;

function encodePacket(id: number, type: number, payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const packet = Buffer.alloc(body.length + 14);
  packet.writeInt32LE(body.length + 10, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  body.copy(packet, 12);
  return packet;
}

function packetReader(socket: Socket) {
  let buffer = Buffer.alloc(0); let failure: Error | null = null;
  const queued: RconPacket[] = []; const waiters: PacketWaiter[] = [];
  const fail = (error: Error) => { failure = error; while (waiters.length) { const waiter = waiters.shift()!; clearTimeout(waiter.timer); waiter.reject(error); } };
  const deliver = (packet: RconPacket) => {
    const waiter = waiters.shift();
    if (!waiter) queued.push(packet);
    else { clearTimeout(waiter.timer); waiter.resolve(packet); }
  };
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer.readInt32LE(0);
      if (size < 10 || size > MAX_PACKET_BYTES) { fail(new Error("The RCON server returned an invalid packet.")); socket.destroy(); return; }
      if (buffer.length < size + 4) return;
      const frame = buffer.subarray(0, size + 4); buffer = buffer.subarray(size + 4);
      deliver({ id: frame.readInt32LE(4), type: frame.readInt32LE(8), payload: frame.subarray(12, frame.length - 2).toString("utf8") });
    }
  });
  socket.on("error", (error) => fail(error));
  socket.on("close", () => fail(new Error("The RCON connection closed before a response arrived.")));
  return () => {
    const packet = queued.shift(); if (packet) return Promise.resolve(packet);
    if (failure) return Promise.reject(failure);
    return new Promise<RconPacket>((resolve, reject) => {
      const waiter: PacketWaiter = { resolve, reject, timer: setTimeout(() => {
        const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1);
        reject(new Error("The RCON server did not respond within 5 seconds."));
      }, RCON_TIMEOUT_MS) };
      waiters.push(waiter);
    });
  };
}

async function connect(socket: Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("The RCON server did not accept a connection within 5 seconds.")); socket.destroy(); }, RCON_TIMEOUT_MS);
    const connected = () => { cleanup(); resolve(); }; const failed = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timer); socket.off("connect", connected); socket.off("error", failed); };
    socket.once("connect", connected); socket.once("error", failed);
  });
}

async function execute(host: string, port: number, password: string, command: string): Promise<string> {
  const socket = createConnection({ host, port }); const readPacket = packetReader(socket);
  try {
    await connect(socket); socket.setNoDelay(true);
    socket.write(encodePacket(1, 3, password));
    const authentication = await readPacket();
    if (authentication.id === -1 || authentication.type !== 2) throw new Error("RCON authentication failed.");
    socket.write(encodePacket(2, 2, command));
    const response = await readPacket();
    if (response.type !== 0) throw new Error("The RCON server returned an unexpected response.");
    // Palworld currently returns command responses with ID 0 rather than echoing
    // the request ID, so response correlation must be connection-local.
    if (response.id !== 0 && response.id !== 2) throw new Error("The RCON server returned an unrelated response.");
    return response.payload;
  } finally { socket.destroy(); }
}

export async function runLegacyRconCommand(worldId: string, command: string): Promise<string> {
  const world = await getWorld(worldId);
  if (!world) throw new Error("World not found.");
  if (world.status !== "running") throw new Error("Start the server before using the legacy RCON console.");
  if (!world.rconEnabled) throw new Error("Legacy RCON is disabled for this world.");
  if (!world.adminPassword) throw new Error("Set an administrator password before using legacy RCON.");
  const output = await execute("127.0.0.1", world.rconPort, world.adminPassword, command);
  await database().insert(events).values({ worldId, kind: "legacy-rcon", message: `Ran RCON command: ${command.split(/\s+/, 1)[0]}`, createdAt: Date.now() });
  return output;
}
