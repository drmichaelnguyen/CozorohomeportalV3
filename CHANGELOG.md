# Changelog

## [3.9.29] - 2026-09-04

- **Social soft pressure**: Schedule shows a branch self-assign leaderboard (first names + counts) and a weekly peer claim note; system-assigned tasks nudge residents to self-assign next time.
- **Less friction**: One-tap **Claim next open** from Home and Schedule, open-date chips claim in one confirm step, and `/schedule#claim-next-open` deep-links straight into the confirm flow.
- **Resident AI tone**: Cozoro Assistant + Cozoro Bee use playful Vietnamese teen code and gendered address (e.g. công chúa / nàng for women; anh trai / quàng thượng / anh iu for men), with lighter humor on serious topics.
- **Member tier tool**: Shared `getResidentMemberTierSnapshot` powers `get_resident_member_status` / `get_my_member_status` (recorded vs live tier, prev-month maintain math, ranking policy, recent tier changes).
- **Rotating daily popups**: Referral, self-assign promo, birth-month promo, and cleaning/laundry reminder popups pick day-stable teen-code EN/VI variants via `portal/lib/rotating-promo-copy.ts` (no more single fixed sentence every time).

## [3.9.28] - 2026-09-04

- **Self-assign encouragement**: Open-slot notifications (`SELF_ASSIGN_OPPORTUNITY`) feed the Schedule nav badge; early-bird (+2,000 if ≥7 days ahead) and streak (+2,000 every 3rd self-assign in a month) stack on self-assign rewards.
- **Take Over fix**: Today after 20:00 Vietnam time, residents can claim an incomplete occupied slot (API + Schedule UI use VN clock).
- **Cozoro Bee**: Residents can ask Bee to list open cleaning slots, propose a reward preview, and self-assign only after they confirm in chat.
- **Member tier Q&A**: Resident Bee/Assistant can load `get_my_member_status` (recorded vs live tier, maintain thresholds) to explain ranking drops.

## [3.9.27] - 2026-09-04

- **Client Statistics → Member**: Per-client Member tab shows live/recorded Cozoro Member tier, current coins, progress to next tier, and inferred tier change history from that client’s coins rows.

## [3.9.26] - 2026-09-04

- **Portal visit tracker**: Logged-in users record lightweight screen visits (`email`, `role`, `path`, `device`), deduped ~20 minutes per path, retained 90 days. Owner Analytics → **Visits** shows totals, top screens/users, and recent activity.

## [3.9.25] - 2026-09-04

- **Member tier analytics**: Owner Client Analytics adds a **Members** tab with live Cozoro Member ranking (tier + total/current coins + prev-month earnings) and inferred tier change history from the coins sheet (paid upgrades and member-column snapshots).

## [3.9.24] - 2026-09-04

- **Coin award correctness**: Cleaning release/swap recipients no longer inherit self-assign multipliers or Hero credit; rewards recalculate at base rate.
- **Audit clawback**: Rejecting an already-approved cleaning task now reverses Google Sheet coins (not only Prisma ledger); approve is limited to `DONE_PENDING_AUDIT` and duplicate Prisma credits are blocked.
- **Extension coins**: Birth-month ×2 is locked at resident submit time; coin rows use stable `ContractExtApproval{id}` so approve retries cannot double-pay.
- **Birthday / Hero hardening**: Feb 29 birthdays grant on Feb 28 in non-leap years; Hero winners count only `APPROVED` self-assign tasks; birthday/Hero claim ledger before sheet write with stable transaction codes.

## [3.9.23] - 2026-08-31

- **Birthday coins**: Active long-term residents receive **30,000 coins** automatically on their birthday (Vietnam time), once per year, using `Ngày tháng năm sinh` from the client sheet. Ledger: `api/data/birthday-coin-grants.json`.
- **Birth-month extension bonus**: Extensions approved during the resident’s birth month with **≥ 3 months** added earn **2×** the usual tiered extension coins (10k/25k/50k → 20k/50k/100k).
- **Early extension in birth month**: Contract extension UI is available all month (not only in the last 30 days) so residents can extend before the current term ends.
- **Promotion**: Birth-month in-app popup, Notification Center items (`BIRTH_MONTH_PROMO`, `BIRTHDAY_COINS`), and updated extension panel coin labels. API: `GET /clients/birthday-benefits?email=`.

