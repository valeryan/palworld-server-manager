import { useMemo, useState } from "react";
import { decodeDefaultSettingValue, decodeSettingValue, PALWORLD_SETTING_FIELDS, type DecodedSettingValue, type PalworldSettingField } from "@/contracts/palworld-settings";
import { presets, valuesEqual, type Structured, type Value } from "./types";

const decodeAll = (decode: (field: PalworldSettingField) => DecodedSettingValue) => Object.fromEntries(PALWORLD_SETTING_FIELDS.map((field) => [field.key, decode(field)])) as Record<string, DecodedSettingValue>;

/**
 * The game-settings draft: decoded active, applied and shipped-default values, the user's edits,
 * and which fields are staged for a reset to the shipped default.
 */
export function useSettingsDraft(configuration: Structured) {
  const activeStates = useMemo(() => decodeAll((field) => decodeSettingValue(field, configuration.options[field.key])), [configuration]);
  const appliedStates = useMemo(() => decodeAll((field) => decodeSettingValue(field, configuration.appliedOptions[field.key])), [configuration]);
  const defaultStates = useMemo(() => decodeAll((field) => decodeDefaultSettingValue(field, configuration.shippedDefaults.options[field.key])), [configuration]);
  const initial = useMemo(() => Object.fromEntries(PALWORLD_SETTING_FIELDS.map((field) => {
    const active = activeStates[field.key]!; const shipped = defaultStates[field.key]!;
    return [field.key, active.status === "valid" ? active.value : active.status === "missing" && shipped.status === "valid" ? shipped.value : undefined];
  })) as Record<string, Value | undefined>, [activeStates, defaultStates]);
  const [draft, setDraft] = useState<Record<string, Value | undefined>>(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [resetToDefaults, setResetToDefaults] = useState<Set<string>>(new Set());

  // Untouched fields follow the loaded values, which can refresh (e.g. shipped defaults) without a revision remount.
  const staged = (key: string) => touched.has(key) ? draft[key] : initial[key];
  const changed = PALWORLD_SETTING_FIELDS.filter((field) => resetToDefaults.has(field.key) || (touched.has(field.key) && !valuesEqual(draft[field.key], initial[field.key])));
  const changedKeys = new Set(changed.map((field) => field.key));

  const without = (key: string) => (current: Set<string>) => { const next = new Set(current); next.delete(key); return next; };
  const setValue = (key: string, value: Value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setTouched((current) => new Set(current).add(key));
    setResetToDefaults(without(key));
  };
  const stageDefaultRepair = (field: PalworldSettingField) => {
    const shipped = defaultStates[field.key]; if (shipped?.status !== "valid") return;
    setDraft((current) => ({ ...current, [field.key]: shipped.value }));
    setResetToDefaults((current) => new Set(current).add(field.key));
    setTouched((current) => new Set(current).add(field.key));
  };
  const revertField = (key: string) => {
    setDraft((current) => ({ ...current, [key]: initial[key] }));
    setTouched(without(key));
    setResetToDefaults(without(key));
  };
  /** Stages a preset's values; returns the preset so the caller can announce it. */
  const applyPreset = (name: string) => {
    const preset = presets[name]; if (!preset) return undefined;
    setDraft((current) => ({ ...current, ...preset.values }));
    setTouched((current) => new Set([...current, ...Object.keys(preset.values)]));
    setResetToDefaults((current) => new Set([...current].filter((key) => !Object.hasOwn(preset.values, key))));
    return preset;
  };
  const discard = () => { setDraft(initial); setTouched(new Set()); setResetToDefaults(new Set()); };
  /** Changed values to send, excluding fields that are being reset to the shipped default. */
  const changes = () => Object.fromEntries(changed.filter((field) => !resetToDefaults.has(field.key)).map((field) => [field.key, draft[field.key]]));

  return { activeStates, appliedStates, defaultStates, resetToDefaults, staged, changed, changedKeys, setValue, stageDefaultRepair, revertField, applyPreset, discard, changes };
}
