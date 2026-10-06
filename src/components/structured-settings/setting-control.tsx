"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DecodedSettingValue, PalworldSettingField, PalworldSettingPresentation } from "@/contracts/palworld-settings";
import { settingFieldKey } from "@/lib/localization-resources";
import { SettingHelp } from "../setting-help";
import type { Value } from "./types";

// One game setting: its label, badges, the input for its type, and the revert action.

type InputProps = { field: PalworldSettingField; inputId: string; label: string; value: Value; onChange(value: Value): void };

function BoolControl({ label, value, onChange }: InputProps) {
  const { t } = useTranslation();
  return <button type="button" className={`toggle ${value ? "on" : ""}`} aria-label={label} aria-pressed={Boolean(value)} onClick={() => onChange(!value)}><i />{t(value ? "common.on" : "common.off")}</button>;
}
function SelectControl({ field, inputId, value, onChange }: InputProps) {
  return <select id={inputId} value={String(value)} onChange={(event) => onChange(event.target.value)}>{field.options?.map((choice) => <option key={choice}>{choice}</option>)}</select>;
}
function MultiSelectControl({ field, inputId, label, value, onChange }: InputProps) {
  return <div id={inputId} className="setting-pill-select" role="group" aria-label={label}>{field.options?.map((choice) => {
    const selected = Array.isArray(value) && value.includes(choice); const lastSelected = selected && value.length === 1;
    return <button key={choice} type="button" className={selected ? "selected" : ""} aria-pressed={selected} disabled={lastSelected} onClick={() => onChange(selected ? value.filter((item) => item !== choice) : [...(Array.isArray(value) ? value : []), choice])}>{selected && <span aria-hidden="true">✓</span>}{choice}</button>;
  })}</div>;
}
function PasswordControl({ inputId, value, onChange }: InputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return <span className="password-control"><input id={inputId} type={visible ? "text" : "password"} value={String(value)} autoComplete="new-password" onChange={(event) => onChange(event.target.value)} /><button type="button" className="button ghost" aria-label={t(visible ? "structured.hidePassword" : "structured.showPassword")} onClick={() => setVisible((current) => !current)}>{t(visible ? "structured.hide" : "structured.show")}</button></span>;
}
function ScalarControl({ field, inputId, value, onChange }: InputProps) {
  const numeric = field.type === "int" || field.type === "float";
  return <input id={inputId} type={numeric ? "number" : "text"} value={String(value)} min={field.min} max={field.max} step={field.type === "int" ? 1 : field.type === "float" ? 0.1 : undefined} onChange={(event) => onChange(numeric ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)} />;
}
function SettingInput(props: InputProps) {
  switch (props.field.type) {
    case "bool": return <BoolControl {...props} />;
    case "select": return <SelectControl {...props} />;
    case "multi-select": return <MultiSelectControl {...props} />;
    case "password": return <PasswordControl {...props} />;
    default: return <ScalarControl {...props} />;
  }
}

export type SettingControlProps = {
  field: PalworldSettingField; presentation: PalworldSettingPresentation; value: Value | undefined;
  activeState: DecodedSettingValue; appliedState: DecodedSettingValue; defaultState: DecodedSettingValue; pendingApply: boolean;
  changed: boolean; resetScheduled: boolean; onChange(value: Value): void; onReplaceDefault(): void; onRevert(): void;
};

export function SettingControl({ field, presentation, value, activeState, appliedState, pendingApply, defaultState, changed, resetScheduled, onChange, onReplaceDefault, onRevert }: SettingControlProps) {
  const { t } = useTranslation(); const label = t(settingFieldKey(field.key, "label")); const guidance = t(settingFieldKey(field.key, "hint")); const inputId = `setting-${field.key}`;
  const invalid = activeState.status === "invalid";
  const unavailable = value === undefined;
  const savedDisplay = field.type === "password" ? t("structured.savedPassword") : activeState.status === "valid" ? Array.isArray(activeState.value) ? activeState.value.join(", ") : String(activeState.value) : activeState.status === "missing" ? t("structured.unset") : activeState.raw;
  const differsFromApplied = pendingApply && JSON.stringify(activeState) !== JSON.stringify(appliedState);
  const appliedDisplay = field.type === "password" ? t("structured.savedPassword") : appliedState.status === "valid" ? Array.isArray(appliedState.value) ? appliedState.value.join(", ") : String(appliedState.value) : t("structured.unset");
  return <div className={`structured-field ${presentation} ${changed ? "changed" : ""} ${invalid && !changed ? "invalid" : ""}`}>
    <div className="setting-label"><span><label htmlFor={field.type === "bool" ? undefined : inputId}>{label}</label><SettingHelp label={t("structured.helpFor", { setting: label })} heading={field.key} guidance={guidance} />{changed && <em className="change-badge">{resetScheduled ? t("structured.repairStaged") : t("structured.changedBadge")}</em>}{differsFromApplied && <em className="change-badge">{t("structured.appliesAfterRestartActive", { value: appliedDisplay })}</em>}{activeState.status === "missing" && defaultState.status === "valid" && !changed && <em>{t("structured.shippedDefault")}</em>}</span></div>
    {invalid && !changed ? <div className="invalid-setting"><code>{activeState.raw}</code><span>{activeState.reason}</span>{defaultState.status === "valid" && <button type="button" className="button ghost" onClick={onReplaceDefault}>{t("structured.replaceDefault")}</button>}</div>
      : unavailable ? <div className="unsupported-setting">{defaultState.status === "unsupported-default" ? t("structured.unsupportedDefault", { value: defaultState.raw }) : t("structured.unsetNoDefault")}</div>
      : <SettingInput field={field} inputId={inputId} label={label} value={value} onChange={onChange} />}
    {changed && <button type="button" className="field-revert" onClick={onRevert}>{t("structured.revert", { value: savedDisplay })}</button>}
  </div>;
}
