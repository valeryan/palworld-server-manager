"use client";
import * as Tooltip from "@radix-ui/react-tooltip";

export function SettingHelp({ label, heading, guidance }: { label: string; heading: string; guidance: string }) {
  return <Tooltip.Root><Tooltip.Trigger asChild><button type="button" className="help-tip" aria-label={label} onClick={(event) => event.preventDefault()}>?</button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="setting-tooltip" sideOffset={6}><strong>{heading}</strong><span>{guidance}</span><Tooltip.Arrow className="setting-tooltip-arrow" /></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}
