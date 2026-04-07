# Mapping Variable

This document maps Google Sheet column names to the app variables used in the codebase.

Source of truth:

- `api/src/google-sheets.ts`
- `api/src/calculation-engine.ts`
- `portal/components/manager-client.tsx`

## 1. Client Sheet -> App Variables

Primary sheet:

- `COZORODATABASE`

Canonical app constants in `api/src/google-sheets.ts`:

| Sheet column name | App constant / variable | Notes |
| --- | --- | --- |
| `Địa chỉ email` | `EMAIL_COLUMN` | Primary client lookup key |
| `Địa chỉ email - Hidden` | `HIDDEN_EMAIL_COLUMN` | Hidden / blocked from manager edit |
| `Hiện còn ở` | `ACTIVE_STAYING_COLUMN` | Active staying status |
| `MÃ HD` | `CONTRACT_CODE_COLUMN` | Contract code / `maHd` |
| `Tên` | `CLIENT_NAME_COLUMN` | Resident name |
| `số giường` | `CLIENT_BED_COLUMN` | Bed number |
| `Giới tính` | `CLIENT_GENDER_COLUMN` | Gender |
| `Chi nhánh Cozoro dorm` | `CLIENT_BRANCH_COLUMN` | Branch / D2 / D7 |
| `Số điện thoại liên hệ` | `CLIENT_PHONE_COLUMN` | Contact phone |
| `Ngày bắt đầu hợp đồng` | `CLIENT_CONTRACT_START_COLUMN` | Contract start |
| `Ngày hết hạn hợp đồng` | `CLIENT_CONTRACT_END_COLUMN` | Contract end |
| `Phí ngắn hạn` | `CLIENT_SHORT_TERM_FEE_COLUMN` | Short-term fee |
| `Miễn phí ngắn hạn?` | `CLIENT_SHORT_TERM_FREE_COLUMN` | Short-term free flag |
| `Tổng Coins tích luỹ` | `CLIENT_TOTAL_COINS_COLUMN` | Lifetime coins |
| `Chú thích` | `CLIENT_NOTE_COLUMN` | Notes |
| `Cozoro coins hiện có` | `CLIENT_CURRENT_COINS_COLUMN` | Current coin balance |

Manager-safe client object returned by API:

| App field | Reads from sheet column |
| --- | --- |
| `maHd` | `MÃ HD` |
| `email` | `Địa chỉ email` |
| `name` | `Tên` |
| `branch` | `Chi nhánh Cozoro dorm` |
| `bed` | `số giường` |
| `gender` | `Giới tính` |
| `activeStay` | `Hiện còn ở` |
| `currentCoins` | `Cozoro coins hiện có` |
| `totalCoins` | `Tổng Coins tích luỹ` |
| `recordedMember` | `Cozoro Member` |
| `row` | Entire mapped row |

## 2. Coins Sheet -> App Variables

Primary sheet:

- `COZORO COINS`

Canonical app constants:

| Sheet column name | App constant / variable | Notes |
| --- | --- | --- |
| `DẤU THỜI GIAN` | `COINS_TIMESTAMP_COLUMN` | Transaction timestamp |
| `COINS` | `COINS_BALANCE_COLUMN` | Coin delta |
| `Sự kiện` | `COINS_EVENT_COLUMN` | Event / reason |
| `Người thao tác` | `COINS_OPERATOR_COLUMN` | Operator |
| `Cozoro Member` | `COINS_MEMBER_COLUMN` | Member tier |
| `Số Coins hiện có` | `COINS_CURRENT_BALANCE_COLUMN` | Current balance after entry |
| `Mã giao dịch` | `COINS_TRANSACTION_CODE_COLUMN` | Transaction code |
| `Địa chỉ email` | `EMAIL_COLUMN` | Resident email |

App structures:

| App type / field | Meaning |
| --- | --- |
| `CoinRow` | Raw mapped coin sheet row |
| `CoinEntry.row` | Row shown in Manager UI |
| `CoinEntry.parsedTimestamp` | Parsed timestamp for display |

## 3. Payments Sheet -> App Variables

Primary sheet:

- `BIÊN NHẬN`

Canonical app constants:

