import { describe, expect, it } from "vitest";
import { setupTestDataDirectory } from "./prepare-database";

describe("persistent appearance settings", () => {
  setupTestDataDirectory("psm-appearance-test-", { closeDatabase: true, dataSubdir: false });

  it("uses Pal until a valid theme is stored in app settings", async () => {
    const { getTheme, saveTheme } = await import("@/server/services/appearance");
    await expect(getTheme()).resolves.toBe("pal");
    await expect(saveTheme("ancient")).resolves.toBe("ancient");
    await expect(getTheme()).resolves.toBe("ancient");
    await expect(saveTheme("missing-theme")).rejects.toThrow("invalid");
    await expect(getTheme()).resolves.toBe("ancient");
  });
});
