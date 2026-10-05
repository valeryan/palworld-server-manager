import { route } from "@/server/http";
import { languageResources } from "@/server/services/localization";

export const GET = route(() => new Response(`${JSON.stringify(languageResources("en"), null, 2)}\n`, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="psm-next-en.json"' } }));
