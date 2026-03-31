# Cozoro Knowledge

version: 2026-03-29
audience: prospective clients only
purpose: answer questions about Cozoro dorm services, policies, benefits, availability, and referral eligibility without exposing any current client identity or account data

## Safety Rules

- This knowledge base is for prospective-client conversations only.
- Do not disclose the identity, room, bed, phone number, email, or personal details of any current or former client.
- Do not answer any question about a current client account, current client balance, current client fines, or current client bookings.
- If a question depends on a signed individual contract, live invoice, live promotion decision, or a manual management exception, say staff should confirm the final answer.
- Live bed availability may be used, but only as anonymous vacancy data.
- Referral validation must return only whether the prospect is eligible or not eligible. Never reveal which client matched.

## Live Data Rules

- Use this knowledge file for policy and general answering.
- Use live vacancy data from the app for current available beds.
- Use a private server-side referral eligibility check for referral discount validation.
- Never retrieve or expose current client names, phones, emails, coins, payments, fines, or room assignments for chatbot answers.

## Product Overview

- Cozoro Home provides dorm-style shared living.
- The bot should help prospective clients with:
  - branch and room layout
  - current available beds
  - contract policy summary
  - cleaning task and dorm rule summary
  - laundry usage and pricing summary
  - Cozoro Coins and Cozoro Member benefits
  - referral discount eligibility

## Branch Layout

### D2

- Total beds: 21
- Room 1: beds 1-9
- Room 2: beds 10-15
- Room 3: beds 16-21

### D7

- Total beds: 63
- Floor 1:
  - Room 1.1: beds 1-9
  - Room 1.2: beds 10-15
  - Room 1.3: beds 16-24
- Floor 2:
  - Room 2.1: beds 25-33
  - Room 2.2: beds 34-39
  - Room 2.3: beds 40-48
- Floor 3:
  - Room 3.1: beds 49-57
  - Room 3.2: beds 58-63

## Contract Policy Summary

source_type: summarized from the current contract template
source_note: use as policy guidance, not as a substitute for a signed contract

- Contract price may increase based on short duration:
  - 4 to 5 months: +8%
  - 1 to 3 months: +12%
- Monthly payment is generally due on the 1st of the month.
- Cash collection is generally attempted only once before the 5th of the month.
- Price includes electricity, water, internet, and apartment/shared building costs.
- Price does not include parking or damages caused by the resident.
- Deposit is required.

### Early termination and cancellation

- Benefits and discounts tied to the stay may lose effect if the resident ends the contract early.
- If a resident ends the contract early against contract terms, they may lose the deposit and prepaid stay cost already paid.
- The contract says the duration cannot be shortened.
- The contract allows contract transfer to another person in some cases if the replacement person qualifies and joins quickly after the original resident leaves.
- If Cozoro ends the contract early without client breach, notice and refund rules apply under the contract.

### Contract changes

- Bed change fee: 50,000 VND
- Dorm address change fee: 100,000 VND
- Contract duration change fee: 500,000 VND
- Contract duration changes are limited and shortens are not allowed under the current template

### Bed-hold and temporary absence policy

- If a resident will be away for more than 30 continuous days and gives advance notice:
  - hold package 30: up to 20% reduction when belongings remain at the bed and personal area
  - hold package 70: up to 60% reduction when the bed/equipment are handed back for reuse and storage is limited
- Hold periods should be multiples of 30 days.
- Hold periods should not exceed 50% of the remaining contract duration.

## Cozoro Coins

source_type: public page plus current web app rules

- Cozoro Coins are a loyalty and reward program.
- Coins can be earned from long stays, referrals, reviews, support contributions, and approved community activities.
- Coins can be used for selected Cozoro services and certain internal bill support.

## Cozoro Member Tiers

- Silver:
  - exchange support rate: 60%
  - free laundry: no extra free laundry uses
  - monthly maintain coins: 5,000
- Gold:
  - threshold: 100,000 accumulated coins
  - exchange support rate: 70%
  - free laundry: 01 wash + 01 dry / month
  - monthly maintain coins: 10,000
- Platinum:
  - threshold: 150,000 accumulated coins
  - exchange support rate: 80%
  - free laundry: 01 wash + 02 dry / month
  - monthly maintain coins: 20,000
- Diamond:
  - threshold: 300,000 accumulated coins
  - exchange support rate: 90%
  - free laundry: 03 wash + 03 dry / month
  - monthly maintain coins: 40,000
- Elite:
  - threshold: 800,000 accumulated coins and above
  - exchange support rate: 100%
  - free laundry: 03 wash + 03 dry / month
  - monthly maintain coins: 40,000+

## Common Coin Rewards

