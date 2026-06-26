import type { Locator, Page } from "@playwright/test";

export function findLandmark(page: Page, name: string): Locator {
  switch (name) {
    case "status":
      return page.getByRole("status");
    case "alert":
      return page.getByRole("alert");
    default:
      return page
        .getByRole("region", { name })
        .or(page.getByRole("dialog", { name }))
        .or(page.getByRole("main", { name }));
  }
}
