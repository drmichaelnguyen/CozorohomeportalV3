# CozoroHome Guest Booking Standalone

This is a standalone booking site. It does not modify the existing portal routes.

## What it reads

- Current resident occupancy from `CLIENT_CACHE_PATH`
- Direct guest bookings from the MySQL database in `BOOKING_TABLE_NAME`

## Run

1. Copy `.env.example` to `.env` and fill `DATABASE_URL`
2. Add `STRIPE_SECRET_KEY` to enable card payment
3. Install dependencies with `npm install`
4. Start with `npm run dev`
5. Open `http://localhost:3100`

## Publish to shortterm.cozorohome.com

This repo already includes a named Cloudflare tunnel mapping:

- `shortterm.cozorohome.com` -> `http://127.0.0.1:4115`

Recommended local publish flow on this PC:

1. Set the guest booking app `PORT=4115`
2. Set `SITE_URL=https://shortterm.cozorohome.com`
3. If the main API uses `INTERNAL_API_KEY`, set the same value here as `INTERNAL_API_KEY` or `MAIN_APP_API_KEY`
4. Start the app
5. Start the named tunnel with:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\cozorohome webapp\tools\restart-shortterm-tunnel.ps1"
```

Or use:

```batch
guest-booking-control.bat restart-all
```

## Notes

- The app auto-creates its booking table if it does not exist.
- Resident occupancy is based on the same cached client data the current project already uses.
- Guest reservations are stored separately from the portal code.
- Stripe checkout redirects to `/booking-success.html` and confirms payment before marking the booking confirmed.
