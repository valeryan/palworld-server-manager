import { z } from "zod";
import { validateAndEncodeSettingChanges } from "@/contracts/palworld-settings";
import { route } from "@/server/http";
import { readConfigurationOptions, saveConfigurationOptions } from "@/server/services/configuration";

export const GET = route<{ id: string }>(async (_request, { id }) => ({ configuration: await readConfigurationOptions(id) }));
export const PUT = route<{ id: string }>(async (request, { id }) => {
  const body = z.object({ changes: z.unknown(), baseRevision: z.number().int().nonnegative() }).strict().parse(await request.json());
  return { result: await saveConfigurationOptions(id, validateAndEncodeSettingChanges(body.changes), [], body.baseRevision) };
});
