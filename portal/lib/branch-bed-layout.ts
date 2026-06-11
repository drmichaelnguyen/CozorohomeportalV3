/**
 * Branch room/bed layout — keep in sync with docs/branch-room-bed-layout.md
 * and api/src/branch-bed-layout.ts
 */

export type BedTier = "top" | "middle" | "bottom";

export type BranchLayoutRoom = {
  room: string;
  floor: string;
  startBed: number;
  endBed: number;
  /** Number of physical bunk columns in the room (each column has up to 3 beds). */
  bunkCount: number;
};

export const BRANCH_LAYOUTS: Record<"D2" | "D7", BranchLayoutRoom[]> = {
  D2: [
    { room: "1", floor: "D2", startBed: 1, endBed: 9, bunkCount: 3 },
    { room: "2", floor: "D2", startBed: 10, endBed: 15, bunkCount: 2 },
    { room: "3", floor: "D2", startBed: 16, endBed: 21, bunkCount: 2 }
  ],
  D7: [
    { room: "1.1", floor: "Floor 1", startBed: 1, endBed: 9, bunkCount: 3 },
    { room: "1.2", floor: "Floor 1", startBed: 10, endBed: 15, bunkCount: 2 },
    { room: "1.3", floor: "Floor 1", startBed: 16, endBed: 24, bunkCount: 3 },
    { room: "2.1", floor: "Floor 2", startBed: 25, endBed: 33, bunkCount: 3 },
    { room: "2.2", floor: "Floor 2", startBed: 34, endBed: 39, bunkCount: 2 },
    { room: "2.3", floor: "Floor 2", startBed: 40, endBed: 48, bunkCount: 3 },
    { room: "3.1", floor: "Floor 3", startBed: 49, endBed: 57, bunkCount: 3 },
    { room: "3.2", floor: "Floor 3", startBed: 58, endBed: 63, bunkCount: 2 }
  ]
};

const BED_TIER_CYCLE: BedTier[] = ["bottom", "middle", "top"];

export function getBedTierInRoom(room: BranchLayoutRoom, bedNumber: number): BedTier | null {
  if (bedNumber < room.startBed || bedNumber > room.endBed) return null;
  const tierIdx = (bedNumber - room.startBed) % 3;
  return BED_TIER_CYCLE[tierIdx] ?? null;
}

export function getBedTier(branchId: "D2" | "D7", bedNumber: number): BedTier | null {
  const room = BRANCH_LAYOUTS[branchId].find((r) => bedNumber >= r.startBed && bedNumber <= r.endBed);
  if (!room) return null;
  return getBedTierInRoom(room, bedNumber);
}

export function findLayoutRoom(branchId: "D2" | "D7", bedNumber: number): BranchLayoutRoom | null {
  return BRANCH_LAYOUTS[branchId].find((r) => bedNumber >= r.startBed && bedNumber <= r.endBed) ?? null;
}

/** Bunk stacks bottom→top (bed numbers ascending within each stack). */
export function getBunkBedGroups(room: BranchLayoutRoom): number[][] {
  const groups: number[][] = [];
  for (let start = room.startBed; start <= room.endBed; start += 3) {
    const stack: number[] = [];
    for (let bed = start; bed < start + 3 && bed <= room.endBed; bed++) stack.push(bed);
    if (stack.length) groups.push(stack);
  }
  return groups;
}

/** Same stacks with top bunk first (for vertical UI columns). */
export function getBunkBedGroupsTopFirst(room: BranchLayoutRoom): number[][] {
  return getBunkBedGroups(room).map((stack) => [...stack].reverse());
}

export const BED_TIER_SHORT_LABELS: Record<BedTier, string> = {
  bottom: "B",
  middle: "M",
  top: "T"
};

export function getBedTierShortLabel(tier: BedTier): string {
  return BED_TIER_SHORT_LABELS[tier];
}
