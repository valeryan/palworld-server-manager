import { rconCommandSchema } from "@/contracts/admin";
import { route } from "@/server/http";
import { runLegacyRconCommand } from "@/server/services/legacy-rcon";

export const POST = route<{ id: string }>(async (request, { id }) => {
  const { command } = rconCommandSchema.parse(await request.json());
  return { output: await runLegacyRconCommand(id, command) };
});
