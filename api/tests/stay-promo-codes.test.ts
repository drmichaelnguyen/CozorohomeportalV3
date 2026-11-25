import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bedAllowed,
  computePromoDiscountVnd,
  computeShortTermWaiveUnitsDiscount,
  isValidPromoCodeFormat,
  normalizePromoCode,
  parseAllowedBedsJson,
  serializeAllowedBeds,
  termMatchesScope
} from "../src/stay-promo-code-logic.js";

test("promo code normalize and format", () => {
  assert.equal(normalizePromoCode(" summer-10 "), "SUMMER-10");
  assert.equal(isValidPromoCodeFormat("SUMMER10"), true);
  assert.equal(isValidPromoCodeFormat("AB"), false);
  assert.equal(isValidPromoCodeFormat("BAD CODE"), false);
});

test("term scope and bed allowlist", () => {
  assert.equal(termMatchesScope("BOTH", "LONG_TERM"), true);
  assert.equal(termMatchesScope("SHORT_TERM", "LONG_TERM"), false);
  assert.equal(bedAllowed(null, "D7", 12), true);
  assert.equal(bedAllowed([{ branchId: "D7", bedNumber: 12 }], "D7", 12), true);
  assert.equal(bedAllowed([{ branchId: "D7", bedNumber: 12 }], "D7", 13), false);
  assert.deepEqual(parseAllowedBedsJson(serializeAllowedBeds([{ branchId: "d7", bedNumber: 3 }])), [
    { branchId: "D7", bedNumber: 3 }
  ]);
});

test("short-term waive units uses lowest nights", () => {
  assert.equal(computeShortTermWaiveUnitsDiscount([200000, 150000, 180000], 2), 330000);
  assert.equal(computeShortTermWaiveUnitsDiscount([200000], 3), 200000);
});

test("promo benefit math caps deposit out", () => {
  assert.equal(
    computePromoDiscountVnd({
      benefitType: "FIXED_VND",
      amountVnd: 500000,
      termType: "SHORT_TERM",
      staySubtotalVnd: 400000
    }),
    400000
  );
  assert.equal(
    computePromoDiscountVnd({
      benefitType: "PERCENT_OFF",
      percentOff: 10,
      termType: "SHORT_TERM",
      staySubtotalVnd: 1000000
    }),
    100000
  );
  assert.equal(
    computePromoDiscountVnd({
      benefitType: "WAIVE_UNITS",
      benefitUnits: 1,
      termType: "LONG_TERM",
      monthlyRentVnd: 2500000,
      firstPaymentSubtotalVnd: 5000000,
      depositVnd: 2500000,
      otherDiscountVnd: 0
    }),
    2500000
  );
  assert.equal(
    computePromoDiscountVnd({
      benefitType: "FIXED_VND",
      amountVnd: 900000,
      termType: "LONG_TERM",
      monthlyRentVnd: 2500000,
      firstPaymentSubtotalVnd: 5000000,
      depositVnd: 2500000,
      otherDiscountVnd: 500000
    }),
    900000
  );
});
