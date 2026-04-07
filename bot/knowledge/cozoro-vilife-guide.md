# CozoroHome — Vietnamese Life Guide and App Knowledge

version: 2026-04-03
audience: customer-facing bot
purpose: help the bot understand how CozoroHome actually works for residents, answer common Vietnamese questions naturally, and recognize Vietnamese slang, abbreviations, and phrasing patterns

---

## Vietnamese Language Context for Dormitory Questions

### Common Abbreviations and Slangs the Bot Must Recognize

- **KTX** = ký túc xá = dormitory / dorm. When someone says "KTX Cozoro" they mean Cozoro dorm.
- **phòng trọ** = rented room. Cozoro is a step above a typical phòng trọ — more organized, with community services.
- **chỗ ở** = accommodation / place to stay
- **giường** = bed. Cozoro rents individual beds, not whole rooms.
- **tầng** = floor / tier. Also used for bed level: tầng trên/giữa/dưới = top/middle/bottom.
- **T / M / B** = Top / Middle / Bottom. Bed position codes used in pricing and contracts.
  - giường trên / tầng trên = upper bed (T)
  - giường giữa / tầng giữa = middle bed (M)
  - giường dưới / tầng dưới = lower bed (B)
  - Bottom beds are usually slightly more expensive due to convenience.
- **hợp đồng / HD** = contract. "Mã HD" = contract code.
- **cọc** = deposit. "tiền cọc" = deposit money.
- **tiền nhà / tiền phòng / tiền thuê** = rent. All three mean the same thing in casual Vietnamese.
- **điện nước** = electricity and water. In Cozoro the monthly fee already bundles điện nước.
- **wifi / mạng** = internet. Included in the Cozoro monthly bundle.
- **xe máy / xe đạp** = motorbike / bicycle. Parking for these is extra.
- **gửi xe** = park a vehicle. "phí gửi xe" = parking fee.
- **máy giặt** = washing machine. "máy sấy" = dryer.
- **đặt lịch** = schedule / book a slot. Used for laundry, cleaning shifts.
- **vệ sinh** = cleaning / hygiene. "lịch vệ sinh" = cleaning schedule / cleaning duty roster.
- **phiếu phạt / phạt** = fine ticket. "đóng phạt" = pay a fine.
- **coin** = Cozoro Coins. People say "coin" directly in Vietnamese, no translation needed.
- **thành viên / member** = member. "hạng thành viên" = member tier.
- **gói** = package. "gói 6 tháng" = 6-month package. "gói 30 / gói 70" = hold packages.
- **ưu đãi / khuyến mãi** = discount / promotion.
- **giới thiệu / giới thiệu bạn bè** = referral.
- **xem phòng** = view the room / take a tour.
- **cọc online** = pay deposit online. This can unlock an extra discount.
- **đặt cọc** = place a deposit.
- **thuê ngắn hạn / ở ngắn hạn** = short-term stay.
- **thuê dài hạn / ở dài hạn** = long-term stay (typically 6+ months at Cozoro).
- **theo ngày / ở theo ngày** = daily stay.
- **miễn phí / free** = free of charge. Both words are used interchangeably in Vietnamese chat.
- **bảo trì / sự cố** = maintenance / malfunction.
- **nhà bếp** = kitchen.
- **ban công** = balcony.
- **nhà vệ sinh / WC / toilet** = bathroom / restroom.
- **máy lạnh / điều hòa** = air conditioner.
- **tủ đồ / locker** = personal locker.
- **kệ giày** = shoe rack.
- **đồng hồ nước / điện** = water/electricity meter.
- **hàng xóm** = neighbor / neighbors in the same dorm.
- **ẩn danh** = anonymous.
- **phòng học / góc học tập** = study room / study corner.
- **gym / phòng gym** = gym room.
- **hồ bơi / bể bơi** = swimming pool.
- **sân thượng** = rooftop.
- **nội quy** = house rules / dorm rules.

### Common Question Patterns in Vietnamese

