import "server-only";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { languageCodePattern, languagePackSchema, type LanguageCatalog, type LanguagePack, type LanguageSummary } from "@/contracts/localization";
import { readAppSetting, writeAppSetting } from "@/server/db/app-settings";
import { writeFileAtomic } from "@/server/fs";
import { paths } from "@/server/paths";
import { englishGuidedSettingTranslations } from "@/lib/localization-resources";

const settingKey = "localization-v1";
const maxPackBytes = 512 * 1024;
const builtInDirectory = () => path.join(/* turbopackIgnore: true */ process.cwd(), "public", "locales");

function parsePack(content: string, source: string): LanguagePack {
  if (Buffer.byteLength(content, "utf8") > maxPackBytes) throw new Error(`${source} is larger than 512 KiB.`);
  let value: unknown;
  try { value = JSON.parse(content); }
  catch { throw new Error(`${source} is not valid JSON.`); }
  const result = languagePackSchema.safeParse(value);
  if (!result.success) throw new Error(`${source} is not a valid PSM Next language pack: ${result.error.issues[0]?.message ?? "validation failed"}`);
  return result.data;
}

function packsIn(directory: string, builtIn: boolean): Map<string, { pack: LanguagePack; builtIn: boolean }> {
  const result = new Map<string, { pack: LanguagePack; builtIn: boolean }>();
  let names: string[] = [];
  try { names = readdirSync(directory).filter((name) => name.endsWith(".json")); } catch { return result; }
  for (const name of names) {
    try {
      const pack = parsePack(readFileSync(path.join(/* turbopackIgnore: true */ directory, name), "utf8"), name);
      if (path.basename(name, ".json") !== pack.meta.code) continue;
      result.set(pack.meta.code, { pack, builtIn });
    } catch { /* Invalid optional packs are ignored instead of breaking startup. */ }
  }
  return result;
}

function discoveredPacks() {
  const bundled = packsIn(builtInDirectory(), true);
  const english = bundled.get("en");
  if (!english) throw new Error("The bundled English language pack is missing or invalid.");
  english.pack = { ...english.pack, translations: { ...english.pack.translations, ...englishGuidedSettingTranslations() } };
  const combined = new Map(bundled);
  for (const [code, item] of packsIn(paths.languagePacks(), false)) if (code !== "en") combined.set(code, item);
  return { english: english.pack, combined };
}

function configuredLanguage(): Promise<string> {
  return readAppSetting(settingKey, (value) => { const language = (value as { language?: unknown } | null)?.language; return typeof language === "string" ? language : undefined; }, "en");
}

export async function languageCatalog(): Promise<LanguageCatalog> {
  const { english, combined } = discoveredPacks();
  const total = Object.keys(english.translations).length;
  const languages: LanguageSummary[] = [...combined.values()].map(({ pack, builtIn }) => {
    const translated = Object.keys(english.translations).filter((key) => typeof pack.translations[key] === "string").length;
    return { ...pack.meta, builtIn, translated, total, coverage: total ? Math.round((translated / total) * 100) : 100 };
  }).sort((left, right) => left.code === "en" ? -1 : right.code === "en" ? 1 : left.nativeName.localeCompare(right.nativeName));
  const configured = await configuredLanguage();
  return { active: combined.has(configured) ? configured : "en", fallback: "en", directory: paths.languagePacks(), languages };
}

export function languageResources(code: string): LanguagePack {
  const { combined } = discoveredPacks();
  const item = combined.get(code);
  if (!item) throw new Error(`Language pack ${code} is not installed.`);
  return item.pack;
}

export async function selectLanguage(code: string): Promise<LanguageCatalog> {
  const { combined } = discoveredPacks();
  if (!combined.has(code)) throw new Error(`Language pack ${code} is not installed.`);
  await writeAppSetting(settingKey, { language: code });
  return languageCatalog();
}

export async function installLanguagePack(content: string): Promise<LanguageCatalog> {
  const pack = parsePack(content, "Selected file");
  if (pack.meta.code === "en") throw new Error("The built-in English pack cannot be replaced.");
  await writeFileAtomic(path.join(/* turbopackIgnore: true */ paths.languagePacks(), `${pack.meta.code}.json`), `${JSON.stringify(pack, null, 2)}\n`, { mode: 0o600 });
  return languageCatalog();
}

export async function removeLanguagePack(code: string): Promise<LanguageCatalog> {
  if (code === "en") throw new Error("The built-in English pack cannot be removed.");
  if (!languageCodePattern.test(code)) throw new Error("The language code is invalid.");
  if (!discoveredPacks().combined.has(code)) throw new Error(`Language pack ${code} is not installed.`);
  unlinkSync(path.join(/* turbopackIgnore: true */ paths.languagePacks(), `${code}.json`));
  if (await configuredLanguage() === code) await selectLanguage("en");
  return languageCatalog();
}
