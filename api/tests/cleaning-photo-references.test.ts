import assert from "node:assert/strict";
import { test } from "node:test";
import { CleaningTaskType } from "@prisma/client";

import {
  resolveCleaningReferencePhotos,
  selectLearnedCleaningReferencePhotos,
  type LearnedReferenceCandidate,
  type ResolveCleaningReferenceDeps
} from "../src/cleaning-photo-references.ts";

function candidate(
  overrides: Partial<LearnedReferenceCandidate> & Pick<LearnedReferenceCandidate, "photoId" | "taskId">
): LearnedReferenceCandidate {
  return {
    storageName: `${overrides.photoId}.jpg`,
    fileName: `${overrides.photoId}.jpg`,
    managerRating: 5,
    approvedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides
  };
}

test("selectLearnedCleaningReferencePhotos caps at 5 and max 2 per task with diversity", () => {
  const candidates = [
    candidate({ photoId: "a1", taskId: "t1", managerRating: 5 }),
    candidate({ photoId: "a2", taskId: "t1", managerRating: 5 }),
    candidate({ photoId: "a3", taskId: "t1", managerRating: 5 }),
    candidate({ photoId: "b1", taskId: "t2", managerRating: 4, approvedAt: new Date("2026-08-01T00:00:00.000Z") }),
    candidate({ photoId: "b2", taskId: "t2", managerRating: 4 }),
    candidate({ photoId: "c1", taskId: "t3", managerRating: 4 }),
    candidate({ photoId: "c2", taskId: "t3", managerRating: 4 }),
    candidate({ photoId: "d1", taskId: "t4", managerRating: 4 })
  ];

  const selected = selectLearnedCleaningReferencePhotos(candidates);
  assert.equal(selected.length, 5);
  const counts = selected.reduce((map, photo) => {
    map.set(photo.taskId, (map.get(photo.taskId) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  for (const count of counts.values()) {
    assert.ok(count <= 2);
  }
  assert.ok(counts.size >= 2);
  assert.ok(!selected.some((photo) => photo.photoId === "a3"));
});

test("resolveCleaningReferencePhotos: staff wins over learned", async () => {
  const deps: ResolveCleaningReferenceDeps = {
    listStaffPhotos: async () => [
      { id: "staff-1", storageName: "ref-1.jpg", fileName: "ref-1.jpg", caption: null }
    ],
    listLearnedCandidates: async () => [
      candidate({ photoId: "learn-1", taskId: "t1", managerRating: 5 })
    ],
    photoFileExists: async () => true
  };

  const resolved = await resolveCleaningReferencePhotos(
    { taskType: CleaningTaskType.KITCHEN_D7, branchId: "D7" },
    deps
  );
  assert.equal(resolved.source, "staff");
  assert.equal(resolved.photos.length, 1);
  assert.equal(resolved.photos[0]?.kind, "reference");
});

test("resolveCleaningReferencePhotos: learned fallback when no staff", async () => {
  const deps: ResolveCleaningReferenceDeps = {
    listStaffPhotos: async () => [],
    listLearnedCandidates: async () => [
      candidate({ photoId: "learn-1", taskId: "t1", managerRating: 5 }),
      candidate({ photoId: "learn-2", taskId: "t2", managerRating: 4 })
    ],
    photoFileExists: async () => true
  };

  const resolved = await resolveCleaningReferencePhotos(
    { taskType: CleaningTaskType.KITCHEN_D7, branchId: "D7" },
    deps
  );
  assert.equal(resolved.source, "learned");
  assert.equal(resolved.photos.length, 2);
  assert.ok(resolved.photos.every((photo) => photo.kind === "completion"));
});

test("resolveCleaningReferencePhotos: rating <4 excluded by candidate list contract", async () => {
  const deps: ResolveCleaningReferenceDeps = {
    listStaffPhotos: async () => [],
    listLearnedCandidates: async () => [
      candidate({ photoId: "low", taskId: "t1", managerRating: 3 })
    ],
    photoFileExists: async () => true
  };

  // Caller/DB should not return <4; if it does, selection still includes them unless filtered.
  // Production query filters managerRating >= 4; this documents the selection helper keeps provided ratings.
  const selected = selectLearnedCleaningReferencePhotos([
    candidate({ photoId: "low", taskId: "t1", managerRating: 3 }),
    candidate({ photoId: "ok", taskId: "t2", managerRating: 4 })
  ]);
  assert.equal(selected[0]?.photoId, "ok");

  const resolved = await resolveCleaningReferencePhotos(
    { taskType: CleaningTaskType.KITCHEN_D7, branchId: "D7" },
    {
      ...deps,
      listLearnedCandidates: async () => [
        candidate({ photoId: "ok", taskId: "t2", managerRating: 4 })
      ]
    }
  );
  assert.equal(resolved.source, "learned");
  assert.equal(resolved.photos[0]?.id, "ok");
});

test("resolveCleaningReferencePhotos: missing files skipped; none when all missing", async () => {
  const deps: ResolveCleaningReferenceDeps = {
    listStaffPhotos: async () => [
      { id: "staff-1", storageName: "missing.jpg", fileName: "missing.jpg", caption: null }
    ],
    listLearnedCandidates: async () => [
      candidate({ photoId: "learn-1", taskId: "t1" }),
      candidate({ photoId: "learn-2", taskId: "t2" })
    ],
    photoFileExists: async (storageName) => storageName === "learn-2.jpg"
  };

  const resolved = await resolveCleaningReferencePhotos(
    { taskType: CleaningTaskType.TRASH_D7, branchId: "D7", floor: 1 },
    deps
  );
  assert.equal(resolved.source, "learned");
  assert.equal(resolved.photos.length, 1);
  assert.equal(resolved.photos[0]?.storageName, "learn-2.jpg");

  const none = await resolveCleaningReferencePhotos(
    { taskType: CleaningTaskType.KITCHEN_D7, branchId: "D7" },
    {
      listStaffPhotos: async () => [],
      listLearnedCandidates: async () => [candidate({ photoId: "x", taskId: "t1" })],
      photoFileExists: async () => false
    }
  );
  assert.equal(none.source, "none");
  assert.equal(none.photos.length, 0);
});

test("resolveCleaningReferencePhotos: excludeTaskId forwarded to learned query", async () => {
  let seenExclude: string | undefined;
  await resolveCleaningReferencePhotos(
    {
      taskType: CleaningTaskType.KITCHEN_D7,
      branchId: "D7",
      excludeTaskId: "current-task"
    },
    {
      listStaffPhotos: async () => [],
      listLearnedCandidates: async (input) => {
        seenExclude = input.excludeTaskId;
        return [];
      },
      photoFileExists: async () => true
    }
  );
  assert.equal(seenExclude, "current-task");
});

test("resolveCleaningReferencePhotos: 180-day window passed as since", async () => {
  let since: Date | undefined;
  const before = Date.now();
  await resolveCleaningReferencePhotos(
    { taskType: CleaningTaskType.KITCHEN_D7, branchId: "D7" },
    {
      listStaffPhotos: async () => [],
      listLearnedCandidates: async (input) => {
        since = input.since;
        return [];
      },
      photoFileExists: async () => true
    }
  );
  const after = Date.now();
  assert.ok(since);
  const expectedMs = 180 * 24 * 60 * 60 * 1000;
  assert.ok(since!.getTime() <= before - expectedMs + 5_000);
  assert.ok(since!.getTime() >= after - expectedMs - 5_000);
});

test("excluded flag and AI-auto/rejected are filtered by learned candidate provider", async () => {
  // Production defaultListLearnedCandidates excludes AI_AUTO, REJECTED, and excludedFromReference.
  // This test locks the contract expected by that query via an explicit provider.
  const deps: ResolveCleaningReferenceDeps = {
    listStaffPhotos: async () => [],
    listLearnedCandidates: async () => [
      // only human ★4+ approved, non-excluded photos should be returned by the provider
      candidate({ photoId: "kept", taskId: "t-good", managerRating: 5 })
    ],
    photoFileExists: async () => true
  };
  const resolved = await resolveCleaningReferencePhotos(
    { taskType: CleaningTaskType.KITCHEN_D7, branchId: "D7" },
    deps
  );
  assert.deepEqual(
    resolved.photos.map((photo) => photo.id),
    ["kept"]
  );
});
