import { z } from "zod";
import { route } from "@/server/http";
import { reconcileConfiguration } from "@/server/services/configuration";

export const POST = route<{ id: string }>(async (request, { id }) => {
  const input = z.object({ action: z.enum(["import-file", "reapply-desired"]) }).strict().parse(await request.json());
  return { result: await reconcileConfiguration(id, input.action) };
});