## [3.9.22] - 2026-08-31

- **Automatic Cloudflare portal cache purge**: Deploy runs a host-only purge for `app.cozorohome.com` when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are set in `api/.env`. Stale chunk recovery also triggers the same purge (5-minute cooldown) before reloading the page.

## [3.9.21] - 2026-08-31

- **Stale chunk auto-recovery**: Portal detects failed `_next/static/chunks` loads after deploys and hard-reloads once with a cache-bust param, with bilingual fallback UI if the error boundary catches it first.
- **HTML cache headers**: Page HTML is no longer stored aggressively (`no-cache, no-store`); hashed static chunks stay long-lived and immutable to reduce Vietnam mobile-carrier stale-bundle errors.

## [3.9.20] - 2026-08-30

- **Owner cleaning analytics**: Statistics → Cleaning tab now auto-calculates assignment-source breakdown (self-assign / auto / manager), 30-day vs prior-30-day trend, and a 6-month monthly chart; drill-down grouping includes assignment source.
- **Bed occupancy trend chart**: Owner Statistics → Bed occupancy shows a D2/D7 line graph over monthly snapshots with hover details instead of a table-only view.
- **Meta AI knowledge doc**: Manager Settings can sync fanpage/custom-instructions knowledge to a Google Doc for Meta AI (`POST /manager/meta-ai-knowledge/sync`).
- **Check-out review workspace**: Client list check-out tab with pending/archived cases, owner approve/notice flows, and refund email on approval.
- **Late cleaning cancellation**: Residents confirm coin fine when cancelling late; optional removal of unavailable-day marks on assigned schedules.

## [3.9.17] - 2026-08-28

- **Check-out review queue**: Client List now includes Pending and Archived check-out cases with submitted forms, photos, fees, fines, and deposit-refund calculations.
- **Owner review actions**: Owners can request a new check-out submission or send a compensation warning with detailed findings; every notice is emailed and retained in the case history.
- **Refund completion workflow**: Approved cases send an itemized refund email and archive only after successful delivery, including owner-recorded compensation deductions.
- **Late cleaning cancellation**: Residents receive a clear warning and pay the late-cancellation fine in coins when confirming; unavailable days can optionally be removed from assigned schedules.

## [3.9.16] - 2026-08-27

- **Checkout available to every active resident**: Residents can complete checkout at any time, with bilingual warnings that new service bookings stop immediately after submission.
- **Automatic post-checkout deactivation**: A completed checkout records a deactivation date 10 days later. The API checks overdue accounts at startup and hourly, then marks the resident inactive in the client sheet; existing booking cancellations remain available.
- **Fine coin-payment reliability**: Fine, coin, and client caches now update from confirmed Google Sheets writes, so a successful coin payment is not reported as failed because of a follow-up sync error.
- **Live fine status**: The resident fines page revalidates locally cached history with the server, updates a successfully paid fine immediately, and only enables coin payment from current server data.

## [3.9.12] - 2026-08-19

- **9router LLM**: Cozoro Bee, manager AI, support assistant, and the Facebook/website bot prefer 9router (`gpt-5` via `NINE_ROUTER_API_KEY`) using the same host as luckynekoAI / MCCQE. Gemini 2.5 Flash remains the fallback when 9router is unset or fails.
- **Cooker policy notice**: Residents see a first-open reminder to reserve and photo-check the shared cooker in the app.
- **Cooker IFTTT example names** now match live D7 events (`cooker1_on` / `cooker1_off` / `cooker2_on` / `cooker2_off`).

## [3.9.11] - 2026-08-18

- **Cooker check-in report**: Next to Turn On, residents can open the existing maintenance Report form with Kitchen location and that cooker already filled in.
- **AI usage for owners**: Owners can open Settings → AI usage (previously app admin only).
- **AI usage by type**: Analytics splits text chat vs computer vision (tokens, image count, estimated cost) so future vision features can be tracked separately.

## [3.9.10] - 2026-08-18

- **Cooker photos are live camera only**: Residents take one in-app camera photo that shows both the cooker and the kitchen (and one cleaned photo to turn off). Gallery uploads are not offered.
- **Cooker controller is marked Beta** in the resident Controller tab and manager kitchen cooker cards.