| Sheet column name | App constant / variable | Notes |
| --- | --- | --- |
| `DẤU THỜI GIAN` | `PAYMENT_TIMESTAMP_COLUMN` | Payment timestamp |
| `SỐ TIỀN` | `PAYMENT_AMOUNT_COLUMN` | Amount |
| `MỤC ĐÍCH` | `PAYMENT_PURPOSE_COLUMN` | Payment purpose |
| `MỤC ĐÍCH - GHI RÕ` | `PAYMENT_DETAILS_COLUMN` | Detailed purpose |
| `NGƯỜI ĐÓNG TIỀN` | `PAYMENT_PAYER_COLUMN` | Payer |
| `NGƯỜI NHẬN TIỀN` | `PAYMENT_RECEIVER_COLUMN` | Receiver |
| `Địa chỉ email` | `EMAIL_COLUMN` | Resident email |

Manager UI compact payment columns:

| Sheet column name | UI usage |
| --- | --- |
| `Chi nhánh Dorm` | Payment branch |
| `DẤU THỜI GIAN` | Timestamp |
| `Địa chỉ email` | Resident email |
| `Số giường` | Bed |
| `NGƯỜI NHẬN TIỀN` | Receiver |
| `NGƯỜI ĐÓNG TIỀN` | Payer |
| `SỐ TIỀN` | Amount |
| `MỤC ĐÍCH` | Purpose |
| `MỤC ĐÍCH - GHI RÕ` | Details |
| `Địa chỉ email người nhận` | Recipient email |

## 4. Fines Sheet -> App Variables

Primary sheet:

- `PHÍ VI PHẠM`

Canonical app constants:

| Sheet column name | App constant / variable | Notes |
| --- | --- | --- |
| `EMAIL` | `FINE_EMAIL_COLUMN` | Resident email |
| `DẤU THỜI GIAN` | `FINE_TIMESTAMP_COLUMN` | Fine timestamp |
| `CHI PHÍ THANH TOÁN CHO VI PHẠM` | `FINE_AMOUNT_COLUMN` | Fine amount |
| `ĐÃ THANH TOÁN?` | `FINE_STATUS_COLUMN` | Paid flag |
| `NỘI DUNG VI PHẠM` | `FINE_CONTENT_COLUMN` | Fine content |
| `MÔ TẢ VI PHẠM` | `FINE_DESCRIPTION_COLUMN` | Fine description |
| `HẠN THANH TOÁN` | `FINE_DUE_COLUMN` | Due date |
| `Khieu nai tu khach hang` | `FINE_DISPUTE_COLUMN` | Dispute text |
| `THỜI ĐIỂM LẬP PHIẾU` | `FINE_CREATED_AT_COLUMN` | Created at |
| `NĂM LẬP PHIẾU` | `FINE_CREATED_YEAR_COLUMN` | Created year |
| `THÁNG LẬP PHIẾU` | `FINE_CREATED_MONTH_COLUMN` | Created month |
| `CHI NHÁNH DORM` | `FINE_BRANCH_COLUMN` | Branch |
| `TÊN` | `FINE_NAME_COLUMN` | Resident name |
| `SỐ GIƯỜNG` | `FINE_BED_COLUMN` | Bed |
| `NGƯỜI LẬP PHIẾU` | `FINE_CREATOR_COLUMN` | Fine creator |
| `VỊ TRÍ PHÁT HIỆN VI PHẠM` | `FINE_LOCATION_COLUMN` | Location |
| `HÌNH ẢNH` | `FINE_IMAGE_COLUMN` | Evidence image |

App structures:

| App type / field | Meaning |
| --- | --- |
| `FineRow` | Raw mapped fine row |
| `FineEntry.row` | Full sheet row |
| `FineEntry.parsedTimestamp` | Parsed timestamp |
| `FineEntry.parsedDueDate` | Parsed due date |
| `FineEntry.coinPayment` | Derived coin-payment metadata |

## 5. Maintenance Sheet -> App Variables

Primary sheet:

- `MAINTENANCE`

Canonical app constants:

