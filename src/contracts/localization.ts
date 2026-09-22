import { z } from "zod";

export const languageCodePattern = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

export const languagePackSchema = z.object({
  meta: z.object({
    code: z.string().regex(languageCodePattern),
    name: z.string().trim().min(1).max(80),
    nativeName: z.string().trim().min(1).max(80),
    direction: z.enum(["ltr", "rtl"]).default("ltr"),
    version: z.literal(1),
  }).strict(),
  translations: z.record(z.string().min(1).max(160), z.string().max(10_000)),
}).strict().superRefine((pack, context) => {
  const keys = Object.keys(pack.translations);
  if (keys.length > 3_000) context.addIssue({ code: "custom", message: "Language packs may contain at most 3,000 translation keys.", path: ["translations"] });
  for (const key of keys) {
    if (key === "__proto__" || key === "prototype" || key === "constructor" || key.includes("..")) {
      context.addIssue({ code: "custom", message: `Unsafe translation key: ${key}`, path: ["translations", key] });
    }
  }
});

export type LanguagePack = z.infer<typeof languagePackSchema>;
export type LanguageSummary = LanguagePack["meta"] & {
  builtIn: boolean;
  translated: number;
  total: number;
  coverage: number;
};

export type LanguageCatalog = {
  active: string;
  fallback: "en";
  directory: string;
  languages: LanguageSummary[];
};