## [3.9.9] - 2026-08-18

- **Cooker safety takeover**: If a cooker is still on from another resident, the next user can confirm nobody is using it, start a new 30-minute session, and the previous user is ticketed automatically for safety (first 2 leftover-on incidents are reminders only; later incidents can be fined).
- **Cooker reservations**: Residents can reserve a cooker up to 3 days ahead, 30 minutes per session, max 1 hour/day (2 sessions). Only the reserver can turn it on during that slot; turning off checks out the reservation so others can use it.
- **Staff kitchen photo inspection**: Managers, owners, and app admins can open cooker/kitchen inspection photos from Controller and send a safety reminder or create a leftover-on fine ticket from those pictures.

## [3.9.8] - 2026-08-18

- **Two kitchen cookers**: Controller now has Cooker 1 and Cooker 2, each with its own on/off, inspection photos, leftover-on fine, and IFTTT ON/OFF webhook slots.

## [3.9.7] - 2026-08-18

- **Kitchen cooker controller**: Residents turn the shared cooker on/off from the Controller tab. Turn-on requires inspection photos of the cooker and kitchen; turn-off requires a cleaned-after-use photo. Photos are compressed to JPG and stored on the API server for 60 days. Leaving the cooker on past the time limit can create a fine ticket. IFTTT ON/OFF webhooks follow the AC pattern (events filled in later).

## [3.8.65] - 2026-07-30

- **Staff resident cleaning schedule**: Managers, owners, and app admins can open a selected client’s full cleaning schedule from **🧰 Tools → Cleaning schedule** (also from the bed-diagram quick actions). The popup reuses the resident cleaning calendar for that user: tasks, unavailability / Mark Away, self-assign options, swaps, and related schedule controls.

## [3.8.64] - 2026-07-21
- **Monthly bed occupancy analytics**: The API records D2 and D7 occupied/available bed snapshots once per month on or after the 15th, and Owner Analytics shows occupancy history and rates over time.
- **AI usage analytics**: App admins can review token consumption, request status, latency, and estimated Gemini cost from Settings.
- **Cleaning availability safeguards**: Past unavailable dates are rejected and residents are warned that marking unavailable does not remove an existing cleaning assignment.

## [3.8.63] - 2026-07-20
- **Pending registration discount editing**: Owners, app admins, and managers can edit the monthly discount after a client submits a registration for approval. The API preserves the original list rent, clamps the discount to that amount, recalculates the monthly contract price, records the staff-approved discount in the additional contract terms, and uses the adjusted price when the registration is approved.

## [3.8.62] - 2026-07-17
- **Cleaning schedule correction feedback**: When staff remove or reassign an auto-scheduled cleaning task (or override a same-day conflict), the admin UI requires checkbox reasons (overlap, uneven load, never assigned, etc.). Custom reasons can be added and persist for later use; each correction is stored for future auto-scheduler learning.

## [3.8.61] - 2026-07-16
- **Coin balance consistency**: Account and Coins pages now show the same spendable balance as Home / laundry / fines (roster `Cozoro coins hiện có`), with history sum only as fallback when the profile is blank/zero. Cleaning coin awards are idempotent by transaction code.
- **Hostel booking notifications**: On new booking, staff get in-app alerts + email (including `cozorohome@gmail.com`) and the guest gets a booking acknowledgment email; on paid import and manager confirm, guest (and staff on paid) get follow-up emails.
- **Check-in instructions builder**: Resident guides in Settings support category (how-to / check-in) and audience (long-term / short-term / both). Account shows filtered check-in blocks; hostel booking-success and face-capture load short-term check-in guides from the API.

## [3.8.54] - 2026-06-11
- **D7 bed layout fix**: Corrected Floor 1 room mapping so **Room 1.1** is beds **1–9** (3 bunk columns) and **Room 1.2** is beds **10–15** (2 bunk columns). Updates `BRANCH_LAYOUTS` in portal/API, manager bed diagram, registration/pricing diagrams, guest-booking standalone, and `docs/branch-room-bed-layout.md`.

