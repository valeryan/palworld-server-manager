import "server-only";
import { eq } from "drizzle-orm";
import { database } from "@/server/db";
import { appSettings } from "@/server/db/schema";

type Writer = Pick<ReturnType<typeof database>, "insert">;

/** The stored value for `key`, passed through `parse`; `fallback` when the row is missing or rejected. */
export async function readAppSetting<T>(key: string, parse: (value: unknown) => T | undefined, fallback: T): Promise<T> {
  const [row] = await database().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return (row ? parse(row.value) : undefined) ?? fallback;
}

/** Upserts `value` under `key`, inside `tx` when one is given. Returns the statement so a transaction can `.run()` it. */
export function writeAppSetting(key: string, value: unknown, tx: Writer = database()) {
  return tx.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}
