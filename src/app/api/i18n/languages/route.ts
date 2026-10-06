import { ConflictError } from "@/server/errors";
import { route } from "@/server/http";
import { installLanguagePack, languageCatalog, removeLanguagePack, selectLanguage } from "@/server/services/localization";

export const GET = route(async () => ({ catalog: await languageCatalog() }));

export const POST = route(async (request) => {
  const body = await request.json() as { action?: unknown; code?: unknown; content?: unknown };
  if (body.action === "select" && typeof body.code === "string") return { catalog: await selectLanguage(body.code) };
  if (body.action === "install" && typeof body.content === "string") return { catalog: await installLanguagePack(body.content) };
  throw new ConflictError("Choose a language or provide a language-pack file.");
});

export const DELETE = route(async (request) => {
  const code = new URL(request.url).searchParams.get("code");
  if (!code) throw new ConflictError("Language code is required.");
  return { catalog: await removeLanguagePack(code) };
});