## [3.8.53] - 2026-06-11
- **Stripe hostel payments (manager)**: After a guest pays on the hostel booking site, the main API auto-creates a VND payment receipt in the Google Payments sheet (`Phí lưu trú ngắn hạn (Stripe)` or adjustment purpose for date-change top-ups). Receipt creation is idempotent per Stripe payment intent/session and tracked in `api/data/stripe-hostel-payment-receipts.json`.
- **Stripe payments workspace**: Manager **Client list → Short term → Stripe payments** lists hostel Stripe charges with paid/refunded/receipt status, detail view (Stripe PI/session, refund history), **Create receipt** backfill for older payments, and **full/partial refund** from the portal (`GET/POST /manager/stripe/payments/*`).
- **API Stripe integration**: Added `stripe` SDK to the main API; set `STRIPE_SECRET_KEY` in `api/.env` (same restricted key as `guest-booking-standalone`). Guest-booking webhook sync now forwards Stripe session/intent/amount metadata to `POST /internal/guest-bookings/import-paid`.
- **Pending hostel bookings**: Manager **Short term → Pending bookings** now has **Archive** (hide from queue without cancelling) and **Reject** (cancel booking, Stripe refund when paid, deactivate `SHORTTERM-{id}` client row). Archived IDs stored in `api/data/hostel-archived-ids.json` (`POST /manager/short-term/bookings/:id/archive` and `/reject`).
- **D2 registration closure**: Shared branch-closure helpers across API, portal registration, and guest-booking standalone block new D2 long-term and hostel sign-ups with bilingual notice (permanent closure 2026-07-01).

## [3.8.41] - 2026-05-06
- **Owner coin usage override (rent receipts)**: Owners/app admins can edit the coin credit applied when creating a monthly rent receipt; the backend clamps usage to the 10% cap and coin balance before recording receipt totals.

## [3.8.37] - 2026-05-06
- **Client tab branch tools**: Added a `Branch Tools` button (D2/D7) with a modal that includes:
  - **Manual receipt for non-database clients** (`POST /manager/payments/create-manual`) where staff enters resident fields manually while branch and receiver are pre-filled by the system.
  - **Branch-wide notification send** (`POST /manager/branch-broadcast`) to all active clients in the selected branch.
- **Resident first-open prompt after branch push**: Added a branch broadcast queue persisted in `api/data/branch-broadcasts.json` and resident prompt APIs (`GET /clients/branch-broadcasts/pending`, `POST /clients/branch-broadcasts/:id/read`). Residents now see a popup on next app open after a branch notice is sent, until acknowledged.

## [3.8.36] - 2026-05-03
- **Contract extension (resident)**: Residents can choose a **custom contract end date** (within 36 months of the new term start) in addition to 1/3/6/12-month presets. Submissions send `newContractEndDate` (`dd/mm/yyyy`) to the API; sheet duration and coin tiers follow the same rules as before (`extendClientContract` in `google-sheets.ts`).
- **Contract approvals queue (manager workspace)**: **Owners**, **app admins**, and **managers** can open the queue; only **owners** and **app admins** may approve or reject. The API returns **pending** and **rejected** items (approved rows are omitted). Extension requests include a snapshot (previous end, new start/end, branch, bed, Mã HĐ, resident name) so staff see full details before approval. Rejected items remain visible with reason and reviewer.

## [3.8.34] - 2026-04-30
- **Manager client payment table**: Reworked the client table into a payment-focused view with per-column filters, sortable headers, paid status, current-month payment totals, payment plan labels, and next payment dates.
- **Owner analytics localization and grouping UX**: Owner analytics received Vietnamese localization updates and expanded grouping/drilldown behavior for payments, coins, fines, laundry, cleaning, and airfryer analytics.

## [3.8.33] - 2026-04-29
- **Owner payment analytics**: Added an owner-only Client -> Analytics dashboard with bar and donut revenue views, configurable grouping order, click-through drilldowns, and a final payment receipt entry table.

## [3.8.32] - 2026-04-28
- Hostel pricing now supports date-specific bed rates from the main app and the standalone booking site sums nightly prices across the stay.

## [3.8.31] - 2026-04-27
- Added a unified `ActionLog` for database-changing actions, covering core resident, manager, cleaning, booking, rent, gate parking, pricing, and prepaid billing mutations.

