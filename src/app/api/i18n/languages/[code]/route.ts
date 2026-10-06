import { route } from "@/server/http";
import { languageResources } from "@/server/services/localization";

export const GET = route<{ code: string }>((_request, { code }) => ({ pack: languageResources(code) }));