- "bên mình có..." or "bên cozoro có..." = "does Cozoro have..."
- "cho mình hỏi..." = "I want to ask..." — standard polite opener
- "hiện còn chỗ không?" / "còn giường không?" = "are there any available beds?"
- "giá bao nhiêu?" / "giá thế nào?" / "tầm bao nhiêu một tháng?" = "how much per month?"
- "gồm những gì?" / "bao gồm gì?" = "what's included?"
- "có thể ở thử không?" / "ở thử được không?" = "can I try a short-term stay?"
- "khi nào dọn vào được?" = "when can I move in?"
- "cần chuẩn bị gì?" = "what do I need to prepare?"
- "có ưu đãi gì không?" = "are there any promotions?"
- "nếu tôi muốn dời đi sớm thì sao?" = "what if I want to leave early?"
- "có phụ thu gì không?" = "are there any extra charges?"
- "điện nước tính riêng không?" = "are utilities charged separately?"
- "có chỗ để xe không?" = "is there parking?"
- "an ninh thế nào?" / "có camera không?" = "what's the security like?"
- "phòng riêng hay phòng chung?" = "private room or shared room?" — answer: Cozoro is shared dorm-style, each person has their own bed and personal area.
- "có bao nhiêu người một phòng?" = "how many people per room?"
- "tôi là sinh viên, có giảm không?" = "I'm a student, is there a discount?"
- "tôi làm y tế / bác sĩ / dược..." = working in medical field — eligible for professional discount
- "mình cần đặt cọc bao nhiêu?" = "how much deposit do I need?"
- "cọc có hoàn lại không?" = "is the deposit refundable?"
- "có thể ở theo ngày không?" = "can I stay by the day?"
- "có gym không?" = "is there a gym?"
- "máy giặt có tính tiền không?" = "does laundry cost extra?"
- "có sấy quần áo không?" = "is there a dryer?"
- "lịch giặt như thế nào?" = "how does laundry scheduling work?"
- "tôi cần báo hỏng cái gì thì làm sao?" = "how do I report something broken?"
- "coin dùng để làm gì?" = "what are coins used for?"
- "làm sao lên hạng thành viên?" = "how do I get a higher member tier?"
- "bếp dùng chung không?" = "is the kitchen shared?"
- "có tủ đồ riêng không?" = "do I get a personal locker?"
- "phòng có điều hòa không?" = "is there air conditioning?"
- "có thể mang khách về không?" = "can I bring guests?"
- "có điểm chung với ký túc xá đại học không?" = "is it like a university dorm?"

---

## What CozoroHome Is

- CozoroHome is a co-living dormitory service in Ho Chi Minh City, currently operating at two branches: Dorm 2 (D2) in District 6 and Dorm 7 (D7) in District 10.
- Unlike typical rented rooms (phòng trọ), Cozoro is managed more systematically — with online booking, a resident portal app, scheduled laundry, cleaning duties, member rewards, and community tools.
- Cozoro targets students, medical workers, and young professionals who want a convenient, clean, community-focused place to live at a competitive cost.
- The model is shared-bed dormitory style: each resident has their own bed, personal locker, study desk, bookshelf, and personal storage area. Kitchen, bathroom, living, and laundry areas are shared.
- The monthly fee generally bundles electricity, water, wifi, shared-area management, and drinking water. Parking is extra.
- Cozoro is deliberately positioned as a KTX that is cleaner, smarter, and more organized than the average — with technology-driven features like laundry booking, smart AC control, a digital member program, and in-app support.
- Residents are called "Cozoronians" internally.

---

## Branch Summary for Quick Answers

### D2 — Dorm 2 (District 6)
- Address: 491 Hậu Giang, Phường 11, Quận 6 (Him Lam Cho Lon complex)
- Total beds: 21 (3 rooms)
- Targets: students, young workers, people who want wide rooms and good facilities
- Highlights: wide rooms, desk at every bed, large shared table per room, gym, internal swimming pool, night city view, balcony drying racks
- Note: Dorm 2 snapshot is older (2024). Pricing and some facilities should be confirmed with staff.
- Approximate monthly price range: 1.76M–1.98M VND (adjusted from older ad data +10%)

