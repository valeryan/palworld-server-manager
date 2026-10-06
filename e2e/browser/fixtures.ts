import type { Page } from "@playwright/test";

export async function authenticate(page: Page) {
  await page.context().addCookies([{ name: "psm_admin", value: "e2e-admin", domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" }]);
}
