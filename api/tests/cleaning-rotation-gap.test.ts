import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeEffectiveRotationGap,
  getCleaningCadencePlan,
  getCleaningDutyDays,
  isCleaningRestDay,
  shiftCleaningRotationDate,
  type CleaningRotationJob,
  type CleaningRotationTask
} from "../src/cleaning-rotation-gap.ts";

const trashFloor3: CleaningRotationJob = { type: "TRASH_D7", floor: 3 };
const HORIZON_START = "2026-10-16";

function enumerate(start: string, days: number) {
  return Array.from({ length: days }, (_, index) => shiftCleaningRotationDate(start, index));
}

function task(date: string, overrides: Partial<CleaningRotationTask> = {}): CleaningRotationTask {
  return {
    date,
    type: "TRASH_D7",
    floor: 3,
    ...overrides
  };
}

test("gap 1 fills every empty day and ignores nearby tasks", () => {
  const empty = getCleaningCadencePlan({
    job: trashFloor3,
    horizonStart: HORIZON_START,
    horizonDays: 15,
    effectiveGap: 1,
    existingTasks: []
  });
  assert.deepEqual(empty.dutyDates, enumerate(HORIZON_START, 15));
  assert.deepEqual(empty.restDates, []);

  const occupiedDate = shiftCleaningRotationDate(HORIZON_START, 2);
  const withTask = getCleaningCadencePlan({
    job: trashFloor3,
    horizonStart: HORIZON_START,
    horizonDays: 15,
    effectiveGap: 1,
    existingTasks: [task(occupiedDate)]
  });
  assert.equal(withTask.restDates.length, 0);
  assert.equal(withTask.dutyDates.length, 14);
  assert.ok(!withTask.dutyDates.includes(occupiedDate));
  assert.equal(isCleaningRestDay(trashFloor3, occupiedDate, [task(occupiedDate)], 1, HORIZON_START), false);
  assert.equal(isCleaningRestDay(trashFloor3, HORIZON_START, [task(occupiedDate)], 1, HORIZON_START), false);
});

test("gap 2 and gap 3 from an empty 15-day horizon", () => {
  const gap2 = getCleaningCadencePlan({
    job: trashFloor3,
    horizonStart: HORIZON_START,
    horizonDays: 15,
    effectiveGap: 2,
    existingTasks: []
  });
  assert.deepEqual(gap2.dutyDates, ["2026-10-16", "2026-10-18", "2026-10-20", "2026-10-22", "2026-10-24", "2026-10-26", "2026-10-28", "2026-10-30"]);
  assert.deepEqual(gap2.restDates, ["2026-10-17", "2026-10-19", "2026-10-21", "2026-10-23", "2026-10-25", "2026-10-27", "2026-10-29"]);

  const gap3 = getCleaningDutyDays({
    job: trashFloor3,
    horizonStart: HORIZON_START,
    horizonDays: 15,
    effectiveGap: 3,
    existingTasks: []
  });
  assert.deepEqual(gap3, ["2026-10-16", "2026-10-19", "2026-10-22", "2026-10-25", "2026-10-28"]);
});

test("anchor carry-over: task 1 day before horizon start with gap 3", () => {
  const existing = "2026-10-15";
  const plan = getCleaningCadencePlan({
    job: trashFloor3,
    horizonStart: HORIZON_START,
    horizonDays: 15,
    effectiveGap: 3,
    existingTasks: [task(existing)]
  });
  assert.deepEqual(plan.dutyDates, ["2026-10-18", "2026-10-21", "2026-10-24", "2026-10-27", "2026-10-30"]);
  assert.equal(plan.dutyDates[0], shiftCleaningRotationDate(existing, 3));
  assert.ok(plan.restDates.includes("2026-10-16"));
  assert.ok(plan.restDates.includes("2026-10-17"));
});

