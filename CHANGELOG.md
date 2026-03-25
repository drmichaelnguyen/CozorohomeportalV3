# Changelog

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
