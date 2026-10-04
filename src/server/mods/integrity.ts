import "server-only";
import type { ModIntegrity } from "@/contracts/mod";
import type { WorldView } from "@/contracts/world";
import type { JobContext } from "@/server/services/jobs";
import { checkLuaModFiles, installLuaMod } from "./lua-mods";
import { checkRelayFiles, installRelay } from "./relays";
import { checkUe4ssFiles, installUe4ss } from "./ue4ss-runtime";

// Checks only what PSM installed: its UE4SS runtime, its relays, and library Lua mods.
export async function checkManagedMods(world: Pick<WorldView, "id" | "installDir" | "platform">): Promise<ModIntegrity> {
  const [ue4ss, relays, lua] = await Promise.all([checkUe4ssFiles(world), checkRelayFiles(world), checkLuaModFiles(world)]);
  const problems: ModIntegrity["problems"] = [];
  if (ue4ss && (ue4ss.missing.length || ue4ss.changed.length)) problems.push({ kind: "ue4ss", name: "UE4SS", missing: ue4ss.missing.length, changed: ue4ss.changed.length, repairable: ue4ss.libraryAvailable });
  for (const relay of relays) if (relay.missing || relay.changed) problems.push({ kind: "relay", name: relay.id, missing: relay.missing ? 1 : 0, changed: relay.changed ? 1 : 0, repairable: true });
  for (const mod of lua) if (mod.missing.length || mod.changed.length) problems.push({ kind: "lua", name: mod.name, missing: mod.missing.length, changed: mod.changed.length, repairable: mod.libraryAvailable });
  const checked = (ue4ss ? 1 : 0) + relays.length + lua.length;
  return { checked, needsRepair: problems.length > 0, problems };
}

export function describeIntegrity(integrity: ModIntegrity): string {
  if (!integrity.checked) return "No mods installed by PSM in this world.";
  if (!integrity.needsRepair) return `All ${integrity.checked} mod installation(s) PSM manages are intact.`;
  return `Needs repair: ${integrity.problems.map((problem) => `${problem.name} (${[problem.missing && `${problem.missing} missing`, problem.changed && `${problem.changed} changed`].filter(Boolean).join(", ")})`).join("; ")}. Open the world's Mods tab to repair.`;
}

// Restores only what the check found broken, from the library copies. Never downloads: a
// missing library copy stops the repair with a message saying what to download or import.
export async function repairManagedMods(world: Pick<WorldView, "id" | "installDir" | "platform" | "status" | "processId">, context: JobContext): Promise<void> {
  const integrity = await checkManagedMods(world);
  if (!integrity.needsRepair) { await context.update(100, "Nothing to repair"); return; }
  const blocked = integrity.problems.filter((problem) => !problem.repairable);
  if (blocked.length) throw new Error(`The library copy is missing for ${blocked.map((problem) => problem.name).join(", ")}. Download or import it in the Mods library, then repair again.`);
  const lua = await checkLuaModFiles(world);
  // UE4SS first: the relays and Lua mods live in its Mods folder.
  for (const problem of [...integrity.problems].sort((left, right) => Number(right.kind === "ue4ss") - Number(left.kind === "ue4ss"))) {
    context.log(`Repairing ${problem.name}`);
    if (problem.kind === "ue4ss") await installUe4ss(world, { replace: false }, { ...context, update: async () => undefined });
    else if (problem.kind === "relay") await installRelay(world, problem.name as "death-relay" | "broadcast");
    else await installLuaMod(world, lua.find((mod) => mod.name === problem.name)!.artifactId);
  }
  const after = await checkManagedMods(world);
  if (after.needsRepair) throw new Error(`Repair did not fix everything. ${describeIntegrity(after)}`);
  await context.update(100, `Repaired ${integrity.problems.length} mod installation(s)`);
}