### D7 — Dorm 7 (District 10)
- Address: 7A/19/28 Thành Thái, Phường Điền Hồng (cũ: Phường 14), Quận 10
- Total beds: 63 (6 rooms across 3 floors)
- Targets: medical students, healthcare workers, university students, busy office workers
- Nearby: Đại học Y Dược HCM (~1km), Pham Ngoc Thach University (~450m), HCMUT (~500m)
- Nearby access streets: Đường 3/2, Lý Thường Kiệt, Tô Hiến Thành, Thành Thái
- Nearby food/shops: Ministop, Bách Hóa Xanh, Vinmart, hẻm 606 và 666 đường 3/2
- Highlights: free gym, rooftop chill space, quiet study room, smart laundry booking, fingerprint double-lock doors, camera security, robot vacuum twice daily, staff cleaning twice a week
- Approximate monthly listed price: 1.87M–1.98M VND (upper/middle/lower bed, adjusted)
- Effective average with 6-month package: can be around 1.4M–1.5M VND/month

---

## Resident Portal and App Features

Cozoro has a web portal at app.cozorohome.com that residents use for:

### Login
- Residents log in with their registered email.
- Default first password = phone number on file.
- Can also log in via Google account tied to the registered email.
- On first login, residents are prompted to change their password.

### Dashboard (Trang chủ)
- Shows: current Cozoro Coins balance, upcoming laundry booking, next cleaning duty, unpaid fine tickets, basic account info (name, branch, bed number, contract code).

### Laundry Booking (Đặt lịch giặt sấy)
- Residents book a time slot for the washing machine or dryer in advance.
- Avoids waiting in line — you know when your machine is free.
- System notifies residents when their slot is coming up.
- Free quota per month: males 6 uses, females 8 uses.
- Extra use beyond the quota: approximately 15,000 VND/use (or can use Cozoro Coins).
- Payment methods: free laundry quota, Cozoro Coins, or cash.

### Cleaning Schedule (Lịch vệ sinh)
- Residents are assigned kitchen cleaning duties on a rotation.
- Residents can self-assign shifts on open slots via the portal.
- Cleaning types: Kitchen D2, Kitchen D7, Trash D7.
- Kitchen D7 must be completed between 17:00 and 23:00 on the assigned day.
- Other types: can be completed any time on the assigned day.
- Releasing a shift: fines apply if released late (same day = 75%, 1-4 days before = 50%, 5+ days = no fine).
- Completing cleaning earns coins (3,000–6,000 depending on tier).
- Taking over someone else's unfinished shift is allowed after 20:00 on the day (called "take over").

### Controller (Điều khiển)
- D2 residents can control the shared microwave via the app (IFTTT-based trigger, with pre-use inspection).
- D7 residents can control room air conditioning from the app.
- AC default temperature: 23–25°C. Residents can adjust within the allowed range.

### Messages and Support (Tin nhắn)
- Residents can message Cozoro staff directly for personal support (private chat).
- Group chats exist for: room-level, floor-level, and branch-level.
- Can send anonymously or as "Cozoro" identity in group chats.
- Maintenance reports can also be submitted from the Messages tab — earns 2,000 coins per report.

### Maintenance Report (Báo cáo bảo trì)
- Submit a ticket for any broken equipment or facility issue.
- Fields: location (my room, kitchen, laundry area, bathroom, other), device (optional), description.
- Submitting a ticket earns 2,000 coins.
- A mechanic is assigned and the resident sees the status: Reported → Assigned → Solved → Closed.
- Residents can rate satisfaction after resolution.

### Billing Center (Thanh toán & Tiền phạt)
- View rent payment history.
- See current month's breakdown: base rent, parking, laundry fee, fines, coin usage.
- View unpaid fine tickets.
- See laundry fee entries.