- 3-month contract: 10,000 coins
- 6-month contract: 25,000 coins
- 12-month contract: 50,000 coins
- Continuous stay 6 months: 30,000 coins
- Continuous stay 12 months: 20,000 coins
- Bring a guest to view: 10,000 coins
- Bring a guest to sign a contract: 100,000 coins
- Report broken equipment or policy violations: 2,000 coins
- Cleaning duty completed well: usually 3,000 to 6,000 coins depending on membership tier
- Extra cleaning duty: usually 3,000 to 6,000 coins depending on membership tier
- Monthly dorm review: usually 5,000 to 6,000 coins depending on membership tier
- Refer a friend for a 6-month contract: 500,000 coins

## Common Coin Usage Rules

- Laundry can be paid by Cozoro Coins in some cases.
- Historical coin values previously referenced:
  - Laundry wash: 7,000 coins
  - Laundry dry: 7,000 coins
- New update from user:
  - for laundry beyond the free monthly quota, the practical out-of-pocket reference is 15,000 VND per use
  - coins can also be used for laundry in some cases
- VND payment support for rent or parking: up to 10% of each bill
- 100,000+ coins may be converted into VND support based on member exchange rate
- Fine payment by coins:
  - standard to gold style: around 1.5x bill value in coins
  - platinum and above: around 2x bill value in coins

## Coins FAQ Summary

- Membership ranking is reviewed monthly.
- A resident may be downgraded if they do not meet the monthly maintenance requirement for their tier.
- If someone is downgraded, they may need to earn enough coins again in a later month to go back up.
- If a contract expires and is not renewed in time, the accumulated coins may be lost.
- Coins cannot be exchanged into direct cash payout.
- Coins cannot currently be gifted or transferred to another person.
- Using coins for laundry does not erase historical accumulated coins used for rank evaluation.
- A negative coin balance may be converted at 1 coin = 2 VND for collection.

## Laundry Rules

source_type: combined (branch snapshot + user update)

- Free monthly laundry quota:
  - male residents: 6 uses/month
  - female residents: 8 uses/month
- If the free quota is exceeded:
  - new user update: 15,000 VND per use (laundry)
  - payment can also be done by Cozoro Coins in some cases
- Note:
  - older app-based pricing references (like 7,000) should not be quoted as the current cash price
  - when a prospect asks for the exact current rule for a specific branch, staff confirmation is safest

## Cleaning Task Rules

source_type: current app configuration

- Kitchen D7 completion window: 17:00 to 23:00 on the assigned date
- Other listed cleaning task types may generally be completed any time on the assigned date
- Releasing a task on the same day may cause a 75% fine
- Releasing a task 1 to 4 days ahead may cause a 50% fine
- Releasing a task 5 or more days ahead usually has no fine
- Self-assigned tasks released 5 or more days ahead may be treated more leniently and may not count against the monthly release limit

## Sales And Promotion Knowledge

source_type: user-provided ad copy plus approved website copy
usage_rule: use for prospect-facing marketing answers, but confirm final active offer, exact bed position, and exact net price with staff when needed

### Pricing Handling Rules

- Some older ad prices are outdated.
- The user stated that D7 and D2 price references in older materials should now be treated as approximately 10% higher.
- Treat any exact monthly price from older ad copy as historical marketing context, not a final quote.
- If a prospect asks for the latest exact price, the bot should:
  - explain that prices vary by branch, bed position, duration, and discount eligibility
  - give only approximate guidance when supported
  - encourage staff confirmation for the final payable amount
- Promotions and campaign gifts may change by month and should be confirmed before promising them as final.
- New update from user:
  - Current reference listed prices are about +10% compared with the older table values.
  - Real net monthly payment can be much lower when the prospect qualifies for discounts or pays by package.
  - Net monthly may be as low as around 1,200,000 VND/month plus parking fee in optimal cases, or around 1,400,000 VND/month when paying by package, but the bot must never promise this as guaranteed.
- Always-available discount baseline to mention when asked:
  - 6-month package: free 7th month
  - 3-month package: discount 500,000 VND
  - other discounts may apply (student, healthcare worker, and time-limited campaigns)
- Short-term stay pricing notes (new update from user):
  - If staying under 6 months, a surcharge may apply:
    - 1 to 2 months: +12% on base price
    - 3 to 5 months: +8% on base price
  - Daily stay reference:
    - 100,000 VND/day (staff should confirm any minimum-day and deposit/ID requirements)

### Laundry Convenience Selling Points

- A key Cozoro selling point is avoiding laundry waiting time.
- The website and ad copy describe a smart laundry booking experience.
- Core marketing points:
  - book laundry in advance
  - avoid waiting in line for an empty machine
  - receive timing guidance by system notification or email
  - use dryer support to avoid weather-related drying problems
  - use Cozoro Coins for laundry in some cases
- Strong prospect-friendly phrasing is allowed for this topic, such as:
  - no need to wait around for a machine
  - easier for busy students and working residents
  - more convenient during rainy season
- The bot should not promise technical features beyond what is already documented in the app and website.

