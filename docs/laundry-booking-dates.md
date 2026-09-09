# Laundry booking availability dates

Laundry bookings from the portal and Cozoro Bee check a resident's cleaning-away status through `getLaundryAwayDateRange` in `api/src/laundry-away-date.ts`.

Use the booking instant's calendar date in `Asia/Ho_Chi_Minh`. Cleaning availability records represent calendar-day labels stored at UTC noon, so query UTC midnight through (but excluding) the following UTC midnight for that label. These bounds are for stored date labels, not the actual instants of Vietnam midnight.

Do not use `getFullYear()`, `getMonth()`, or `getDate()` on the booking instant: those methods use the server timezone. On a Vancouver host, September 7, 2026 at 08:30 in Vietnam is September 6 locally. The old code queried September 6 and incorrectly rejected residents who were away the previous day but available on September 7.

Both `POST /laundry/bookings` and Bee's `book_my_laundry` use the helper. Same-day away restrictions remain in effect; no resident availability records are changed.

Run `corepack pnpm --filter cozorohome-api test:laundry`. Tests cover Vancouver/UTC/Vietnam host timezones, the reported morning case, same-day and adjacent-day restrictions, Vietnam midnight, year rollover, leap days, and invalid dates.
