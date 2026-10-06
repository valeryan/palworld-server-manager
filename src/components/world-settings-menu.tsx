"use client";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import type { PublicWorldView } from "@/contracts/world";
import { errorMessage } from "@/lib/errors";
import { exportConfiguration, fetchRegistration, importConfiguration, MAX_IMPORT_ARCHIVE_BYTES, registrationFileName, saveRegistrationFile, settingsQueryKeys, unregisterWorld } from "./structured-settings/settings-io";
import { presets } from "./structured-settings/types";

// The cog at the right of the Settings tab: view mode, presets, the game-settings archive, the
// manager registration file, and removing the world. Everything destructive confirms first.

export type SettingsMenuProps = {
  world: Pick<PublicWorldView, "id" | "displayName" | "status" | "processId" | "installDir">;
  mode: "guided" | "raw"; onModeChange(mode: "guided" | "raw"): void;
  /** The loaded settings revision; the archive import is unavailable until the guided page has one. */
  baseRevision?: number;
  onPreset?(name: string): void; onImported?(): void; onNotice(message: string): void;
};

function CogIcon() {
  return <svg className="cog-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
}

export function SettingsMenu({ world, mode, onModeChange, baseRevision, onPreset, onImported, onNotice }: SettingsMenuProps) {
  const { t } = useTranslation(); const router = useRouter(); const client = useQueryClient();
  const importInput = useRef<HTMLInputElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false); const [pending, setPending] = useState(false);
  const stopped = world.status === "stopped" && !world.processId;

  async function leave() { await client.invalidateQueries({ queryKey: ["worlds"] }); router.push("/"); }
  async function importArchive(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || baseRevision === undefined) return;
    if (file.size > MAX_IMPORT_ARCHIVE_BYTES) { onNotice(t("structured.archiveTooLarge")); return; }
    try { await importConfiguration(world.id, file, baseRevision); onNotice(t("structured.imported")); await Promise.all(settingsQueryKeys(world.id).map((queryKey) => client.invalidateQueries({ queryKey }))); onImported?.(); }
    catch (error) { onNotice(errorMessage(error)); }
  }
  async function exportRegistration() {
    setPending(true);
    try { const saved = await saveRegistrationFile(registrationFileName(world.displayName), await fetchRegistration(world.id)); onNotice(saved ? t("properties.exported", { path: saved }) : t("properties.exportCancelled")); }
    catch (error) { onNotice(errorMessage(error)); } finally { setPending(false); }
  }
  async function removeKeepingFiles() {
    if (!window.confirm(t("properties.unregisterConfirm", { world: world.displayName }))) return;
    setPending(true);
    try { await unregisterWorld(world.id); await leave(); } catch (error) { onNotice(errorMessage(error)); setPending(false); }
  }

  return <>
    <input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => void importArchive(event)} />
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild><button type="button" className="icon-button settings-cog" aria-label={t("settingsMenu.open")} title={t("settingsMenu.open")}><CogIcon /></button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="menu" align="end" sideOffset={6}>
        <DropdownMenu.Label className="menu-label">{t("settingsMenu.view")}</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={mode} onValueChange={(value) => onModeChange(value as "guided" | "raw")}>
          <DropdownMenu.RadioItem className="menu-item" value="guided"><DropdownMenu.ItemIndicator className="menu-indicator">✓</DropdownMenu.ItemIndicator>{t("world.config.guided")}</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem className="menu-item" value="raw"><DropdownMenu.ItemIndicator className="menu-indicator">✓</DropdownMenu.ItemIndicator>{t("world.config.raw")}</DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
        {onPreset && mode === "guided" && <><DropdownMenu.Separator className="menu-separator" /><DropdownMenu.Label className="menu-label">{t("settingsMenu.presets")}</DropdownMenu.Label>{Object.entries(presets).map(([name, preset]) => <DropdownMenu.Item key={name} className="menu-item" onSelect={() => onPreset(name)}>{t(preset.labelKey)}</DropdownMenu.Item>)}</>}
        <DropdownMenu.Separator className="menu-separator" />
        <DropdownMenu.Label className="menu-label">{t("settingsMenu.gameSettings")}</DropdownMenu.Label>
        <DropdownMenu.Item className="menu-item" onSelect={() => void exportConfiguration(world.id).catch((error) => onNotice(errorMessage(error)))}>{t("settingsMenu.exportZip")}</DropdownMenu.Item>
        <DropdownMenu.Item className="menu-item" disabled={baseRevision === undefined} onSelect={() => importInput.current?.click()}>{t("settingsMenu.importZip")}</DropdownMenu.Item>
        <DropdownMenu.Separator className="menu-separator" />
        <DropdownMenu.Label className="menu-label">{t("settingsMenu.registration")}</DropdownMenu.Label>
        <DropdownMenu.Item className="menu-item" disabled={pending} onSelect={() => void exportRegistration()}>{t("settingsMenu.exportRegistration")}</DropdownMenu.Item>
        <DropdownMenu.Separator className="menu-separator" />
        <DropdownMenu.Label className="menu-label danger">{t("settingsMenu.remove")}</DropdownMenu.Label>
        {!stopped && <DropdownMenu.Label className="menu-hint">{t("settingsMenu.stopFirst")}</DropdownMenu.Label>}
        <DropdownMenu.Item className="menu-item danger" disabled={!stopped || pending} onSelect={() => void removeKeepingFiles()}>{t("settingsMenu.removeKeep")}</DropdownMenu.Item>
        <DropdownMenu.Item className="menu-item danger" disabled={!stopped || pending} onSelect={() => setDeleteOpen(true)}>{t("settingsMenu.removeDelete")}</DropdownMenu.Item>
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
    <DeleteFilesDialog world={world} open={deleteOpen} onOpenChange={setDeleteOpen} onRemoved={leave} />
  </>;
}

// A sibling of the menu rather than a child of it, so closing the menu never unmounts the dialog.
function DeleteFilesDialog({ world, open, onOpenChange, onRemoved }: { world: SettingsMenuProps["world"]; open: boolean; onOpenChange(open: boolean): void; onRemoved(): Promise<void> }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState(""); const [error, setError] = useState<string | null>(null); const [working, setWorking] = useState(false);
  const matches = typed.trim() === world.displayName;
  async function remove() {
    setWorking(true); setError(null);
    try { await unregisterWorld(world.id, true); await onRemoved(); } catch (failure) { setError(errorMessage(failure)); setWorking(false); }
  }
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!working) { onOpenChange(next); if (!next) { setTyped(""); setError(null); } } }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog delete-world-dialog">
    <Dialog.Title>{t("settingsMenu.delete.title", { world: world.displayName })}</Dialog.Title>
    <Dialog.Description>{t("settingsMenu.delete.description")}</Dialog.Description>
    <code>{world.installDir}</code>
    <p className="muted">{t("settingsMenu.delete.kept")}</p>
    <label>{t("settingsMenu.delete.typeName", { world: world.displayName })}<input autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} spellCheck={false} autoComplete="off" /></label>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="dialog-actions"><Dialog.Close asChild><button type="button" className="button ghost" disabled={working}>{t("common.cancel")}</button></Dialog.Close><button type="button" className="button danger" disabled={!matches || working} onClick={() => void remove()}>{t(working ? "settingsMenu.delete.working" : "settingsMenu.delete.confirm")}</button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