### New Resident Laundry Promotion

- One ad campaign states:
  - new residents closing a room in that campaign period receive 04 free dryer uses
- This should be treated as campaign-based, not permanently guaranteed.
- If asked whether it is still active, staff confirmation is required.

### D7 Branch Sales Summary

branch_id: D7
area: District 10
address: 7A/19/28 Thanh Thai, Ward 14, District 10
target_segments:
  - medical students
  - healthcare workers
  - office workers
  - busy residents who value bundled utilities and laundry convenience

- D7 marketing emphasizes:
  - central location near universities and hospitals
  - privacy with curtain-covered beds and personal study lighting
  - all-in-one utilities
  - modern laundry and drying support
  - secure fingerprint and camera access
  - quiet, civilized resident community
- Nearby access points mentioned in marketing copy:
  - 3/2 Street
  - Ly Thuong Kiet
  - To Hien Thanh
  - Thanh Thai
- Nearby institutions and destinations mentioned in marketing copy:
  - University of Medicine and Pharmacy
  - Pham Ngoc Thach area
  - Bach Khoa area
  - convenience stores and local food areas

### D7 Branch Facilities Summary

- Private locker for each resident
- Separate kitchen area with:
  - gas stove
  - induction stove
  - microwave
  - oven
  - shared pots and pans
- Laundry and drying equipment
- Strong air conditioning
- Individual bed area with:
  - personal bed
  - storage
  - desk
  - bookshelf
- Rooftop or chill space
- Study space
- Free gym room mentioned in ad copy
- Flexible access hours
- Double-layer fingerprint door security
- Camera security

### D7 Pricing Guidance

pricing_status: historical ad pricing is outdated
inference_note: the user instructed that older D7 pricing should now be treated as 10% higher than the old ad references

- Older ad references mentioned:
  - promotional range around 1.3M to 1.4M VND/month
  - listed full-price range around 1.7M to 1.8M VND/month
- Based on the user's update, the bot may describe the current expectation as approximately:
  - old promotional range +10%: about 1.43M to 1.54M VND/month
  - old listed range +10%: about 1.87M to 1.98M VND/month
- These numbers are approximate guidance only.
- D7 marketing also mentions:
  - utilities bundled in price
  - parking usually separate
  - additional discount may still be available depending on campaign or eligibility

### D7 Discounts And Campaigns

- One ad states stacked discount logic may apply based on:
  - female priority
  - medical field or student status
  - quick decision behavior such as online deposit or viewing with parent
- One ad states:
  - payment for 3 months: reduce 500,000 VND
  - payment for 6 months: add 1 extra month
- One New Year campaign message states:
  - first month from around 1.4xx.000 VND
- These should all be treated as campaign-sensitive and subject to confirmation.

### D2 Branch Sales Summary

branch_id: D2
area: District 6
address: 491 Hau Giang, Ward 11, District 6
target_segments:
  - students
  - young workers
  - residents who want large rooms and bundled utilities

- D2 marketing emphasizes:
  - wide rooms
  - a work desk at each bed
  - an additional large table in each room
  - airy window-side layout
  - move-in-ready furniture and appliances
  - free swimming option at another Cozoro branch
  - gym access

### D2 Branch Facilities Summary

- Bed width around 1 meter
- Mattress, blanket, pillow, study lamp, study desk, bookshelf
- Large private locker for hanging clothes and storing personal items
- Separate kitchen with:
  - gas stove
  - induction stove
  - microwave
  - cooking tools
  - dishes
  - direct drinking water filtration
- Washing machines
- Smart drying rack or balcony drying space
- Strong air conditioning
- Night city view from higher floors
- Gym access
- Internal swimming pool with note:
  - ad copy says D2 internal pool may have a fee
  - Cozoro may allow free swimming at Dorm 1 instead

### D2 Pricing Guidance

pricing_status: historical ad pricing is outdated
inference_note: the user instructed that older D2 pricing should now be treated as 10% higher than the old ad references

- Older ad references mentioned:
  - around 1.6M to 1.8M VND/month including utilities
- Based on the user's update, the bot may describe the current expectation as approximately:
  - about 1.76M to 1.98M VND/month
- These numbers are approximate guidance only and may vary by bed position, duration, and promotions.

### New Year Campaign Messaging

- A New Year 2026 campaign message emphasizes:
  - move-in ready setup
  - full furniture and shared facilities
  - smart device support
  - camera security
  - community environment
  - convenient location
- The campaign also mentions a first-month promotional entry price around 1.4xx.000 VND.
- This should be treated as seasonal marketing, not a permanent guaranteed price.

### Price Quote Response Rules

- If the prospect asks "how much is it?":
  - mention approximate range only when supported by this knowledge
  - explain that exact price depends on branch, bed level, contract duration, and current promotion
  - mention that some old ads are outdated and current prices were increased by around 10%
  - invite the prospect to provide preferred branch and move-in timing for a more accurate quote