| Sheet column name | App constant / variable |
| --- | --- |
| `TICKET ID` | `MAINTENANCE_TICKET_ID_COLUMN` |
| `RESIDENT EMAIL` | `MAINTENANCE_RESIDENT_EMAIL_COLUMN` |
| `RESIDENT NAME` | `MAINTENANCE_RESIDENT_NAME_COLUMN` |
| `BRANCH` | `MAINTENANCE_BRANCH_COLUMN` |
| `LOCATION` | `MAINTENANCE_LOCATION_COLUMN` |
| `DEVICE` | `MAINTENANCE_DEVICE_COLUMN` |
| `ISSUE DESCRIPTION` | `MAINTENANCE_ISSUE_COLUMN` |
| `REPORTED AT` | `MAINTENANCE_REPORTED_AT_COLUMN` |
| `STATUS` | `MAINTENANCE_STATUS_COLUMN` |
| `MECHANIC EMAIL` | `MAINTENANCE_MECHANIC_EMAIL_COLUMN` |
| `SOLVED AT` | `MAINTENANCE_SOLVED_AT_COLUMN` |
| `REPAIR TIME MINUTES` | `MAINTENANCE_REPAIR_TIME_COLUMN` |
| `RESIDENT SATISFACTION` | `MAINTENANCE_SATISFACTION_COLUMN` |
| `RESIDENT FEEDBACK` | `MAINTENANCE_FEEDBACK_COLUMN` |

App `MaintenanceTicket` fields:

| App field | Reads from sheet column |
| --- | --- |
| `id` | `TICKET ID` |
| `residentEmail` | `RESIDENT EMAIL` |
| `residentName` | `RESIDENT NAME` |
| `branch` | `BRANCH` |
| `location` | `LOCATION` |
| `device` | `DEVICE` |
| `issue` | `ISSUE DESCRIPTION` |
| `reportedAt` | `REPORTED AT` |
| `status` | `STATUS` |
| `mechanicEmail` | `MECHANIC EMAIL` |
| `solvedAt` | `SOLVED AT` |
| `repairTimeMinutes` | `REPAIR TIME MINUTES` |
| `satisfaction` | `RESIDENT SATISFACTION` |
| `feedback` | `RESIDENT FEEDBACK` |
| `row` | Entire mapped row |

## 6. Laundry Machine Config -> App Variables

These are not sheet columns. They are internal machine config variables in `api/src/google-sheets.ts`.

| App field | Example |
| --- | --- |
| `id` | `d2-washer`, `d7-washer-horizontal`, `d7-washer-paid`, `d7-dryer` |
| `calendarId` | Google Calendar ID for the machine |
| `label` | Human-readable machine label |
| `branchId` | `D2` or `D7` |
| `type` | `WASHER` or `DRYER` |
| `durationMinutes` | Machine duration |
| `coinPrice` | Coin price per use |
| `allowsFreeLaundry` | Free laundry eligibility |

## 7. Rent Calculator: Sheet Columns -> API Variables

Defined in `api/src/calculation-engine.ts`.

| Sheet column name | App variable |
| --- | --- |
| `Địa chỉ email` | `email` |
| `Cozoro Member` | `memberTier` |
| `Số tiền chia sẻ mỗi tháng` | `baseRentRaw` |
| `Thời hạn hợp đồng (tháng)` | `durationMonths` |
| `Bạn muốn thanh toán chi phí như thế nào?` | `paymentPlan` |
| `Ưu đãi tháng` | `monthlyAdjustmentVnd` |
| `Uu dai thang` | Fallback for `monthlyAdjustmentVnd` |
| `Khoản ưu đãi và chi phí tăng thêm` | Older fallback for `monthlyAdjustmentVnd` |
| `Khoản ưu đãi và chi phí tăng thêm nếu có` | Older fallback for `monthlyAdjustmentVnd` |
| `Chú thích` | Notes for `6+1` logic |
| `Phí ở đóng mỗi tháng` | Free-month marker |
| `Phí gởi xe` | Default `parkingFeeVnd` |
| `Biển số xe máy đăng ký gởi xe` | Parking fallback / motorbike detection |
| `Chi nhánh Cozoro dorm` | `branchId` for laundry allowance logic |

Rent breakdown fields returned by API:

| API field | Meaning |
| --- | --- |
| `baseRent` | Effective base rent |
| `tenureSurchargeRate` | Applied short-term surcharge rate |
| `tenureSurchargeVnd` | Short-term surcharge amount |
| `monthlyAdjustmentVnd` | Signed monthly adjustment from sheet |
| `professionalDiscountVnd` | Discount portion of monthly adjustment, kept for backward compatibility |
| `planDiscountVnd` | Extra plan-based discount |
| `managerDiscountVnd` | Manual manager-entered discount |
| `parkingFeeVnd` | Parking fee used in calculation |
| `laundryFeeVnd` | Laundry fee |
| `finesVnd` | Unpaid fines |
| `totalBeforeCoinsVnd` | Subtotal before coin usage |
| `recommendedCoinUsage` | Suggested coins to apply |
| `recommendedCoinValueVnd` | VND value of suggested coins |
| `finalTotalVnd` | Final total due |

