# Cozoro Rent Calculation

This document describes how the Manager workspace rent calculator currently works in the app.

## Main Inputs

- Selected resident:
  Identified by `Địa chỉ email` from the client sheet.
- Target month:
  Chosen in the Manager UI. This is not stored in the client row.
- Manager discount:
  Entered manually in the Manager UI as `managerDiscountVnd`.
- Short-term surcharge rate:
  Defaults from contract duration, but the manager can override it in the UI.
- Parking fee:
  Defaults from `Phí gởi xe`, but the manager can override it in the UI.

## Sheet Column Mapping

- Base rent:
  `Số tiền chia sẻ mỗi tháng`
- Contract duration:
  `Thời hạn hợp đồng (tháng)`
- Payment plan:
  `Bạn muốn thanh toán chi phí như thế nào?`
- Monthly adjustment:
  `Ưu đãi tháng`
  Fallbacks supported in code: `Uu dai thang`, `Khoản ưu đãi và chi phí tăng thêm`, `Khoản ưu đãi và chi phí tăng thêm nếu có`
- 6+1 free-month notes:
  `Chú thích`
- Free-month marker:
  `Phí ở đóng mỗi tháng`
- Parking fee:
  `Phí gởi xe`
- Parking fallback if sheet parking fee is blank:
  `Biển số xe máy đăng ký gởi xe`
- Branch for laundry allowance:
  `Chi nhánh Cozoro dorm`
- Member tier for coin rate:
  `Cozoro Member`

## Default Short-Term Surcharge Rules

- If contract duration is less than 3 months: `12%`
- If contract duration is 4 or 5 months: `8%`
- Otherwise: `0%`

The Manager UI shows the rate as a percent and sends it to the API as a decimal.

Examples:

- `12` in the UI becomes `0.12`
- `8` in the UI becomes `0.08`

## Discount Logic

The calculator no longer infers a “professional discount” from student or workplace fields.

Instead, the monthly adjustment comes from:

- `Ưu đãi tháng`

Fallbacks currently supported in code:

- `Uu dai thang`
- `Khoản ưu đãi và chi phí tăng thêm`
- `Khoản ưu đãi và chi phí tăng thêm nếu có`

Current behavior:

- negative value = monthly discount
- positive value = monthly surcharge
- zero or blank = no monthly adjustment

For backward compatibility, the API still places the discount portion into `professionalDiscountVnd`, while the raw signed value is returned as `monthlyAdjustmentVnd`.

## Plan Logic

### 3-month plan

If `Bạn muốn thanh toán chi phí như thế nào?` contains `03 tháng` and the monthly-adjustment notes mention `giảm 500k`, the calculator applies:

- `planDiscountVnd = 500000`

### 6+1 plan

If `Bạn muốn thanh toán chi phí như thế nào?` contains `06 tháng`, and `Chú thích` contains `6+1` or `6t +1t`, and `Phí ở đóng mỗi tháng` is `0`, then:

- effective base rent becomes `0`

## Parking Logic

Default behavior:

- use `Phí gởi xe` if present
- if sheet parking fee is `0` and `Biển số xe máy đăng ký gởi xe` is present, default to one motorbike parking fee

Manager override behavior:

- the Manager UI can replace the parking fee used in the calculation
- the override affects calculation and receipt generation for that payment flow

## Laundry Logic

Laundry is not calculated from a single client-sheet column.

It is derived from:

- laundry bookings matched by resident email
- target month filter
- branch-specific allowance lookup using `Chi nhánh Cozoro dorm`

Breakdown fields returned:

- free uses count
- coin uses count
- cash uses count
- `laundryFeeVnd = cash uses * 7000`

## Fines Logic

Fines are not read from the client row directly.

They are derived from the fines dataset by resident email:

- unpaid fines only
- sum of coin-based fine cost and multiplier

## Coin Logic

Coin conversion depends on `Cozoro Member`.

Current rates:

- Elite: `1.0`
- Diamond: `0.9`
- Platinum: `0.8`
- Gold: `0.7`
- Silver: `0.6`

Tier order:

- Silver -> Gold -> Platinum -> Diamond -> Elite

Rules:

- the resident can use coins up to `10%` of the rent portion
- available coin value is based on current coin balance and the member rate
- recommended coin usage is the lower of:
  rent cap
  available coin value

## Calculation Flow

1. Read client row by `Địa chỉ email`
2. Read base rent
3. Determine effective short-term surcharge rate
4. Calculate surcharge amount
5. Read sheet discount amount
6. Apply any plan discount
7. Determine parking fee or use manager override
8. Calculate laundry fee
9. Calculate unpaid fines
10. Build subtotal before coins
11. Calculate recommended coin usage
12. Produce final total

## Manager UI Mapping

- `Target month` -> API `targetMonth`
- `Manager discount (VND)` -> API `managerDiscountVnd`
- `Short-term surcharge (%)` -> API `shortTermSurchargeRate`
- `Parking fee (₫)` -> API `parkingFeeVnd`

The Manager workspace has two rent-related places:

- monthly rent info card for preview / recalc
- payment receipt panel for final receipt generation

Both now use the same override fields for surcharge rate and parking fee.

## Important Caveats

- The app currently stores the discount portion of `Ưu đãi tháng` inside the `professionalDiscountVnd` field name in the API response for backward compatibility with the existing frontend structure.
- The signed value from `Ưu đãi tháng` is also returned as `monthlyAdjustmentVnd`, so the UI can distinguish monthly discount vs monthly surcharge.
- The manager override fields affect the current calculation flow and receipt flow, but they do not write those overrides back into the client sheet automatically.
