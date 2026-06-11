# Changelog

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
