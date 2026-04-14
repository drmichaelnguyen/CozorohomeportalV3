# Changelog

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
