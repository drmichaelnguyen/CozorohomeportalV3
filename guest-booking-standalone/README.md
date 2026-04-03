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

This repo now shares the main portal Cloudflare tunnel:

- tunnel ID: `ace69517-369e-44a3-9f00-3304bf2153df`
- `app.cozorohome.com` -> `http://localhost:3000`
- `chatbot.cozorohome.com` -> `http://127.0.0.1:4111`
- `shortterm.cozorohome.com` -> `http://127.0.0.1:4115`

Booking rules:

- Vietnamese guests may book D2 or D7
- Foreign guests may book D7 only
- D2 bookings require a photo of a physical ID
- D2 short address: `491 Hau Giang, Ward 11, District 6`
- D7 short address: `7a/19 Thanh Thai, Ward 14, District 10, Ho Chi Minh City`
- Full check-in details and the exact address are sent after the booking is confirmed and within 2 days before check-in
- A refundable `1,000,000 VND` damage deposit is held on the booking and refunded within 5 to 10 days after check-out
- Guests must complete a camera-only face + ID capture within 48 hours before check-in at `face-capture.html`
- Guests verify their email, create a password account, then use that account to book and manage their bookings
- Guests can log in with their email and password at `manage-booking.html` to view and update their booking details
- the uploaded ID photo is stored locally in `data/id-photos`

Recommended local publish flow on this PC:

1. Set the guest booking app `PORT=4115`
2. Set `SITE_URL=https://shortterm.cozorohome.com`
3. If the main API uses `INTERNAL_API_KEY`, set the same value here as `INTERNAL_API_KEY` or `MAIN_APP_API_KEY`
4. Start the app
5. Start the shared named tunnel with:

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