## 8. Manager UI Variable Mapping

Manager UI state in `portal/components/manager-client.tsx`:

| UI variable | Meaning |
| --- | --- |
| `selectedClient.email` | Resident email from sheet |
| `selectedClient.maHd` | Contract code from `MÃ HD` |
| `selectedClient.name` | Name from `Tên` |
| `selectedClient.branch` | Branch from `Chi nhánh Cozoro dorm` |
| `selectedClient.bed` | Bed from `số giường` |
| `clientForm[field]` | Direct edit buffer for arbitrary client columns |
| `workspace.stats.coins` | Coin rows for selected client |
| `workspace.stats.payments` | Payment rows for selected client |
| `workspace.stats.fines` | Fine rows for selected client |
| `workspace.stats.laundry` | Laundry bookings for selected client |

Rent-specific manager UI variables:

| UI variable | Meaning |
| --- | --- |
| `targetMonthInput` | Requested rent month |
| `managerDiscountInput` | Manual manager discount |
| `shortTermSurchargeRateInput` | Manual surcharge override |
| `parkingFeeInput` | Manual parking override |
| `infoManagerDiscount` | Preview-card manager discount |
| `infoShortTermSurchargeRate` | Preview-card surcharge override |
| `infoParkingFee` | Preview-card parking override |
| `rentBreakdown` | Current full rent calculation result |
| `infoRentBreakdown` | Preview-card rent calculation result |

## 9. Header Alias Handling

Some columns are normalized with alias support in `google-sheets.ts`.

Current alias examples:

| Incoming header | Canonical app constant |
| --- | --- |
| `địa chỉ email` | `EMAIL_COLUMN` |
| `địa chỉ email hidden` | `HIDDEN_EMAIL_COLUMN` |
| `hiện còn ở` | `ACTIVE_STAYING_COLUMN` |
| `mã hd` | `CONTRACT_CODE_COLUMN` |
| `dấu thời gian` | `COINS_TIMESTAMP_COLUMN` |
| `coins` | `COINS_BALANCE_COLUMN` |
| `sự kiện` | `COINS_EVENT_COLUMN` |
| `người thao tác` | `COINS_OPERATOR_COLUMN` |
| `cozoro member` | `COINS_MEMBER_COLUMN` |
| `số coins hiện có` | `COINS_CURRENT_BALANCE_COLUMN` |
| `mã giao dịch` | `COINS_TRANSACTION_CODE_COLUMN` |

## 10. Important Notes

- `row: Record<string, string>` usually means the app is preserving the full mapped sheet row for display or editing.
- The rent calculator currently keeps `professionalDiscountVnd` as a backward-compatible API field name, even though the real source column is now `Ưu đãi tháng`.
- Some UI tables also read direct raw column names like `MỤC ĐÍCH`, `EMAIL`, `SỐ TIỀN`, and `NỘI DUNG VI PHẠM` from `entry.row`.

## 11. Cozoro Member Ranking Rule Mapping

This part is not a single sheet-column mapping, but it is an important rule mapping used by the app.

Inputs used by the member ranking calculator in `api/src/google-sheets.ts`:

| Rule input | App source |
| --- | --- |
| All-time accumulated coins | `Tổng Coins tích luỹ` |
| Recorded current tier | `Cozoro Member` |
| Previous month's earned coins | calculated from positive `COINS` entries in `COZORO COINS` for the previous calendar month |
| Current coin balance for paid upgrade | `Cozoro coins hiện có` |

Three separate upgrade conditions:

| Condition | Meaning |
| --- | --- |
| Accumulated coins condition | Lifetime accumulated coins must reach the target tier threshold |
| Previous month condition | Previous month's earned coins must reach the target tier maintenance requirement |
| Upgrade payment condition | Current coins must cover the target tier upgrade cost if that tier has a non-zero fee |

Important note:

- Upgrade payment is one-time when the member moves up into a tier with a fee.
- If the member is already at that rank, no additional upgrade coins are charged.
- If the member loses that tier and later upgrades back to it, the upgrade payment is required again.

Example:

| Target tier | Required accumulated coins | Required previous-month earned coins | Required current coins for upgrade payment |
| --- | --- | --- | --- |
| Gold | 100,000 | 5,000 | 0 |
| Platinum | 150,000 | 10,000 | 0 |
| Diamond | 300,000 | 20,000 | 10,000 |
| Elite | 800,000 | 40,000 | 40,000 |
