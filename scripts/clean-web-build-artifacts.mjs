import { rmSync } from "node:fs";
import path from "node:path";

// A previous prepared standalone tree must not become input to the next
// standalone trace. It is generated again by prepare:standalone after build.
rmSync(path.join(process.cwd(), "dist-standalone"), { recursive: true, force: true });