## [3.8.30] - 2026-04-27
- Fine ticket client payload no longer includes creator identity; creator is still stored server-side and in the underlying sheet/email workflow.

## [3.7.1] - 2026-04-14
- **Multi-month prepaid package**: Detailed line-item estimate (rent, tenure surcharge, monthly adjustment, professional discount, parking, then package gross/discount/net; laundry, gate parking, and fines always shown). Improved contrast on resident next-payment and manager client panels. API adds `recurringComponents` and `laundryCashUses` to prepaid estimate payload.

## [3.7.0] - 2026-04-14
- **Parking plans (registration)**: `ParkingPricingTier` per branch — managers/owners add named EN/VI plans and fees; `/register` shows choices when multiple; per-bed parking override still wins for that bed; `portable-dev` no longer blocks on `migrate deploy` (no migrations in repo); `rebuild-restart.cmd`, `start-sandbox.cmd`, ping-based delays; misc TS fixes (checkout form, nav badges, prepaid estimate type).

## [3.6.10] - 2026-04-13
- **Multi-month prepaid (manager)**: Draft/confirm package totals, optional resident note, notify in-app and/or email; `PrepaidPackageBilling` model; resident next-payment and notifications (`PREPAID_PACKAGE`) reflect confirmed amounts.

## [3.6.9] - 2026-04-13
- **Support assistant & inbox**: Optional Gemini assistant after resident personal messages, same `SupportConversation` as managers; assistant contact capture fields; manager UI for assistant vs staff and callback strip.
- **Manager Messages workspace**: Unsolved maintenance ticket badge on Maintenance tab and on mobile nav; support subtab area scroll/sticky layout.
- **Docs**: `bot/README` — `chatbot.cozorohome.com` vs portal; Facebook Messenger optional.

## [3.6.3] - 2026-04-10
- **Collapsed Pricing Settings**: Manager and owner settings menus in the pricing area now start collapsed and expand only on demand, making the settings view easier to scan.

## [3.5.12] - 2026-04-08
### Added
- **Laundry Timing Help**: Added a manager-side `?` help popup in the laundry schedule area that explains how booking duration and cooldown combine, with a concrete calendar example.

### Changed
- **Editable Laundry Machine Timing**: Managers can now configure each machine's booking duration and cooldown separately from the laundry schedule view.
- **Laundry Availability Rule**: Next available laundry slots now follow `booking start + duration + cooldown`, so the post-booking gap is explicit and machine-specific instead of being implied by the old overlap rule.

## [3.5.9] - 2026-04-06
### Fixed
- **Legacy Cleaning DB Compatibility**: Added fallback handling for local databases that do not yet have the new `assignedByEmail` and `assignedByName` columns, preventing cleaning read, write, and delete failures during local development.
- **Cleaning Duplicate Recovery**: Tightened cleaning slot sync so calendar imports reconcile to a single canonical task per slot and stop re-importing owner/operator emails like `cozorohome@gmail.com` as resident assignees.
- **Admin Cleaning Removal**: Removing a cleaning task from the manager workspace now also removes its linked Google Calendar event so the task does not reappear on the next refresh.

### Changed
- **Per-Calendar Auto-Scheduler Settings**: The manager cleaning workspace now edits auto-scheduler settings per cleaning calendar/job instead of one shared horizon for all jobs.
- **Hostel Auto-Assign Exclusion**: Background and bulk automatic cleaning assignment now skip short-term hostel clients with `SHORTTERM-...` contract codes.
- **Cleaning Manager UI**: Moved job-specific scheduler controls into the selected calendar view and removed the redundant global toggle from that panel.

## [3.5.8] - 2026-04-06
### Added
- **Cleaning Auto-Scheduler Controls**: Managers can now enable or disable the background cleaning auto-scheduler, choose whether it fills unassigned dates, and set how many days in advance it should plan.
- **Cleaning Assigner Metadata**: Cleaning assignments now store who assigned them so manager views can show the real assigner while resident views keep the simplified labels `Cozoro`, `System`, and `Self assign`.

### Changed
- **Manager Cleaning Workspace**: Added an auto-scheduler settings panel to the manager cleaning screen and passed manager identity through manual assign and bulk auto-assign flows.
- **Database Rollout**: Added a Prisma migration for the new cleaning assigner metadata columns on `CleaningTask`.