- If the prospect asks for best possible discount:
  - mention referral discount separately if eligible
  - mention campaign and duration discounts may exist
  - do not promise a discount that is not explicitly confirmed
- If the prospect asks whether utilities are included:
  - answer that the advertised bundled prices generally include electricity, water, wifi, management, and drinking water when stated in ad copy
  - mention parking may still be separate

## Branch Snapshot Data

source_type: user-provided branch update table
usage_rule: when a branch snapshot has a specific update date, prefer it over older generic ad copy for that branch

### Dorm 7 Snapshot

snapshot_date: 2025-09-04
branch_id: D7
branch_name: Dorm 7
address_note: Ho Chi Minh City administrative names may have changed; older and newer naming may both appear in source materials
address:
  - Alley 7A/19, Thanh Thai Street, Dien Hong Ward, Ho Chi Minh City
  - older wording in source: Ward 14, District 10

#### Dorm 7 Access And Nearby Schools

- University of Medicine and Pharmacy HCMC: around 1 km
- Pham Ngoc Thach University of Medicine: around 450 m
- HCMC University of Technology: around 500 m
- Source also mentions proximity to:
  - UMP
  - PNTU
  - HCMUT
  - HUFLIT
  - HSU
- The alley connects to:
  - 3/2 Street
  - Ly Thuong Kiet Street
  - To Hien Thanh Street
  - Thanh Thai Street

#### Dorm 7 Listed Bed Prices

- Listed monthly price:
  - upper bed: 1,700,000 VND/month
  - middle bed: 1,800,000 VND/month
  - lower bed: 1,800,000 VND/month
- The source says this listed price includes:
  - electricity
  - water
  - wifi
- The source says this listed price does not include parking.

#### Dorm 7 Parking

- Parking fee: 200,000 VND/month
- A separate house-rule line also mentions external gate parking at 5,000 VND/hour.
- Best interpretation:
  - monthly in-dorm or arranged parking: 200,000 VND/month
  - short-term gate parking reference may apply in some cases
- If a prospect asks the exact parking method or current rate, staff should confirm.

#### Dorm 7 Free Laundry And Dryer Uses

- Free laundry/dryer quota per month:
  - male residents: 6 uses/month
  - female residents: 8 uses/month
- If free uses are exhausted:
  - the source says extra use may be purchased at 15,000 VND/use
  - the source also says dryer use is 15,000 VND/use under house rules
- This is different from some older app-based coin pricing references.
- Best response rule:
  - explain that the branch policy snapshot mentions free monthly laundry quota and extra paid use
  - if asked which rule is currently active in the system, staff confirmation may still be needed

#### Dorm 7 Facilities Snapshot

- Private locker for each resident
- Kitchen equipment:
  - gas stove
  - induction stove
  - microwave
  - oven
  - blender
  - pots
  - pans
  - bowls and plates
  - water purifier
  - large shared refrigerator with monthly cleaning
  - dining table
- Cleaning support:
  - robot vacuum twice a day
  - staff cleaning twice a week
- Laundry area:
  - washing machines
  - dryers
  - balcony drying area
  - smart laundry booking system
  - ironing area
  - dry iron
  - standing steam iron by Bluestone
- Smart air conditioning managed by software
- Personal sleeping and study area:
  - private bed
  - bookshelf
  - study desk
  - personal storage
- Quiet study room
- Free gym room
- Rooftop chill area
- Free access hours
- Double fingerprint access
- Security cameras
- Nearby convenience:
  - Ministop
  - Bach Hoa Xanh
  - Vinmart
  - eateries near alleys 606 and 666 on 3/2 Street

#### Dorm 7 Package Promotions

- 6-month package:
  - free 7th month
- 3-month package:
  - discount 500,000 VND
- The source says the average effective monthly price may come down to around 1,400,000 to 1,500,000 VND/month depending on package.
- This effective average should be treated as package-dependent, not as the standard listed price.

#### Dorm 7 House Rules Snapshot

- Laundry and dryer should be booked by schedule to avoid conflicts.
- Dirty laundry should be kept in the laundry-area shelf, not left in the bedroom.
- Kitchen must be cleaned immediately after use.
- Refrigerator is defrosted and cleaned monthly.
- Food should be labeled with name or bed number.
- Trash must be bagged, tied, and sorted correctly.
- Residents should follow the cleaning schedule shown on the website.
- Do not leave belongings on the floor.
- Use bunk beds gently to avoid shaking.
- No shoes inside except balcony and bathroom areas.
- Shoes should be placed on the shoe rack at entry.
- Air-conditioner default temperature range: 23 to 25 C.
- No eating or bringing strong-smell items into the bedroom.
- Guest visits require notice to management and ID submission.
- Guests should only be received at the ground floor.
- Residents should register member usage via the Cozoro website.
- Personal items should stay within personal area.
- Rule violations may incur fees.
- Additional detailed rules may exist in the contract and on-site posted notices.

