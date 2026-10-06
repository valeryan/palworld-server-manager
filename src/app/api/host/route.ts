import { hostCapabilities } from "@/server/host";
import { route } from "@/server/http";

export const GET = route(() => ({ host: hostCapabilities() }));
