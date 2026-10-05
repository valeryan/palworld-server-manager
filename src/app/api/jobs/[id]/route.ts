import { NotFoundError } from "@/server/errors";
import { route } from "@/server/http";
import { getJob } from "@/server/services/jobs";

export const GET = route<{ id: string }>(async (_request, { id }) => {
  const job = await getJob(id);
  if (!job) throw new NotFoundError("Job not found.");
  return { job };
});