test("self-assigned task on a rest day re-anchors the next duty", () => {
  const selfAssigned = "2026-10-17";
  const tasks = [task(selfAssigned)];
  const plan = getCleaningCadencePlan({
    job: trashFloor3,
    horizonStart: HORIZON_START,
    horizonDays: 8,
    effectiveGap: 2,
    existingTasks: tasks
  });
  assert.deepEqual(plan.dutyDates, ["2026-10-19", "2026-10-21", "2026-10-23"]);
  assert.ok(plan.restDates.includes("2026-10-16"));
  assert.ok(plan.restDates.includes("2026-10-18"));
  assert.equal(plan.dutyDates[0], shiftCleaningRotationDate(selfAssigned, 2));
  assert.ok(!plan.dutyDates.includes(selfAssigned));
  assert.ok(!plan.restDates.includes(selfAssigned));
});

test("auto gap uses headcount, never goes tighter than the manual gap, and skips when nobody is eligible", () => {
  const three = computeEffectiveRotationGap({
    rotationGapDays: 1,
    autoGapEnabled: true,
    targetMaxDutiesPerResidentPer30Days: 6,
    eligibleCount: 3
  });
  assert.equal(three.skip, false);
  assert.equal(three.effectiveGap, 2);
  assert.equal(three.estimatedDutiesPerResidentPer30Days, 5);

  const tenAtManualFloor = computeEffectiveRotationGap({
    rotationGapDays: 2,
    autoGapEnabled: true,
    targetMaxDutiesPerResidentPer30Days: 6,
    eligibleCount: 10
  });
  assert.equal(tenAtManualFloor.skip, false);
  assert.equal(tenAtManualFloor.effectiveGap, 2);

  const tenDefaultManual = computeEffectiveRotationGap({
    rotationGapDays: 1,
    autoGapEnabled: true,
    targetMaxDutiesPerResidentPer30Days: 6,
    eligibleCount: 10
  });
  assert.equal(tenDefaultManual.effectiveGap, 1);

  const nobody = computeEffectiveRotationGap({
    rotationGapDays: 1,
    autoGapEnabled: true,
    targetMaxDutiesPerResidentPer30Days: 6,
    eligibleCount: 0
  });
  assert.equal(nobody.skip, true);
  assert.equal(nobody.estimatedDutiesPerResidentPer30Days, null);

  const manualWinsWhenAutoOff = computeEffectiveRotationGap({
    rotationGapDays: 1,
    autoGapEnabled: false,
    targetMaxDutiesPerResidentPer30Days: 6,
    eligibleCount: 3
  });
  assert.equal(manualWinsWhenAutoOff.effectiveGap, 1);
  assert.equal(manualWinsWhenAutoOff.skip, false);
});

test("rest-day helper excludes duty days and existing tasks", () => {
  const occupied = "2026-10-16";
  const tasks = [
    task(occupied),
    task("2026-10-17", { occupiesCadence: false }),
    task("2026-10-16", { floor: 2 }),
    task("2026-10-16", { type: "KITCHEN_D7", floor: null })
  ];
  const plan = getCleaningCadencePlan({
    job: trashFloor3,
    horizonStart: HORIZON_START,
    horizonDays: 5,
    effectiveGap: 2,
    existingTasks: tasks
  });
  assert.deepEqual(plan.dutyDates, ["2026-10-18", "2026-10-20"]);
  assert.deepEqual(plan.restDates, ["2026-10-17", "2026-10-19"]);
  assert.equal(isCleaningRestDay(trashFloor3, "2026-10-18", tasks, 2, HORIZON_START), false);
  assert.equal(isCleaningRestDay(trashFloor3, occupied, tasks, 2, HORIZON_START), false);
  assert.equal(isCleaningRestDay(trashFloor3, "2026-10-17", tasks, 2, HORIZON_START), true);
  assert.equal(isCleaningRestDay(trashFloor3, "2026-10-15", tasks, 2, HORIZON_START), false);
});
