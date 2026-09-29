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
// experimental-latest is a rolling tag, so the asset name and digest are the pin.
export const MOD_CATALOG: readonly CatalogArtifact[] = [
  {
    id: "ue4ss-windows",
    kind: "ue4ss",
    name: "UE4SS",
    variant: "windows",
    version: "3.0.1-1151-g03dbd5c0",
    project: "UE4SS-RE/RE-UE4SS",
    projectUrl: "https://github.com/UE4SS-RE/RE-UE4SS/releases/tag/experimental-latest",
    license: "MIT",
    url: "https://github.com/UE4SS-RE/RE-UE4SS/releases/download/experimental-latest/UE4SS_v3.0.1-1151-g03dbd5c0.zip",
    fileName: "UE4SS_v3.0.1-1151-g03dbd5c0.zip",
    sizeBytes: 8_731_381,
    sha256: "d9e3f109c6417ab6488806922eeaeb4c521fe1234538914eb1d4b302af2325a7",
  },
  {
    id: "ue4ss-linux",
    kind: "ue4ss",
    name: "UE4SS for Linux",
    variant: "linux",
    version: "1.0.2-palworld-linux",
    project: "BlackBookOfficial/ue4ss-linux-palworld",
    projectUrl: "https://github.com/BlackBookOfficial/ue4ss-linux-palworld/releases/tag/v1.0.2-palworld-linux",
    license: "MIT",
    url: "https://github.com/BlackBookOfficial/ue4ss-linux-palworld/releases/download/v1.0.2-palworld-linux/ue4ss-linux-palworld-v1.0.2-palworld-linux.tar.gz",
    fileName: "ue4ss-linux-palworld-v1.0.2-palworld-linux.tar.gz",
    sizeBytes: 10_457_151,
    sha256: "9c472b62a633877acddf2dcaf61826583f0d50b2c4e11723c71da5a4ea81abd9",
  },
];
