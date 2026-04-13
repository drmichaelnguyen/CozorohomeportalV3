import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { requirePortalRole } from "./staff-access.js";

const settingsFilePath = path.join(process.cwd(), "data", "portal-ux-settings.json");

export type PortalUxSettings = {
  /** When true, residents with unpaid monthly rent see a blocking notice until they tap Hide. */
  blockingRentDuePopupEnabled: boolean;
};

const DEFAULT_SETTINGS: PortalUxSettings = {
  blockingRentDuePopupEnabled: false
};

async function ensureJsonFile<T extends Record<string, unknown>>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<T>;
    return { ...fallback, ...parsed };
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

export async function getPortalUxSettings(): Promise<PortalUxSettings> {
  return ensureJsonFile(settingsFilePath, DEFAULT_SETTINGS);
}

export async function updatePortalUxSettings(
  actorEmail: string,
  input: { blockingRentDuePopupEnabled?: boolean }
): Promise<PortalUxSettings> {
  await requirePortalRole(
    actorEmail.trim(),
    ["manager", "owner", "app_admin"],
    "Only managers, owners, or the app admin can update portal UX settings."
  );

  const current = await getPortalUxSettings();
  const next: PortalUxSettings = {
    blockingRentDuePopupEnabled:
      typeof input.blockingRentDuePopupEnabled === "boolean"
        ? input.blockingRentDuePopupEnabled
        : current.blockingRentDuePopupEnabled
  };

  await writeFile(settingsFilePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
