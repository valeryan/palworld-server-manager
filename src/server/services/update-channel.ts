import "server-only";
import { updateChannels, type UpdateChannel } from "@/contracts/application-update";
import { readAppSetting, writeAppSetting } from "@/server/db/app-settings";
import { clearApplicationUpdateCache, defaultUpdateChannel } from "./application-update";

const SETTING_KEY = "update-channel-v1";
const isUpdateChannel = (value: unknown): value is UpdateChannel => updateChannels.includes(value as UpdateChannel);

export function getUpdateChannel(currentVersion: string): Promise<UpdateChannel> {
  return readAppSetting(SETTING_KEY, (value) => { const channel = (value as { channel?: unknown } | null)?.channel; return isUpdateChannel(channel) ? channel : undefined; }, defaultUpdateChannel(currentVersion));
}

export async function saveUpdateChannel(value: unknown): Promise<UpdateChannel> {
  if (!isUpdateChannel(value)) throw new Error("The selected update channel is invalid.");
  await writeAppSetting(SETTING_KEY, { channel: value });
  clearApplicationUpdateCache();
  return value;
}

// Only the packaged desktop app sets PSM_PACKAGED; every other run is development.
export function updateChecksDisabled(): "development" | undefined { return process.env.PSM_PACKAGED === "1" ? undefined : "development"; }
