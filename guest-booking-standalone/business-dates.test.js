const assert = require("assert");
const {
  businessTodayKey,
  addBusinessDays,
  formatBookingDateKey,
  parseBusinessDate,
  businessDayStartMs,
  nightsBetween,
  hoursUntilBusinessCheckIn,
  isFaceCaptureWindowOpen
} = require("./business-dates");

function run() {
  assert.strictEqual(addBusinessDays("2026-03-15", 1), "2026-03-16");
  assert.strictEqual(addBusinessDays("2026-03-15", 3), "2026-03-18");
  assert.strictEqual(nightsBetween("2026-03-15", "2026-03-18"), 3);

  const noon = parseBusinessDate("2026-03-15");
  assert.strictEqual(noon.toISOString(), "2026-03-15T12:00:00.000Z");
  assert.strictEqual(formatBookingDateKey(noon), "2026-03-15");

  // Legacy Vancouver encoding of UTC midnight for 2026-03-15.
  const legacyInstant = new Date("2026-03-15T00:00:00.000Z");
  assert.strictEqual(formatBookingDateKey(legacyInstant), "2026-03-15");

  const vnStart = businessDayStartMs("2026-03-15");
  assert.strictEqual(new Date(vnStart).toISOString(), "2026-03-14T17:00:00.000Z");

  const fortyEightHoursBefore = vnStart - 48 * 3600000;
  assert.strictEqual(isFaceCaptureWindowOpen("2026-03-15", 48, fortyEightHoursBefore), true);
  assert.strictEqual(isFaceCaptureWindowOpen("2026-03-15", 48, fortyEightHoursBefore - 1), false);
  assert.strictEqual(isFaceCaptureWindowOpen("2026-03-15", 48, vnStart), true);
  assert.strictEqual(isFaceCaptureWindowOpen("2026-03-15", 48, vnStart + 1), false);

  const hours = hoursUntilBusinessCheckIn("2026-03-15", vnStart - 12 * 3600000);
  assert.ok(Math.abs(hours - 12) < 0.001);

  const today = businessTodayKey(new Date("2026-03-15T02:00:00.000Z"));
  // 02:00 UTC = 09:00 ICT on March 15
  assert.strictEqual(today, "2026-03-15");

  const stillPreviousDayInVancouver = businessTodayKey(new Date("2026-03-15T06:00:00.000Z"));
  // 06:00 UTC = 13:00 ICT March 15; 23:00 PDT March 14
  assert.strictEqual(stillPreviousDayInVancouver, "2026-03-15");

  console.log("business-dates tests passed");
}

run();
