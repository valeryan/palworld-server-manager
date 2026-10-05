import { route } from "@/server/http";
import { downloadArtifact } from "@/server/mods/library";

export const POST = route<{ artifactId: string }>(async (_request, { artifactId }) => ({ jobId: await downloadArtifact(artifactId) }), { status: 202 });
