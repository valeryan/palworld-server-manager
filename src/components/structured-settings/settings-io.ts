import type { WorldRegistration } from "@/contracts/world";
import { fetchBlob, fetchJson, requestJson } from "@/lib/http-client";
import type { StructuredResponse, Value } from "./types";

// Requests the guided settings page makes, and the file export/import plumbing around them.

export const MAX_IMPORT_ARCHIVE_BYTES = 5_000_000;
/** Query keys whose data a settings change invalidates. */
export const settingsQueryKeys = (worldId: string) => [["configuration-options", worldId], ["configuration", worldId], ["configuration-versions", worldId], ["world", worldId]];

export const fetchAdministration = (worldId: string) => fetchJson<StructuredResponse>(`/api/worlds/${worldId}/configuration/admin`);

export function saveAdministration(worldId: string, body: { baseRevision: number; changes: Record<string, Value | undefined>; resetToDefaults: string[]; managed: Record<string, unknown> }) {
  return requestJson<{ configurationChanged?: boolean }>(`/api/worlds/${worldId}/configuration/admin`, { method: "PUT", body: JSON.stringify(body) });
}

export function reconcileConfiguration(worldId: string, action: "import-file" | "reapply-desired") {
  return requestJson(`/api/worlds/${worldId}/configuration/reconcile`, { method: "POST", body: JSON.stringify({ action }) });
}

function downloadBlob(name: string, blob: Blob) { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }

export async function exportConfiguration(worldId: string) { downloadBlob(`palworld-settings-${worldId}.zip`, await fetchBlob(`/api/worlds/${worldId}/configuration/export`)); }

/** Uploads a settings archive as base64 against the revision the page was loaded with. */
export async function importConfiguration(worldId: string, file: File, baseRevision: number) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  await requestJson(`/api/worlds/${worldId}/configuration/import`, { method: "POST", body: JSON.stringify({ zipBase64: btoa(binary), baseRevision }) });
}

export function registrationFileName(name: string) { const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "world"; return `${slug}.psm-next.json`; }

export async function fetchRegistration(worldId: string): Promise<string> {
  const { registration } = await fetchJson<{ registration: WorldRegistration }>(`/api/worlds/${worldId}/registration`);
  return `${JSON.stringify(registration, null, 2)}\n`;
}

/** Saves through the desktop dialog when available, otherwise as a browser download; null when the user cancelled. */
export async function saveRegistrationFile(fileName: string, content: string): Promise<string | null> {
  if (window.psmDesktop) return window.psmDesktop.saveRegistration(fileName, content);
  downloadBlob(fileName, new Blob([content], { type: "application/json" }));
  return fileName;
}

export function unregisterWorld(worldId: string) { return fetchJson(`/api/worlds/${worldId}`, { method: "DELETE" }); }
