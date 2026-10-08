# Donation partnerships

Staff review donation requests from [cozorohome.com/donate](https://cozorohome.com/donate) in the manager app: **Messages → Donations**, or `/manager?view=donations`.

Approving a request emails one-time stay codes and schedules two follow-ups in Asia/Ho_Chi_Minh:

- **3 days before** the event, 09:00 — remind them to prepare the social posts they offered
- **10 days after** the event, 09:00 — ask them to reply with links or screenshots

The API checks for due follow-ups on startup and every 15 minutes. Emails go out through the same Gmail account already used for receipts.

## Coupon meaning

Laundry coupons are unchanged. These codes are stay credits:

| Term | What one code does | Where it is entered |
|------|--------------------|---------------------|
| Short-term | Waives the lowest nightly rate on one hostel booking. Deposit is unchanged. | Guest booking form, “Partnership coupon” |
| Long-term | Waives one month of rent on the first payment of a new registration. Deposit is unchanged. | Long-term registration form |

Each code works once. Cancelling the hostel booking, or rejecting the registration, returns the code so it can be used again.

## Marketing site change (`cozorohome-www`)

Stop sending donation forms only as web-lead chats. Post the form to the main API:

`POST https://api.cozorohome.com/internal/donations`

Header: `x-internal-api-key: <same INTERNAL_API_KEY the main API expects>`

```json
{
  "externalKey": "donate-submission-id",
  "name": "Lan Nguyen",
  "email": "lan@example.com",
  "phone": "0901234567",
  "donationType": "cash",
  "donationDetail": "500000 VND",
  "eventName": "Campus fair",
  "eventDetails": "Lobby gathering after the talk",
  "eventDate": "2026-11-20",
  "socialPlatform": "Instagram",
  "socialHandle": "@lan",
  "socialLink": "https://instagram.com/lan",
  "returnOffer": "3 stories and 1 reel tagging Cozoro"
}
```

`donationType` is `cash` or `in-kind` (also `in_kind`).

`eventDate` is required for the reminder emails. Use `YYYY-MM-DD` (Vietnam calendar date). If the form still only has free-text event details, add a date input and send it as `eventDate`. The API also reads a `YYYY-MM-DD` or `dd/mm/yyyy` date out of `eventDetails` when `eventDate` is empty. Staff can set the date in the inbox before approving; approval is blocked until a date exists.

`externalKey` must be stable per submission so retries update the same pending request instead of creating a duplicate. Approved or rejected requests are not overwritten.

### Until the marketing site is updated

`POST /internal/web-leads/sync` with `occupationHint: "donation"` still creates a donation request when the summary (or guest message) contains labeled lines the API can read, including `Email:` and preferably `Event date:`. Those threads are hidden from the Web AI chat list so they are not mixed with normal leads.

Example summary the current sync can already turn into a donation request:

```
Name: Lan Nguyen
Phone: 0901234567
Email: lan@example.com
Donation type: in-kind
Donation detail: 20 bottles of water
Event name: Community night
Event date: 20/11/2026
Social platform: Instagram
Social handle: @lan
Social link: https://instagram.com/lan
Return offer: 3 stories tagging Cozoro
```

After the marketing site posts to `/internal/donations`, it can stop mirroring donations into web leads.

## Deploy

Run Prisma migrate on the API database (`DonationRequest`, `DonationStayCoupon`, `DonationFollowUp`) before approving requests in production.
