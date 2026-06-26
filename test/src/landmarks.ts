import type { Locator, Page } from "@playwright/test";

export function findLandmark(page: Page, name: string): Locator {
  switch (name) {
    case "Add feed":
      return page.getByRole("dialog", { name: "Add feed" });
    case "status":
      return page.getByRole("status");
    case "alert":
      return page.getByRole("alert");
    case "Arcade workspace":
      return page.getByRole("main", { name: "Arcade workspace" });
    default:
      return page.getByRole("region", { name });
  }
}
