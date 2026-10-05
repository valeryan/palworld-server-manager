import { route } from "@/server/http";
import { cancelJob } from "@/server/services/jobs";

export const POST = route<{ id: string }>(async (_request, { id }) => { await cancelJob(id); });
