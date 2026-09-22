# Palworld server setting reference

This document will become the evidence-backed source for the guided setting
editor. It is deliberately separate from the setting schema: a control can be
technically valid while still lacking enough explanation for an administrator
to make a good decision.

Coverage target: **0 of 107 settings fully researched**.

## What a complete setting entry requires

Every guided setting must document:

- INI key and administrator-facing name
- plain-language purpose
- shipped default for the server build being documented
- data type, unit, choices, and verified minimum/maximum when known
- for numeric values, the effect of increasing and decreasing the value
- performance, save compatibility, security, or gameplay risks
- related settings, prerequisites, deprecation state, and restart requirement
- source URL, source version or server build, access date, and evidence level

Unknown information must be written as **Unknown**, not inferred from a UI
control or copied from an uncited list. A practical UI limit and an engine
limit are different facts and must be identified separately.

## Evidence levels

Use the strongest available evidence and label every entry accordingly:

1. **Official** — the current Pocketpair Palworld Server Guide, release notes,
   or another first-party publication.
2. **Shipped default** — `DefaultPalWorldSettings.ini` from a recorded Steam
   dedicated-server build. This establishes that a key and default were
   shipped, but does not by itself establish a safe range or exact behavior.
3. **Verified by test** — a repeatable test against an isolated copied world,
   with the server build and observed result recorded.
4. **Community sourced** — a reputable maintained project or guide used only
   where first-party material is silent. It must be cited and presented as
   community knowledge rather than official fact.
5. **Unknown** — no sufficiently reliable evidence found yet.

The current official primary sources are:

- [Configuration parameters](https://docs.palworldgame.com/settings-and-operation/configuration/)
  — guide version 1.0.4, accessed 2026-09-20
- [Server launch arguments](https://docs.palworldgame.com/settings-and-operation/arguments/)
  — guide version 1.0.4, accessed 2026-09-20
- [Palworld Server Guide](https://docs.palworldgame.com/) — accessed
  2026-09-20

The official configuration page currently documents useful semantics for many
settings and explicit constraints for some, including base limits and Pal sync
distance. It does not establish universal numeric ranges, so the absence of a
published bound must not be interpreted as unlimited or safe.

## Entry template

### `SettingKey` — Administrator-facing name

| Property | Value |
| --- | --- |
| Category | Unclassified |
| Type / unit | Unknown |
| Shipped default | Unknown |
| Verified minimum | Unknown |
| Verified maximum | Unknown |
| Restart required | Unknown |
| Evidence level | Unknown |

**Purpose:** Research required.

**Increasing:** Not applicable or research required.

**Decreasing:** Not applicable or research required.

**Operational notes:** Research required.

**Related settings:** Unknown.

**Sources:** Add direct links, document/server versions, and access dates.

## UI publication rules

- Tooltips should summarize the purpose, units, direction, and most important
  warning in a few sentences; they should not merely restate the field label.
- Expanded help should contain the complete reference entry and source links.
- The UI must distinguish a documented engine constraint from a conservative
  manager-side safety limit.
- Unsupported, reserved, and deprecated settings must be visibly identified.
- If sources disagree, show the disagreement and prefer the result verified on
  the currently supported dedicated-server build.