#### Dorm 7 Hold Policy Snapshot

- Applies when the resident will be absent for more than 30 days continuously and gives notice at least 7 days in advance.
- Package 30:
  - keep the bed and personal area
  - reduce stay fee by up to 30%
- Package 70:
  - hand the bed and equipment back for Cozoro use
  - may leave up to 1 suitcase at the dorm
  - reduce stay fee by up to 70%
- Hold period rules:
  - must be in multiples of 30 days
  - must not exceed 50% of the remaining contract duration

#### Dorm 7 Contract Snapshot

- Contract type: shared accommodation bed contract
- Included in fee:
  - common/shared building fee
  - electricity
  - water
  - internet
- Not included:
  - parking
  - damage caused by the resident
- Payment due date: day 01 each month
- Price increase by short contract duration:
  - 4 to 5 months: +8%
  - 1 to 3 months: +12%
- Contract change fees:
  - bed change: 50,000 VND
  - dorm address change: 100,000 VND
  - contract duration change: 500,000 VND within the first 15 days
- Contract duration cannot be shortened.
- Early improper termination may cause loss of deposit and previously paid fees.
- Deposit cannot be offset against monthly stay fee.
- Cozoro may require bed viewing for new prospects before contract end.

### Dorm 2 Snapshot

snapshot_date: 2024-01-05
branch_id: D2
branch_name: Dorm 2
address:
  - Him Lam Cho Lon apartment complex
  - 491 Hau Giang, Ward 11, District 6
data_staleness_note: this snapshot is much older than the Dorm 7 snapshot and may no longer reflect the latest operating details

#### Dorm 2 Listed Bed Prices

- Listed monthly price:
  - upper bed: 1,600,000 VND/month
  - middle bed: 1,700,000 VND/month
  - lower bed: 1,800,000 VND/month
- The source says this includes:
  - electricity
  - water
  - wifi
  - apartment/common-area fees
  - trash

#### Dorm 2 Parking

- The source table contains `1700000` in the parking column, which appears inconsistent and should not be quoted as a trusted parking fee.
- Another house-rule line mentions parking at the gate costs 5,000 VND/hour.
- Best response rule:
  - do not quote a fixed monthly parking fee for Dorm 2 from this source
  - ask staff to confirm the latest parking arrangement

#### Dorm 2 Free Laundry Uses

- Source says free laundry quota is 10 uses.
- A separate rule section also states:
  - male residents: 6 free uses/month
  - female residents: 8 free uses/month
- This source is internally inconsistent.
- Best response rule:
  - mention that Dorm 2 supports scheduled laundry
  - do not promise an exact free-use count without staff confirmation unless a newer operational source confirms it

#### Dorm 2 Facilities Snapshot

- Wide rooms
- Desk at each bed
- Large shared table in each room
- Private hanging locker for each resident
- Kitchen equipment:
  - gas stove
  - induction stove
  - microwave
  - rice cooker
  - pots
  - pans
  - bowls and plates
  - water purifier
  - blender
- Smart drying racks on two wide balconies
- High-power air conditioning
- Private bed area with:
  - bed
  - desk
  - bookshelf
  - storage
- Night city view
- Internal gym
- Internal swimming pool
- Nearby:
  - Citimart
  - Bach Hoa Xanh
  - Vinmart
  - Hau Giang food street
- Internal community features mentioned:
  - park
  - supermarket area
  - pharmacy
  - kindergarten

#### Dorm 2 Laundry And Dryer Notes

- One facility note says Dorm 2 does not have a clothes dryer like Dorm 7.
- Another rule block mentions both washing and drying scheduling and dryer fee.
- This is contradictory.
- Best response rule:
  - say Dorm 2 definitely has laundry support
  - say dryer availability at Dorm 2 needs confirmation unless a newer source updates it

#### Dorm 2 Package Promotions

- 6-month package:
  - free 7th month
- 3-month package:
  - discount 500,000 VND
- The source says the average effective monthly price may come down to around 1,400,000 to 1,500,000 VND/month depending on package.

#### Dorm 2 House Rules And Contract

- The source says Dorm 2 follows rules and contract structure similar to Dorm 7.
- Shared rules include:
  - scheduled laundry use
  - kitchen cleaning after use
  - refrigerator label and cleaning practice
  - trash sorting and internal cleaning schedule
  - no items on the floor
  - no shoes inside except allowed areas
  - AC default 23 to 25 C
  - no eating in the bedroom
  - guest notice and ID process
  - possible fines for rule violations
  - additional detailed rules in the contract and on-site notices
- Hold policy:
  - same as Dorm 7 according to the source
- Contract:
  - same as Dorm 7 according to the source

## Sales Q&A Playbook

