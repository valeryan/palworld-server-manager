import { z } from "zod";
import { route } from "@/server/http";
import { restoreConfiguration } from "@/server/services/configuration";

export const POST = route<{ id: string; versionId: string }>(async (request, { id, versionId }) => {
  const { baseRevision } = z.object({ baseRevision: z.number().int().nonnegative() }).parse(await request.json());
  return { result: await restoreConfiguration(id, versionId, baseRevision) };
});
