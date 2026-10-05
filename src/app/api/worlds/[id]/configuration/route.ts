import { z } from "zod";
import { route } from "@/server/http";
import { readConfiguration, saveConfiguration } from "@/server/services/configuration";

export const GET = route<{ id: string }>(async (_request, { id }) => ({ configuration: await readConfiguration(id) }));
export const PUT = route<{ id: string }>(async (request, { id }) => {
  const input = z.object({ content: z.string(), baseRevision: z.number().int().nonnegative() }).parse(await request.json());
  return { result: await saveConfiguration(id, input.content, input.baseRevision) };
});
