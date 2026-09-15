# Hostel booking stay dates (timezone)

Guest hostel bookings use **Vietnam calendar days** (`Asia/Ho_Chi_Minh`), even when the booking server runs in Vancouver (`America/Vancouver`).

## Rules

- Check-in / check-out are **date-only labels** (`YYYY-MM-DD`), not wall-clock check-in times.
- “Today”, default dates, past-date rejection, face-capture open/close, and cancellation 48h windows all use **Vietnam local midnight**.
- Night counts use **UTC noon** anchors (`YYYY-MM-DDT12:00:00.000Z`) so math does not depend on the host OS timezone.
- New rows write stay dates as UTC-noon `DATETIME` values. Reads go through `formatBookingDateKey` / `formatHostelBookingDateKey` — never slice the first 10 characters of a MySQL `DATETIME` string (legacy Vancouver rows store UTC midnight as the previous local evening).

## Code map

| Area | File |
|------|------|
| Standalone helpers | `guest-booking-standalone/business-dates.js` |
| Browser defaults / night math | `guest-booking-standalone/public/business-dates.js` |
| Server booking / refund / face capture | `guest-booking-standalone/server.js` |
| Main API helpers | `api/src/hostel-booking-dates.ts` |
| Paid import night count | `api/src/index.ts` (`/internal/guest-bookings/import-paid`) |
| Manager current/past guests | `api/src/index.ts` (`/manager/short-term/guests`) |
| Stripe list dates | `api/src/stripe-hostel-payments.ts` |

Optional env: `COZORO_TIMEZONE=Asia/Ho_Chi_Minh` (default). Do **not** change MySQL pool `timezone` without migrating existing `DATETIME` rows.

## Tests

From `guest-booking-standalone/`:

```bash
node business-dates.test.js
```

Covers Vietnam “today” vs Vancouver evening, UTC-noon round-trip, legacy UTC-midnight encoding, and the 48h face-capture window against Vietnam midnight.
