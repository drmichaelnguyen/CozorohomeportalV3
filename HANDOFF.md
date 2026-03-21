# Handoff

Use this file to quickly resume work from another device or a new chat.

## Project Summary

Cozorohome Portal V3 is a user-facing portal with:

- login required before using user functions
- session-based user identity using the logged-in email
- service tabs for laundry and controller
- billing tabs for laundry fee, fines, and payments
- coins summary and history
- schedule tab with cleaning and next laundry
- floating feedback button that saves JSON files locally
- admin and manager pages kept separate from the regular user view

## Current Local Setup

- repo root: `C:\Users\User\Desktop\cozorohome webapp`
- frontend: Next.js app in `portal/`
- backend: Express + Prisma app in `api/`
- GitHub repo: `https://github.com/drmichaelnguyen/CozorohomeportalV3`

## Important Implementation Notes

- The signed-in email is the single user identifier across user pages.
- User pages should not ask for email again after login.
- Password should only be requested on login.
- Regular users should not see `Manager`, `Admin Cleaning`, or `Client Login`.
- The home page is the user dashboard/account overview.
- Payment history under Billings is shown as a table.
- Coin upgrades are paid and create a `COZORO COINS` sheet entry like `Upgrade to Gold`.
- D2 should not show dryer-related free laundry bonus.
- Feedback is saved into `portal/feedback/`.

## Tunnel Notes

- The frontend should be tunneled on port `3000`.
- The frontend now uses a local proxy path for API requests instead of relying on a hardcoded external API tunnel.
- If tunnel changes are not visible, restart the frontend and open a fresh tunnel to `http://localhost:3000`.

## Files To Check First

- `portal/app/page.tsx`
- `portal/components/home-dashboard-client.tsx`
- `portal/components/site-shell.tsx`
- `portal/components/client-login-client.tsx`
- `portal/components/bookings-client.tsx`
- `portal/components/payments-client.tsx`
- `portal/components/coins-client.tsx`
- `portal/components/account-overview-client.tsx`
- `portal/components/controller-client.tsx`
- `api/src/index.ts`
- `api/src/google-sheets.ts`

## Suggested Resume Prompt

```text
This is my CozorohomeportalV3 project. Please inspect the repo, read README.md and HANDOFF.md first, then continue helping from the current state.
```

## Next Good Tasks

- polish mobile spacing and visual consistency across all tabs
- add an in-app admin feedback viewer
- review remaining Vietnamese strings for encoding issues
- document the required env files more precisely once local setup is finalized