### Coins Page (Cozoro Coins)
- View current balance, this-month earned, last-month earned, total lifetime coins.
- View coin transaction history by category and by month.
- See current member tier (Silver / Gold / Platinum / Diamond / Elite).

### Cozoro Member Ranking
- Tier order: Silver -> Gold -> Platinum -> Diamond -> Elite.
- Thresholds by accumulated coins:
  - Gold: 100,000
  - Platinum: 150,000
  - Diamond: 300,000
  - Elite: 800,000
- Maintenance by previous month's earned coins:
  - Silver: 0
  - Gold: 5,000
  - Platinum: 10,000
  - Diamond: 20,000
  - Elite: 40,000
- Upgrade cost after losing a tier:
  - Gold: free
  - Platinum: free
  - Diamond: 10,000 coins
  - Elite: 40,000 coins
- This upgrade cost is one-time only when moving back up into that tier after losing it.
- If the member is already holding that tier, they do not pay again.
- Upgrade eligibility requires all of:
  - enough accumulated lifetime coins for the target tier
  - enough previous-month earned coins for the target tier
  - enough current coins to pay the upgrade cost when that tier has one
- Important clarification:
  - `Number of coins needed to level up` means `all-time accumulated coins`
  - `Previous month's earned coins` is a separate condition
  - `Upgrade cost` is a separate payment condition when required
  - `Upgrade cost` is not a monthly fee for keeping a tier
- Example for Diamond:
  - accumulated coins >= 300,000
  - previous month's earned coins >= 20,000
  - current coins >= 10,000 for the upgrade payment

### Account Overview (Tổng quan tài khoản)
- Shows full profile: name, branch, bed, floor, room, phone, email, contract code, member tier, paid-through date.
- Contract status: shows days remaining on contract and warns when expiry is approaching.
- Can extend contract from this page.
- About section: dorm history, founding story.

---

## Payment and Billing

### What Is Included in Monthly Fee
- Base rent (based on branch, bed position, contract duration)
- Common/shared building fee
- Electricity (điện)
- Water (nước)
- Internet/wifi (mạng)
- Drinking water (nước uống)

### What Is NOT Included
- Parking fee (phí gửi xe): typically 200,000 VND/month for motorbike, 100,000 VND/month for bicycle
- Damage caused by the resident
- Laundry fees beyond the free monthly quota

### Short-Duration Surcharge
- 1–3 months: +12% on base price
- 4–5 months: +8% on base price
- 6 months and above: standard rate (no surcharge)

### Monthly Adjustment
- Monthly adjustment is handled from the staff-managed monthly adjustment field for each resident.
- It may work as a discount or as a surcharge depending on the recorded value.

### Payment Due Date
- Monthly payment due on the 1st of each month.
- Cash collection typically attempted once before the 5th.
- Prepaid plan is available (pay multiple months in advance).

### Coin-Based Rent Support
- Can use coins to reduce rent by up to 10% of each monthly bill.
- Coin exchange rate for rent depends on member tier: Silver 60%, Gold 70%, Platinum 80%, Diamond 90%, Elite 100%.
- Must have 100,000+ coins to use the conversion.

### Fine Tickets (Tiền phạt)
- Fines can be issued for rule violations, missed cleaning duties, or evasion.
- Can be paid in VND or by coins:
  - Silver to Gold: around 1.5x the fine VND value in coins
  - Platinum and above: around 1.8x–2x the fine VND value in coins
- Cleaning evasion penalty: 100,000 VND for repeatedly avoiding scheduled duties.

---

## Move-In Process

- A deposit is required before moving in.
- Cozoro may request a bed viewing before the contract is signed.
- Online deposit (cọc online) may reduce the first month's cost by 200,000 VND.
- Viewing with a parent/guardian may also earn an extra reduction.
- After signing, residents receive login credentials for the portal.
- Default portal password = phone number on file. Must be changed on first login.
- Personal area: resident gets their bed, locker, desk, bookshelf, storage.
- Residents should register their member usage via the Cozoro website after moving in.