## [3.5.7] - 2026-04-06
### Fixed
- **Vietnam Date Parsing**: Standardized resident and manager contract/payment date parsing to treat `dd/mm/yyyy` and `dd-mm-yyyy` as Vietnam dates first, preventing policy locks from triggering early on ambiguous dates.
- **Policy Lock Consistency**: Unified contract due-date checks across dashboard, bookings, controller, payments, and manager views so the same contract status is shown everywhere.

### Changed
- **Google Sheets Write Reduction**: Batched multi-column row updates into single `values.batchUpdate` calls to reduce write-request volume during staff edits.
- **Duplicate Write Guard**: Added short server-side deduplication and cooldown protection on high-risk Google Sheets write routes to stop rapid double-submits, retries, and repeat clicks from exhausting quota.

## [3.3.4] - 2026-03-31
### Added
- **Manager Password Reset**: Managers can now securely reset passwords for residents directly from the client details view in the portal.
- **Failover Tooling**: Added manual tunnel operation scripts and automated PowerShell failover monitors for the primary API server.


## [3.1.1] - 2026-03-25
### Added
- **iMessage-Style Messaging**: Full-screen mobile layout with sticky bottom input and auto-scroll for a better chat experience.
- **Cleaning Self-Assignment Bonus**: Residents now earn a 20% coin bonus when self-assigning cleaning tasks.
- **Next Cleaning Preview**: Added a prominent "Your Next Cleaning" card to the schedule view for easier tracking.

### Fixed
- **Login Diagnostics**: Added detailed logging to help capture "string did not match expected pattern" errors reported by some clients.
- **API CORS/Origin**: Fixed local development origin mismatch between port 3001 and 4001.

All notable changes to the CozoroHome Portal project will be documented in this file.

## [3.0.2] - 2026-03-24

### Added
- **Manager View Sub-Tabs**: Introduced "1. Browse List" and "2. Client Details" sub-tabs in the Manager Workspace to solve scrolling issues on mobile and desktop.
- **Automatic Navigation**: The portal now automatically switches to the "Client Details" tab when a client reached from the diagram or table is selected.
- **Conditional Visibility**: The "Client Details" tab is hidden until a client is active, keeping the interface focused.

## [3.0.1] - 2026-03-24

### Added
- **App Versioning**: Implemented a `VersionBadge` component in the bottom-right corner to display the current version and build timestamp.
- **Admin Laundry Access**: Enabled staff/admin accounts (e.g., `cozorohome@gmail.com`) to access the laundry booking interface even if they are not listed as residents in the database.

### Fixed
- **Laundry Booking Re-render**: Resolved an infinite loop in `BookingsClient.tsx` caused by incorrect loading state handling when an email was not found in the resident list.

## [3.0.0] - 2026-03-22

### User Portal Features
- **Multi-Method Login**: Secure access via Email/Password or Google (in progress).
- **Laundry Booking**: Real-time reservation system with Google Calendar and Sheets integration.
- **Account Overview**: Unified view for contract info, current coins, and personal stats.
- **Device Controller**: Remote control for AC units and common area devices.
- **Schedule Management**: Daily and weekly schedules for residents.
- **Support & Messaging**: Direct chat with staff and feedback submission with local storage.

### Manager Workspace Features
- **Comprehensive Client Management**: Profile editing, contract tracking, and status monitoring.
- **Visual Room Diagram**: Interactive interactive map for branches (D2, D7) with unread message indicators.
- **Financial Tools**:
    - Coin adjustments (add/use coins).
    - Fine ticket creation with image uploads.
    - Payment receipt generation with purpose tracking.
- **Staff Role Management**: Role-based access for App Admin, Owner, Manager, and Mechanic.
- **Cleaning Operations**: Assignment and tracking of cleaning schedules.
- **Machine Triggers**: Remote activation for laundry machines and AC units.

### Infrastructure
- **Stack**: Next.js frontend + Express/Prisma backend with MySQL database.
- **Localization**: Full support for Vietnamese (VI) and English (EN).
- **Branch Support**: Multi-branch support (D2, D7).
