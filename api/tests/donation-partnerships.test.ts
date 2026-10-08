import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyOneNightWaiver,
  buildDonationIngestFromWebLead,
  computeLongTermDonationDiscount,
  computeShortTermDonationDiscount,
  donationCouponCodeFromNotes,
  generateDonationCouponCode,
  isDonationCouponCode,
  parseDonationSubmissionText,
  parseEventDate,
  planDonationFollowUps,
  preserveDonationCouponNote
} from "../src/donation-partnership-logic.js";

test("event dates accept ISO and Vietnam day-first text", () => {
  assert.equal(parseEventDate("2026-11-20"), "2026-11-20");
  assert.equal(parseEventDate("20/11/2026"), "2026-11-20");
  assert.equal(parseEventDate("Event on 20-11-2026 at the lobby"), "2026-11-20");
  assert.equal(parseEventDate("not a date"), null);
  assert.equal(parseEventDate("31/02/2026"), null);
});

test("labeled donation summaries and JSON both parse", () => {
  const labeled = parseDonationSubmissionText(`
Name: Lan Nguyen
Phone: 0901234567
Email: Lan@Example.com
Donation type: in-kind
Donation detail: 20 bottles of water
Event name: Community night
Event details: Lobby gathering
Event date: 20/11/2026
Social platform: Instagram
Social handle: @lan
Social link: https://instagram.com/lan
Return offer: 3 stories tagging Cozoro
`);
  assert.equal(labeled.email, "lan@example.com");
  assert.equal(labeled.donationType, "IN_KIND");
  assert.equal(labeled.eventDate, "2026-11-20");
  assert.equal(labeled.returnOffer, "3 stories tagging Cozoro");
  assert.equal(labeled.socialLink, "https://instagram.com/lan");

  const json = parseDonationSubmissionText(
    JSON.stringify({
      name: "Minh",
      email: "minh@example.com",
      donationType: "cash",
      donationDetail: "500000 VND",
      eventDate: "2026-12-01",
      returnOffer: "1 reel"
    })
  );
  assert.equal(json.donationType, "CASH");
  assert.equal(json.eventDate, "2026-12-01");
  assert.equal(json.name, "Minh");
});

test("follow-ups are 09:00 Vietnam, 3 days before and 10 days after", () => {
  const now = new Date("2026-11-01T00:00:00.000Z");
  const plan = planDonationFollowUps("2026-11-20", now);
  assert.equal(plan[0].kind, "PRE_EVENT");
  assert.equal(plan[0].status, "SCHEDULED");
  assert.equal(plan[0].scheduledFor.toISOString(), "2026-11-17T02:00:00.000Z");
  assert.equal(plan[1].kind, "POST_EVENT");
  assert.equal(plan[1].scheduledFor.toISOString(), "2026-11-30T02:00:00.000Z");
});

test("a follow-up that is only slightly late still sends; an old window is skipped", () => {
  const slightlyLate = planDonationFollowUps("2026-11-20", new Date("2026-11-17T10:00:00.000Z"));
  assert.equal(slightlyLate[0].status, "SCHEDULED");
  assert.equal(slightlyLate[1].status, "SCHEDULED");

  const approvedAfterEvent = planDonationFollowUps("2026-11-20", new Date("2026-11-25T00:00:00.000Z"));
  assert.equal(approvedAfterEvent[0].status, "SKIPPED");
  assert.equal(approvedAfterEvent[1].status, "SCHEDULED");
});

test("short-term coupon waives the cheapest night and does not touch the deposit", () => {
  assert.equal(computeShortTermDonationDiscount([250000, 180000, 300000]), 180000);
  const priced = applyOneNightWaiver(
    { stayTotal: 500000, depositAmount: 1000000, discountAmount: 50000, nights: 3 },
    [250000, 180000, 300000]
  );
  assert.equal(priced.donationDiscountAmount, 180000);
  assert.equal(priced.stayTotal, 320000);
  assert.equal(priced.depositAmount, 1000000);
  assert.equal((priced as { total: number }).total, 1320000);
});

test("long-term coupon waives one month of rent and stops at the deposit", () => {
  assert.equal(
    computeLongTermDonationDiscount({
      monthlyRentVnd: 2500000,
      firstPaymentSubtotalVnd: 3500000,
      depositVnd: 2500000,
      otherDiscountVnd: 0
    }),
    1000000
  );
  assert.equal(
    computeLongTermDonationDiscount({
      monthlyRentVnd: 2500000,
      firstPaymentSubtotalVnd: 2500000,
      depositVnd: 2500000
    }),
    0
  );
  assert.equal(computeLongTermDonationDiscount({ monthlyRentVnd: 1800000 }), 1800000);
});

test("legacy web-lead donation text becomes a donation draft", () => {
  const draft = buildDonationIngestFromWebLead({
    conversationKey: "donate-abc-123",
    guestName: "Lan",
    phone: "0901",
    summary: "Email: lan@example.com\nDonation type: cash\nDonation detail: 200000 VND\nEvent date: 01/12/2026\nReturn offer: 1 reel"
  });
  assert.equal("skipped" in draft, false);
  if ("skipped" in draft) return;
  assert.equal(draft.externalKey, "web-lead:donate-abc-123");
  assert.equal(draft.email, "lan@example.com");
  assert.equal(draft.donationType, "CASH");
  assert.equal(draft.eventDate, "2026-12-01");
  assert.equal(draft.source, "web-lead");

  const missing = buildDonationIngestFromWebLead({
    conversationKey: "donate-no-email",
    summary: "Someone wants to donate water"
  });
  assert.equal("skipped" in missing && missing.reason.includes("email"), true);
});

test("coupon codes are recognizable and survive note edits", () => {
  let n = 0;
  const code = generateDonationCouponCode(() => {
    n += 7;
    return n;
  });
  assert.equal(isDonationCouponCode(code), true);
  const notes = preserveDonationCouponNote(`Donation coupon: ${code}`, "Bring a lock");
  assert.equal(donationCouponCodeFromNotes(notes), code);
  assert.match(notes, /Bring a lock/);
});
