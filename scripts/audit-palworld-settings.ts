import { splitConfigurationOptions } from "../src/lib/palworld-ini";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodeDefaultSettingValue, PALWORLD_MANAGER_SETTING_KEYS, PALWORLD_SETTING_FIELDS } from "../src/contracts/palworld-settings";

const fixturePath = path.join(process.cwd(), "tests/fixtures/DefaultPalWorldSettings-1.0.5.ini");
const provenancePath = path.join(process.cwd(), "tests/fixtures/DefaultPalWorldSettings-1.0.5.json");

function parse(content: string): Record<string, string> {
  const body = content.match(/OptionSettings=\((.*)\)/s)?.[1];
  if (body == null) throw new Error("Template does not contain OptionSettings=(...).");
  const tokens = splitConfigurationOptions(body);
  return Object.fromEntries(tokens.map((token) => { const separator = token.indexOf("="); return [token.slice(0, separator).trim(), token.slice(separator + 1).trim()]; }));
}

const targetPath = path.resolve(process.argv[2] || fixturePath);
const [fixtureContent, targetContent, provenanceContent] = await Promise.all([readFile(fixturePath, "utf8"), readFile(targetPath, "utf8"), readFile(provenancePath, "utf8")]);
const fixture = parse(fixtureContent); const target = parse(targetContent);
const provenance = JSON.parse(provenanceContent) as { palworldVersion: string; steamBuildId: string; capturedAt: string; sha256: string };
const checksum = createHash("sha256").update(fixtureContent).digest("hex");
if (checksum !== provenance.sha256) throw new Error("Fixture checksum does not match its provenance record; refresh both files in one reviewed change.");

const fixtureKeys = new Set(Object.keys(fixture)); const targetKeys = new Set(Object.keys(target));
const added = [...targetKeys].filter((key) => !fixtureKeys.has(key)).sort();
const removed = [...fixtureKeys].filter((key) => !targetKeys.has(key)).sort();
const changed = [...targetKeys].filter((key) => fixtureKeys.has(key) && target[key] !== fixture[key]).sort();
const codecMismatches = PALWORLD_SETTING_FIELDS.flatMap((field) => {
  const decoded = decodeDefaultSettingValue(field, target[field.key]);
  return decoded.status === "valid" ? [] : [field.key];
});

console.log(`Fixture: Palworld ${provenance.palworldVersion}, Steam build ${provenance.steamBuildId}, captured ${provenance.capturedAt}`);
console.log(`Audited: ${targetPath}`);
console.log(`Added keys (${added.length}): ${added.join(", ") || "none"}`);
console.log(`Removed keys (${removed.length}): ${removed.join(", ") || "none"}`);
console.log(`Changed defaults (${changed.length}): ${changed.join(", ") || "none"}`);
console.log(`Codec mismatches (${codecMismatches.length}): ${codecMismatches.join(", ") || "none"}`);
console.log(`Manager-owned keys (${PALWORLD_MANAGER_SETTING_KEYS.length}): ${PALWORLD_MANAGER_SETTING_KEYS.join(", ")}`);
if (added.length || removed.length || changed.length || codecMismatches.length) process.exitCode = 1;
