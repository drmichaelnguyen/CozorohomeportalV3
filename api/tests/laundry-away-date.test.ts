import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLaundryAwayDateRange } from '../src/laundry-away-date.js';

test('September 7 Vietnam bookings always check September 7, regardless of host timezone', () => {
  const originalTZ = process.env.TZ;
  try {
    for (const timezone of ['America/Vancouver', 'UTC', 'Asia/Ho_Chi_Minh']) {
      process.env.TZ = timezone;
      for (const start of ['2026-09-07T00:00:00+07:00', '2026-09-07T08:30:00+07:00', '2026-09-07T13:30:00+07:00', '2026-09-07T14:00:00+07:00', '2026-09-07T23:59:59+07:00']) {
        const range = getLaundryAwayDateRange(new Date(start));
        assert.equal(range.gte.toISOString(), '2026-09-07T00:00:00.000Z', `${timezone}: ${start}`);
        assert.equal(range.lt.toISOString(), '2026-09-08T00:00:00.000Z');
      }
    }
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});

test('previous-day away flag does not block; same-day away flag still blocks', () => {
  const range = getLaundryAwayDateRange(new Date('2026-09-07T01:30:00Z'));
  const matches = (label: string) => {
    const stored = new Date(`${label}T12:00:00Z`);
    return stored >= range.gte && stored < range.lt;
  };
  assert.equal(matches('2026-09-06'), false);
  assert.equal(matches('2026-09-07'), true);
  assert.equal(matches('2026-09-08'), false);
});

test('Vietnam midnight, month/year rollover and leap day use the correct stored day', () => {
  for (const [instant, label] of [
    ['2026-09-06T16:59:59Z', '2026-09-06'],
    ['2026-09-06T17:00:00Z', '2026-09-07'],
    ['2026-12-31T17:00:00Z', '2027-01-01'],
    ['2028-02-28T17:00:00Z', '2028-02-29'],
    ['2028-02-29T17:00:00Z', '2028-03-01']
  ]) {
    const range = getLaundryAwayDateRange(new Date(instant));
    assert.equal(range.gte.toISOString().slice(0, 10), label);
    assert.equal(range.lt.getTime() - range.gte.getTime(), 86400000);
  }
});

test('invalid dates cannot produce an availability query', () => {
  assert.throws(() => getLaundryAwayDateRange(new Date('invalid')), /Invalid booking start time/);
});
