# Changelog

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
- Initial Version 3 Release (Transition to New Interface Branch).