source_type: user-provided live sales Q and A examples
usage_rule: use this section to answer prospect chat more naturally and briefly; when a Q and A conflicts with a newer dated branch snapshot or formal policy section, prefer the newer dated snapshot or formal policy

### Brand Positioning Answers

q: Cozoro có gì nổi bật
a:
  - Cozoro là KTX nhưng được vận hành sạch sẽ, khoa học và công nghệ hơn mặt bằng chung.
  - Điểm nổi bật nên nhấn mạnh:
    - khu giặt sấy và đặt lịch thông minh
    - bếp xịn và tiện nghi đầy đủ
    - gym miễn phí ở chi nhánh phù hợp
    - máy lạnh vệ sinh định kỳ và giữ nhiệt độ dễ chịu
    - chi phí sau khuyến mãi thường rất cạnh tranh
style_note:
  - answer in an upbeat, proud, sales-friendly way
  - avoid sounding defensive or comparing too aggressively with competitors

q: Em là sinh viên
a:
  - Có thể nhấn mạnh:
    - ưu đãi cho sinh viên
    - bàn học, không gian học tập
    - wifi ổn định
    - môi trường phù hợp cho học tập

q: khách hàng nữ
a:
  - Khách nữ có thể ở Dorm 2 hoặc Dorm 7.
  - Dorm 7 từng có ưu đãi thêm 200,000 VND cho khách nữ theo nguồn Q and A này.
warning:
  - treat female-only discount as campaign-sensitive unless another current source confirms it

### Discount And Pricing Answers

q: Tôi làm gì để được giảm giá, để được mức giá rẻ nhất ở Cozoro Home
a:
  - Mention common discount levers:
    - gói 6 tháng tặng 1 tháng
    - gói 3 tháng giảm 500,000 VND
    - viết bài chia sẻ nhận 200,000 VND
    - giới thiệu bạn ở nhận thưởng
    - cọc online hoặc đi xem cùng phụ huynh giảm thêm 200,000 VND
    - sinh viên hoặc nhân viên y tế có thể có ưu đãi thêm
    - Cozoro Coins hỗ trợ giảm chi phí ở hoặc chi phí khác
    - khuyến mãi theo dịp lễ, tết, 8/3 có thể xuất hiện
warning:
  - exact stacking and current availability must be confirmed if the prospect asks for final quote

q: Tôi chỉ ở thử ngắn hạn 1 hay 2 tháng thôi
a:
  - Short-term stay is possible.
  - Older Q and A says:
    - online deposit or viewing with parent may still reduce 200,000 VND
    - posting review may reduce another 200,000 VND
    - short-term surcharge may be 12%
    - estimated monthly outcome may be around 1.7M to 1.8M VND
  - Airbnb may also be an option.

q: tôi muốn đặt phòng theo ngày
a:
  - Updated by user: daily stay reference is 100,000 VND/day.
  - Older Q and A mentioned:
    - 120,000 VND/day and other conditions
  - Treat those older values as historical.
warning:
  - staff should confirm the current minimum-day requirement and deposit/ID requirements for daily stays

q: Bên mình hợp đồng có quy định ở tối thiểu mấy tháng k ạ
a:
  - The Q and A says there is no fixed minimum or maximum contract duration.
  - It also says daily stay may be possible and short stays have different fees from long-term fees.
  - For long-term reference, 6 months and above keep the standard long-term rate better.
warning:
  - if a prospect asks for the latest minimum-stay rule, confirm against current operational policy

q: Ít hơn 6 tháng giá thế nào ạ
a:
  - Updated by user:
    - 1 to 2 months: +12% short-term surcharge on base price
    - 3 to 5 months: +8% short-term surcharge on base price
  - Short-term stay is more flexible but usually costs more per month.

q: Giảm vô tiền nhà tháng đầu ạ
a:
  - One Q and A example says:
    - 6-month contract may reduce 500,000 VND
    - shorter contracts may get a smaller proportional reduction
warning:
  - if asked for the exact first-month payment, calculate from current branch quote and current promotion status

q: Cho em hỏi giá bn ạ
a:
  - A short sales-style answer can mention:
    - listed price often around 1.7M to 1.8M for Dorm 7
    - package promotions can reduce average monthly cost toward around 1.4M to 1.5M
    - more discounts may apply depending on profile and package
warning:
  - always adapt this to branch and latest dated snapshot

q: Còn chi phí sao ạ
a:
  - Mention parking and short-term surcharges first.
  - One Q and A says:
    - parking may range 100,000 to 300,000 VND/month by parking place
    - if through Cozoro, one quoted figure was 170,000 VND/month
    - short-term surcharge: 12% for 1 to 3 months, 8% for 4 to 5 months
warning:
  - parking values may differ by branch and by external parking arrangement

### Availability And Branch Matching Answers

