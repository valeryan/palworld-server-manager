import "server-only";
import { eq } from "drizzle-orm";
import { updateChannels, type UpdateChannel } from "@/contracts/application-update";
import { database } from "@/server/db";
import { appSettings } from "@/server/db/schema";
import { clearApplicationUpdateCache, defaultUpdateChannel } from "./application-update";

const SETTING_KEY = "update-channel-v1";
const isUpdateChannel = (value: unknown): value is UpdateChannel => updateChannels.includes(value as UpdateChannel);

export async function getUpdateChannel(currentVersion: string): Promise<UpdateChannel> {
  const [record] = await database().select().from(appSettings).where(eq(appSettings.key, SETTING_KEY)).limit(1);
  const value = (record?.value as { channel?: unknown } | undefined)?.channel;
  return isUpdateChannel(value) ? value : defaultUpdateChannel(currentVersion);
}

export async function saveUpdateChannel(value: unknown): Promise<UpdateChannel> {
  if (!isUpdateChannel(value)) throw new Error("The selected update channel is invalid.");
  await database().insert(appSettings).values({ key: SETTING_KEY, value: { channel: value } }).onConflictDoUpdate({ target: appSettings.key, set: { value: { channel: value } } });
  clearApplicationUpdateCache();
  return value;
}

// Only the packaged desktop app sets PSM_PACKAGED; every other run is development.
export function updateChecksDisabled(): "development" | undefined { return process.env.PSM_PACKAGED === "1" ? undefined : "development"; }
