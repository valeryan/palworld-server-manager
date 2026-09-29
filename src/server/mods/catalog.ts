import "server-only";
import type { ModVariant } from "@/contracts/mod";

export interface CatalogArtifact {
  id: string;
  kind: "ue4ss";
  name: string;
  variant: ModVariant;
  version: string;
  project: string;
  projectUrl: string;
  license: string;
  url: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

// Pinned, tested releases. Moving a pin is a code change made after the new
// build has been exercised; upstream updates are never picked up implicitly.
// Release tags can be republished in place, so the asset name and digest are the pin.
export const MOD_CATALOG: readonly CatalogArtifact[] = [
  {
    // Palworld build of RE-UE4SS experimental: identical to upstream apart from the
    // MemberVariableLayout.ini Palworld needs (the generic release omits it, and without it
    // hooked events can crash the server). Synced with the Steam Workshop UE4SS release.
    id: "ue4ss-windows",
    kind: "ue4ss",
    name: "UE4SS for Palworld",
    variant: "windows",
    version: "experimental-palworld-2026-08-28",
    project: "Okaetsu/RE-UE4SS",
    projectUrl: "https://github.com/Okaetsu/RE-UE4SS/releases/tag/experimental-palworld",
    license: "MIT",
    url: "https://github.com/Okaetsu/RE-UE4SS/releases/download/experimental-palworld/UE4SS-Palworld.zip",
    fileName: "UE4SS-Palworld.zip",
    sizeBytes: 8_513_965,
    sha256: "110061ace044842f2af2d3ff4b6dae578c5f4c7e27ce5ae5c99a8ed963cd9b77",
  },
  {
    // BlackBookOfficial/ue4ss-linux-palworld v1.0.2 crash-loops (SettingsManager::deserialize,
    // upstream issues #1/#11); the fixes are merged but unreleased there. This fork's release
    // carries them and was verified on Palworld v1.0.5 (deaths, on-screen notices, join/leave).
    id: "ue4ss-linux",
    kind: "ue4ss",
    name: "UE4SS for Linux",
    variant: "linux",
    version: "1.0.4-palworld-linux",
    project: "Qiiks/ue4ss-linux-palworld",
    projectUrl: "https://github.com/Qiiks/ue4ss-linux-palworld/releases/tag/v1.0.4-palworld-linux",
    license: "MIT",
    // The release's zip carries the same files as its tarball (verified), so both builds
    // go through the same zip handling.
    url: "https://github.com/Qiiks/ue4ss-linux-palworld/releases/download/v1.0.4-palworld-linux/ue4ss-linux-palworld-v1.0.4-palworld-linux.zip",
    fileName: "ue4ss-linux-palworld-v1.0.4-palworld-linux.zip",
    sizeBytes: 10_512_396,
    sha256: "f8e7a5d6dbb0004de564cdf18946c3c4dc8e3d35f497aa1134eb892a10b9bf1d",
  },
];
