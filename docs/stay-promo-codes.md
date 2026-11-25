# Stay promo codes

Staff-managed typed promo codes for **long-term registration** and/or **short-term hostel booking**. Separate from sheet-backed PricingDiscount rules and from donation partnership (`CZD-…`) coupons.

## Where staff manage them

**Manager → Settings → Pricing → Promo codes** (owner / app admin).

Each code has:

| Field | Meaning |
|-------|---------|
| Code | Guests type this (3–32 chars: letters, numbers, `_`, `-`) |
| Term | `LONG_TERM`, `SHORT_TERM`, or `BOTH` |
| Benefit | Fixed VND, percent off, or waive nights/months |
| Max uses | Global use limit (`1` = one-time) |
| Min nights / months | Optional stay-length gate |
| Allowed beds | Optional list like `D7:12, D7:13` (blank = any bed) |
| Expires | Optional end date |

Deposit is never discounted. A registration or hostel booking may use **either** a promo code **or** a partnership coupon, not both.

## Benefit math

| Type | Short-term | Long-term |
|------|------------|-----------|
| Fixed VND | Cap at stay subtotal (after weekly/monthly stay discounts) | Cap at first-payment rent (excludes deposit) |
| Percent off | % of that stay subtotal | % of first-month rent, capped to rent portion |
| Waive units | Sum of the N lowest nightly rates | N × monthly rent, capped to rent portion |

## Guest entry

- Long-term: registration form → **Promo code**
- Short-term: hostel booking form → **Promo code**

## Lifecycle

1. `POST /api/public/promo-codes/quote` — eligibility + discount preview  
2. Redeem on submit (`POST /api/public/register` or hostel `createPendingBooking` via `/internal/promo-codes/redeem`)  
3. Release on reject / cancel (`/internal/promo-codes/release`) so `usedCount` can go back down  

Deleting a code that already has redemptions **disables** it instead of hard-deleting.

## APIs

| Route | Who |
|-------|-----|
| `GET /manager/promo-codes?actorEmail=` | Staff |
| `PUT /manager/promo-codes` | Owner / app admin |
| `DELETE /manager/promo-codes/:id?actorEmail=` | Owner / app admin |
| `POST /api/public/promo-codes/quote` | Public |
| `POST /internal/promo-codes/redeem` | Internal key |
| `POST /internal/promo-codes/release` | Internal key |

Prisma models: `StayPromoCode`, `StayPromoRedemption`.