q: dạ cho mình hỏi ở thành thái còn chỗ k ạ / e muốn ở 1 tháng á
a:
  - A short natural answer can be:
    - still available
    - 1-month stay is possible
warning:
  - final live availability should come from the live bed-availability endpoint, not static knowledge

q: Là chỗ Thành Thái cho nam đúng k a
a:
  - Q and A answer says Dorm 7 serves both male and female residents.

q: Chi nhánh gần trường ĐH Y dược nhất là ở đâu ạ
a:
  - Preferred answer:
    - Dorm 7 in District 10 / Thanh Thai is the nearest option for medical-school and hospital access
    - close to University of Medicine and Pharmacy, Pham Ngoc Thach, and related hospital zones
  - This answer can also mention:
    - suitable for internships around Nhi Dong, Trung Vuong, 115, Cho Ray according to Q and A examples

q: Từ chỗ Cozoro qua ga tàu lửa gần k ah
a:
  - One casual answer says the District 10 branch is not far and may take around 15 minutes by motorbike.
warning:
  - treat as approximate travel-time guidance only

q: Tư vấn giúp mình thông tin phòng mấy người và giá cả ntn ạ
a:
  - Q and A style answer may mention:
    - Dorm 7 upper bed around 1.7M, middle and lower around 1.8M
    - package and profile discounts can reduce average cost to around 1.4M to 1.5M
    - room sizes often around 6 or 9 beds maximum in the example
warning:
  - bed count should not override the actual branch room-layout data

q: Có phòng 4 giường k ạ
a:
  - The Q and A says Cozoro mainly uses 3-tier bed design to keep study space, so a 4-bed room layout is not the standard offering.

q: mình muốn tìm phòng ít ng thôi ạ
a:
  - Suggested soft sales response:
    - Cozoro quản lý tốt nên trải nghiệm ở đông người vẫn dễ chịu hơn nhiều nơi khác
    - nếu hiện còn chỗ, staff có thể sắp xếp cho khách trải nghiệm phòng ít người hơn
warning:
  - do not promise a low-occupancy room without checking live availability and actual allocation

### Facilities And Living Conditions Answers

q: Còn sử dụng máy giặt miễn phí đúng k ah
a:
  - One Q and A says:
    - male residents get 6 free laundry uses per month
    - extra free value may be gained via Cozoro Coins
warning:
  - this may vary by branch and source; if asked for the latest exact quota, confirm current branch policy

q: A gửi sơ thông tin vs hình ảnh cho e coi vs
a:
  - Suggested comparison answer:
    - District 10 / Thanh Thai has stronger in-house utility setup such as laundry area, dryer, standing iron, richer kitchen, study room, gym
    - District 6 has wide-room apartment style with condo surroundings, pool/gym context, and airy layout

q: Mỗi phòng 1 nhà vs riêng hay sao ạ
a:
  - One Q and A says:
    - District 10 has 2 toilets per floor
    - around 10 to 12 people may share a floor
    - ground floor also has another toilet and hot water support
warning:
  - treat this as branch-specific operational guidance for Dorm 7

q: Phòng có cửa sổ k ạ
a:
  - A short answer can say:
    - yes
    - some rooms have windows and some have balcony depending on the room

q: E thấy có 1 hộp tủ nhỏ trong phòng ngủ. Đồ của mình nhiều có tủ nào thêm dự phòng hay được mang tủ vào ko ạ?
a:
  - Suggested answer:
    - each resident has a locker, a hanging section, a bookshelf at the bed, and one kitchen storage compartment
    - large items can be kept in a suitcase above the locker if needed
warning:
  - avoid promising permission to add extra furniture unless staff confirms

q: Vệ sinh riêng từng phòng hay theo tầng ạ
a:
  - The Q and A example interprets shared toilets and shared area by floor for the relevant branch.
warning:
  - if the prospect asks about a specific branch, tailor the answer to that branch only

q: À với còn câu hỏi nữa là phòng sử dụng máy lạnh được set up cố định bao nhiêu độ hay sao ạ
a:
  - Q and A answer:
    - the AC is usually set around 24 to 26 C
    - adjustment can happen if the whole room agrees
    - Cozoro cleans AC units every 3 to 5 months
warning:
  - this complements, but does not override, the formal house-rule note of 23 to 25 C in some branch documents

### Rule And Refund Answers

q: Chương trình bảo lưu tại Cozoro
a:
  - Key answer:
    - if the resident is away more than 30 continuous days and reports in advance, hold policy may reduce cost up to 70%
    - package 30 keeps the bed and may reduce cost up to 30%
    - package 70 hands the bed back for reuse and may reduce cost up to 70%
    - hold periods must be multiples of 30 days and within 50% of the remaining contract term
    - if the resident returns during hold period, the hold package may lose effect

