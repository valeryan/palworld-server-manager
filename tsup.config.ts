import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "electron/main.ts",
    preload: "electron/preload.ts",
  },
  format: ["cjs"],
  outDir: "dist-electron",
  outExtension: () => ({ js: ".cjs" }),
  platform: "node",
  target: "node24",
  external: ["electron"],
  sourcemap: true,
  clean: true,
});
