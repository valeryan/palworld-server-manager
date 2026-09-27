import { expect, test, type Page } from "@playwright/test";

const themes = [
  { id: "pal", name: "Pal" },
  { id: "mega", name: "Mega" },
  { id: "giga", name: "Giga" },
  { id: "hyper", name: "Hyper" },
  { id: "ultra", name: "Ultra" },
  { id: "legendary", name: "Legendary" },
  { id: "ultimate", name: "Ultimate" },
  { id: "exotic", name: "Exotic" },
  { id: "sol", name: "Sol" },
  { id: "ancient", name: "Ancient" },
] as const;

async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "psm_admin", value: "e2e-admin", domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
}

async function persistedTheme(page: Page): Promise<string | undefined> {
  const response = await page.request.get("/api/settings");
  const payload = await response.json() as { settings?: { theme?: string } };
  return payload.settings?.theme;
}

test("selects and restores every application theme", async ({ page }) => {
  await authenticate(page);
  await page.goto("/settings");

  for (const theme of themes) {
    const radio = page.getByRole("radio", { name: new RegExp(`^${theme.name}\\b`) });
    await radio.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.id);
    await expect(radio).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => persistedTheme(page)).toBe(theme.id);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.id);
    await expect(page.getByRole("radio", { name: new RegExp(`^${theme.name}\\b`) })).toHaveAttribute("aria-checked", "true");
  }

  await page.goto("/remote");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ancient");

  await page.goto("/settings");
  await page.getByRole("radio", { name: /^Pal\b/ }).click();
  await expect.poll(() => persistedTheme(page)).toBe("pal");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "pal");
  await expect(page.getByRole("radio", { name: /^Pal\b/ })).toHaveAttribute("aria-checked", "true");
});