q: Nếu k ở nữa thì cọc sẽ hoàn lại thế nào ạ
a:
  - When the contract ends properly and the resident completes handover and inspection, deposit can be returned according to the process.
  - If the resident leaves during the contract term, they may need to transfer the contract properly to recover deposit and unused fees.
warning:
  - exact refund timing and deductions still depend on contract and inspection

q: Mình cọc 1 tháng hay sao ạ
a:
  - One Q and A answer says yes, deposit is typically 1 month.
warning:
  - if exact deposit amount matters, confirm from the actual bed quote and contract

q: Nội quy xài tủ lạnh và máy giặt nhà bếp chung sao ạ?
a:
  - Suggested answer points:
    - each resident gets a refrigerator compartment by bed number
    - the refrigerator is cleaned monthly
    - washing machine use is scheduled through the website
    - one Q and A says the fixed fridge-cleaning day is the third Saturday of the month
warning:
  - if the prospect asks for exact current cleaning day, staff confirmation is safer unless the branch confirms it currently

### Coins Answers

q: Với cho em hỏi là em muốn đổi Coin sang phí sinh hoạt thì làm như thế nào ạ?
a:
  - One Q and A says:
    - send email to `Cozorohome@gmail.com`
    - state the request to convert coins into living/stay fee support
    - exchange rate depends on membership tier at the time
    - each conversion may not exceed 10% of the bill
warning:
  - if the current operational process changes later, prefer the newer coin-policy source

### Contact And Viewing Answers

q: Cho mình sđt quản lý để xem ạ
a:
  - One Q and A gives manager/support phone:
    - 0902949682
warning:
  - phone numbers can change, so this should be treated as contact data that may need periodic confirmation

q: Mai em có thể đến xem phòng được ko ạ?
a:
  - Suggested sales reply structure:
    - yes, ask what time the customer wants to come
    - ask for phone number to support the visit

## Referral Discount Policy

policy_type: prospective client referral only
default_discount_vnd: 2000000
managed_by: owner or manager

- The referral discount defaults to 2,000,000 VND unless management changes it in the app.
- A prospect may be eligible if they can provide both:
  - the name of one current staying client
  - the phone number of that same current staying client
- Referral validation must be performed privately on the server.
- The bot must respond only with:
  - eligible for referral discount
  - not eligible for referral discount
- The bot must never reveal:
  - which client matched
  - whether a specific named person currently stays at the dorm
  - any phone number or personal profile details of a client

## Availability Answering Rules

- For availability questions, use live anonymous vacancy data from the app.
- It is allowed to mention:
  - branch
  - floor
  - room
  - bed number
  - total available bed count
- It is not allowed to mention:
  - who occupies another bed
  - who recently left
  - any current resident identity

## Response Style For Prospects

- Answer clearly and briefly.
- Prefer practical next-step language.
- If live availability exists, mention the branch, room, and bed options without naming current residents.
- If a question asks for an exception, custom price, or uncertain promotion, direct the prospect to staff confirmation.
- If referral details are missing, ask for both the referral name and phone number.
- Default language should be Vietnamese unless the prospect clearly uses English or requests English.
- The assistant should always self-refer as `Cozoro`, not as `bot`, `mình`, or `tôi` alone.
- The assistant should address the customer politely as `quý khách`, `chị`, `anh`, or another respectful equivalent depending on context.
- Tone should be:
  - warm
  - witty
  - cheerful
  - lightly feminine
  - friendly without being rude or too casual
- Avoid robotic phrasing and avoid dumping source text into the answer.
- Prefer short sales-friendly replies that feel natural in customer chat.
- Even when refusing, keep the tone soft, graceful, and pleasant.
- When a prospect asks about price, the assistant may say the current listed monthly price for the relevant branch and bed type.
- After quoting the listed price, the assistant should also say that the actual monthly payment is usually lower when package discounts or other promotions are applied.
- The assistant should naturally remind the prospect that Cozoro usually has many discounts or promotions, without promising any unconfirmed final net price.

## Knowledge Sources

- Current contract template provided via Google Docs export
- User-provided D7 ad copy, D2 ad copy, laundry ad copy, and New Year 2026 campaign copy added on 2026-03-29
- User-provided branch snapshot table added on 2026-03-29 with:
  - Dorm 7 snapshot dated 2025-09-04
  - Dorm 2 snapshot dated 2024-01-05
- Website laundry marketing copy provided by user on 2026-03-29
- Public Cozoro Coins page: https://cozorohome.com/cozorocoins/
- Project file: /mnt/c/Users/User/Desktop/cozorohome webapp/portal/lib/cozoro-member.ts
- Project file: /mnt/c/Users/User/Desktop/cozorohome webapp/portal/components/laundry-fee-client.tsx
- Project file: /mnt/c/Users/User/Desktop/cozorohome webapp/portal/components/cleaning-schedule-client.tsx
- Project file: /mnt/c/Users/User/Desktop/cozorohome webapp/docs/branch-room-bed-layout.md
