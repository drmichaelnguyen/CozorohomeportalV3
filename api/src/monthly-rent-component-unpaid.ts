import fs from "node:fs/promises";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
const filePath = path.join(dataDir, "monthly-rent-component-unpaid.json");

export type RentComponentKey =
  | "rentSubtotal"
  | "parking"
  | "gateParking"
  | "laundry"
  | "fines";

export type RentComponentUnpaid = Record<RentComponentKey, boolean>;

const DEFAULT_COMPONENT_UNPAID: RentComponentUnpaid = {
  rentSubtotal: false,
  parking: false,
  gateParking: false,
  laundry: false,
  fines: false
};

type Store = {
  updatedAt?: string;
  entries?: Record<string, Partial<RentComponentUnpaid>>;
};

let writeQueue: Promise<void> = Promise.resolve();

function keyFor(email: string, month: string): string {
  return `${email.trim().toLowerCase()}|${month.trim()}`;
}

function sanitize(input: Partial<RentComponentUnpaid> | null | undefined): RentComponentUnpaid {
  return {
    rentSubtotal: input?.rentSubtotal === true,
    parking: input?.parking === true,
    gateParking: input?.gateParking === true,
    laundry: input?.laundry === true,
    fines: input?.fines === true
  };
}

async function readStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
}

export async function getRentComponentUnpaid(email: string, month: string): Promise<RentComponentUnpaid> {
  const store = await readStore();
  const value = store.entries?.[keyFor(email, month)];
  return sanitize(value);
}

export async function upsertRentComponentUnpaid(
  email: string,
  month: string,
  patch: Partial<RentComponentUnpaid>
): Promise<RentComponentUnpaid> {
  const key = keyFor(email, month);
  let nextValue: RentComponentUnpaid = DEFAULT_COMPONENT_UNPAID;
  writeQueue = writeQueue.then(async () => {
    const store = await readStore();
    const current = sanitize(store.entries?.[key]);
    nextValue = sanitize({ ...current, ...patch });
    const allFalse = Object.values(nextValue).every((value) => value !== true);
    const entries = { ...(store.entries ?? {}) };
    if (allFalse) {
      delete entries[key];
    } else {
      entries[key] = nextValue;
    }
    await writeStore({
      updatedAt: new Date().toISOString(),
      entries
    });
  });
  await writeQueue;
  return nextValue;
}

export async function clearRentComponentUnpaid(email: string, month: string): Promise<void> {
  const key = keyFor(email, month);
  writeQueue = writeQueue.then(async () => {
    const store = await readStore();
    const entries = { ...(store.entries ?? {}) };
    if (entries[key] == null) return;
    delete entries[key];
    await writeStore({
      updatedAt: new Date().toISOString(),
      entries
    });
  });
  await writeQueue;
}

export function hasAnyUnpaidComponent(value: RentComponentUnpaid | null | undefined): boolean {
  if (!value) return false;
  return (
    value.rentSubtotal === true ||
    value.parking === true ||
    value.gateParking === true ||
    value.laundry === true ||
    value.fines === true
  );
}