---

## Guest and Visitor Policy

- Guests must be notified to management and a guest ID must be submitted.
- Guests should only be received at the ground floor (lobby area).
- Overnight guests are generally not allowed without prior approval.
- If a guest violates rules, fines may apply.

---

## Checkout and Termination

### Early Termination
- Contract duration cannot be shortened once signed.
- Improper early termination: resident may lose deposit and prepaid stay cost.
- Contract transfer to another person is allowed in some cases (replacement must qualify and join quickly).

### Checkout Steps (on the portal)
- When contract ends: residents complete a checkout checklist (luggage removed, bedding returned, keys handed back, photo notes).
- Manager records the termination with a deposit note.

### Bed-Hold Packages
For residents absent more than 30 days (must give 7+ days advance notice):
- **Gói 30**: keep your bed and personal area → reduce stay fee up to 30%
- **Gói 70**: hand back bed/equipment, keep up to 1 suitcase at dorm → reduce stay fee up to 70%
- Hold period must be in multiples of 30 days.
- Hold period must not exceed 50% of remaining contract duration.

---

## House Rules Summary (Common to Both Branches)

- Laundry must be scheduled — do not use machines without booking.
- Dirty laundry should be kept in the laundry shelf, not in the bedroom.
- Kitchen must be cleaned immediately after use.
- Refrigerator: label food with name/bed number. Cleaned monthly.
- Trash must be bagged, tied, and sorted correctly.
- Do not leave belongings on the floor.
- No shoes inside — use the shoe rack at the entry.
- Air conditioning default: 23–25°C.
- No eating or strong-smell food in the bedroom.
- Use bunk beds gently (no shaking).
- Guest notice and ID process applies for all visitors.
- Rule violations may result in fines.

---

## Referral and Discount Stacking

When someone asks "làm sao được giảm giá nhất":
- 6-month package: free 7th month
- 3-month package: reduce 500,000 VND
- Referral from an active Cozoro resident: 2,000,000 VND discount for the new resident
- Online deposit (cọc online): extra 200,000 VND off
- Viewing with parent/guardian: extra 200,000 VND off
- Writing a review/post about Cozoro: 200,000 VND off
- Student (sinh viên): possible 10% base rate discount
- Medical worker: possible 10% base rate discount
- Female resident (nữ): may have additional priority or promotional discount at D7 — confirm with staff
- Seasonal promotions (Tết, 8/3, new year campaigns) may stack additional offers

---

## Cozoro Identity and Brand Context

- Cozoro positions itself as a "smart KTX" — cleaner, better managed, and more community-oriented than typical Vietnamese dormitories.
- The brand uses "Cozoronian" to refer to residents, creating a community identity.
- The core pitch: at roughly 1.4M–1.5M/month effective (with packages), residents get electricity, water, wifi, laundry access, kitchen, gym, and a clean co-living experience — more value per dong than an isolated phòng trọ.
- The portal/app is the main resident experience touchpoint: laundry, cleaning, support, payments, coins, community all in one place.
- The bot represents Cozoro's customer-facing voice and should be warm, helpful, and sales-friendly without overpromising exact prices or discounts not confirmed.

---

## Answering Guidance Notes

- If someone asks about current available beds: use the live vacancy API (the bot has access to this).
- If someone asks about referral eligibility: use the server-side referral check (the bot has access to this).
- If someone asks about exact personal account data (balance, fines, bookings): say staff must confirm — never expose personal data.
- If someone says "tôi đang ở Cozoro rồi" (I'm already a resident): the bot can still help with general policy, but for account-specific questions they should use the portal or contact staff directly.
- If someone says slang like "KTX", "dorm", "chỗ ở", "phòng chung" — understand these all refer to Cozoro's co-living dorm service.
- Speak naturally in Vietnamese when the customer writes in Vietnamese. Use common conversational phrasing — "dạ", "bên mình", "quý khách" are all acceptable.
- Short, warm replies are better than long formal answers for simple questions.
