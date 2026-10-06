import { route } from "@/server/http";
import { MOD_CATALOG } from "@/server/mods/catalog";
import { removeArtifact } from "@/server/mods/library";
import { removeLuaArtifact } from "@/server/mods/lua-library";

export const DELETE = route<{ artifactId: string }>(async (_request, { artifactId }) => {
  if (MOD_CATALOG.some((entry) => entry.id === artifactId)) await removeArtifact(artifactId); else await removeLuaArtifact(artifactId);
});
