"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";

type Sex = "male" | "female";
type BranchId = "D2" | "D7";

type EligibilityRule =
  | { type: "status"; values: string[] }
  | { type: "minMonths"; value: number }
  | { type: "referral" }
  | { type: "bedTier"; values: Array<"top" | "middle" | "bottom"> }
  | { type: "gender"; values: Array<"male" | "female"> }
  | { type: "occupation"; values: string[] };

type DiscountRule = {
  id: string;
  label: string;
  labelVi: string;
  description: string;
  descriptionVi: string;
  amountVnd: number;
  durationMonths: number | null;
  eligibility: EligibilityRule[];
  enabled: boolean;
};

type AvailabilityResponse = {
  syncedAt: string;
  availableBeds: number;
  rooms: Array<{
    room: string;
    floor: string;
    beds: Array<{
      bedNumber: number;
      status: "available_now" | "available_soon";
      availableOn: string;
      pricing: {
        monthlyPrice: number;
        deposit: number;
      };
    }>;
  }>;
};

type FormState = {
  fullName: string;
  email: string;
  sex: Sex | "";
  branchId: BranchId | "";
  bedNumber: string;
  phone: string;
  dateOfBirth: string;
  permanentAddress: string;
  governmentId: string;
  idIssuedDate: string;
  idIssuedPlace: string;
  contractStartDate: string;
  contractMonths: string;
  paymentFrequency: string;
  currentStatus: string;
  schoolOrWorkplace: string;
  referralSource: string;
  emergencyPhone: string;
  additionalTerms: string;
  agreed: boolean;
};

// Minimal layout for bed tier derivation (top/middle/bottom)
const BRANCH_BED_LAYOUTS: Record<BranchId, Array<{ startBed: number; endBed: number; bunkCount: number }>> = {
  D2: [
    { startBed: 1, endBed: 9, bunkCount: 3 },
    { startBed: 10, endBed: 15, bunkCount: 2 },
    { startBed: 16, endBed: 21, bunkCount: 2 }
  ],
  D7: [
    { startBed: 1, endBed: 9, bunkCount: 3 },
    { startBed: 10, endBed: 15, bunkCount: 2 },
    { startBed: 16, endBed: 24, bunkCount: 3 },
    { startBed: 25, endBed: 33, bunkCount: 3 },
    { startBed: 34, endBed: 39, bunkCount: 2 },
    { startBed: 40, endBed: 48, bunkCount: 3 },
    { startBed: 49, endBed: 57, bunkCount: 3 },
    { startBed: 58, endBed: 63, bunkCount: 2 }
  ]
};

function getBedTier(branchId: BranchId | "", bedNumber: number): "top" | "middle" | "bottom" | null {
  if (!branchId) return null;
  const room = BRANCH_BED_LAYOUTS[branchId].find((r) => bedNumber >= r.startBed && bedNumber <= r.endBed);
  if (!room) return null;
  const tierIdx = (bedNumber - room.startBed) % room.bunkCount;
  if (room.bunkCount === 3) return (["top", "middle", "bottom"] as const)[tierIdx] ?? null;
  return (["top", "bottom"] as const)[tierIdx] ?? null;
}

const branchOptions: Array<{ id: BranchId; label: string; address: string }> = [
  { id: "D2", label: "D2", address: "491 Hau Giang, Ward 11, District 6" },
  { id: "D7", label: "D7", address: "7A/19/28 Thanh Thai, Ward 14, District 10" }
];

const paymentOptions = ["Moi thang", "Moi 03 thang", "Moi 06 thang"];
const statusOptions = ["Sinh vien", "Hoc sinh", "Sau dai hoc", "Dang di lam", "Khac"];

const initialFormState: FormState = {
  fullName: "",
  email: "",
  sex: "",
  branchId: "",
  bedNumber: "",
  phone: "",
  dateOfBirth: "",
  permanentAddress: "",
  governmentId: "",
  idIssuedDate: "",
  idIssuedPlace: "",
  contractStartDate: "",
  contractMonths: "6",
  paymentFrequency: "Moi thang",
  currentStatus: "",
  schoolOrWorkplace: "",
  referralSource: "",
  emergencyPhone: "",
  additionalTerms: "",
  agreed: false
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);
}

function addMonthsMinusOneDay(startDate: string, months: number) {
  if (!startDate || !Number.isFinite(months) || months <= 0) {
    return "";
  }

  const [yearValue, monthValue, dayValue] = startDate.split("-").map(Number);
  if (!yearValue || !monthValue || !dayValue) {
    return "";
  }

  const date = new Date(yearValue, monthValue - 1, dayValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  date.setMonth(date.getMonth() + months);
  date.setDate(date.getDate() - 1);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getFirstPaymentMultiplier(paymentFrequency: string) {
  if (paymentFrequency.includes("06")) {
    return 6;
  }

  if (paymentFrequency.includes("03")) {
    return 3;
  }

  return 1;
}

// Rules that are checked automatically from form data — no user attestation needed
function checkAutoRules(discount: DiscountRule, form: FormState, selectedBedTier?: "top" | "middle" | "bottom"): boolean {
  for (const rule of discount.eligibility) {
    if (rule.type === "minMonths") {
      if (Number(form.contractMonths) < rule.value) return false;
    } else if (rule.type === "bedTier") {
      if (!selectedBedTier || !rule.values.includes(selectedBedTier)) return false;
    } else if (rule.type === "gender") {
      if (!form.sex || !rule.values.includes(form.sex as "male" | "female")) return false;
    }
    // status, occupation, referral are attestation rules — not checked here
  }
  return true;
}

// Rules that require the registrant to consciously claim them (proof will be requested)
function getAttestationRules(discount: DiscountRule): EligibilityRule[] {
  return discount.eligibility.filter((r) => r.type === "status" || r.type === "occupation" || r.type === "referral");
}

function describeAttestationRule(rule: EligibilityRule): string {
  if (rule.type === "status") return `My status is: ${("values" in rule ? rule.values : []).join(" or ")}`;
  if (rule.type === "occupation") return `My occupation is: ${("values" in rule ? rule.values : []).join(", ")}`;
  if (rule.type === "referral") return "I was referred by a current resident";
  return rule.type;
}

function checkEligibility(discount: DiscountRule, form: FormState, selectedBedTier?: "top" | "middle" | "bottom", claimedIds?: Set<string>): boolean {
  if (!checkAutoRules(discount, form, selectedBedTier)) return false;
  const attestationRules = getAttestationRules(discount);
  if (attestationRules.length > 0 && !claimedIds?.has(discount.id)) return false;
  return true;
}

export function RegisterFormClient() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [availabilityError, setAvailabilityError] = useState("");
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [allDiscounts, setAllDiscounts] = useState<DiscountRule[]>([]);
  const [claimedDiscountIds, setClaimedDiscountIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/public/pricing-discounts`)
      .then((r) => r.json())
      .then((data: { discounts?: DiscountRule[] }) => {
        if (data.discounts) setAllDiscounts(data.discounts);
      })
      .catch(() => {});
  }, []);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  useEffect(() => {
    if (!form.branchId || !form.sex) {
      setAvailability(null);
      setAvailabilityError("");
      setForm((current) => ({ ...current, bedNumber: "" }));
      return;
    }

    const controller = new AbortController();

    async function loadAvailability() {
      setLoadingAvailability(true);
      setAvailabilityError("");
      setSuccessMessage("");

      try {
        const response = await fetch(
          `${API_BASE_URL}/api/public/register/availability?branchId=${encodeURIComponent(form.branchId)}&sex=${encodeURIComponent(form.sex)}`,
          { signal: controller.signal }
        );
        const data = (await response.json()) as AvailabilityResponse | { error?: string };
        if (!response.ok) {
          throw new Error("error" in data && data.error ? data.error : "Unable to load bed availability.");
        }

        setAvailability(data as AvailabilityResponse);
        setForm((current) => ({ ...current, bedNumber: "" }));
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setAvailability(null);
        setAvailabilityError(error instanceof Error ? error.message : "Unable to load bed availability.");
      } finally {
        if (!controller.signal.aborted) {
          setLoadingAvailability(false);
        }
      }
    }

    void loadAvailability();

    return () => controller.abort();
  }, [form.branchId, form.sex]);

  const selectedBranch = branchOptions.find((option) => option.id === form.branchId) ?? null;
  const selectedBed = useMemo(() => {
    if (!availability || !form.bedNumber) {
      return null;
    }

    const numericBed = Number(form.bedNumber);
    return (
      availability.rooms
        .flatMap((room) => room.beds.map((bed) => ({ ...bed, room: room.room, floor: room.floor })))
        .find((bed) => bed.bedNumber === numericBed) ?? null
    );
  }, [availability, form.bedNumber]);

  const contractMonths = Number(form.contractMonths);
  const contractEndDate = useMemo(
    () => addMonthsMinusOneDay(form.contractStartDate, contractMonths),
    [form.contractStartDate, contractMonths]
  );
  const selectedBedTier = useMemo(
    () => form.bedNumber ? getBedTier(form.branchId, Number(form.bedNumber)) ?? undefined : undefined,
    [form.branchId, form.bedNumber]
  );
  // Discounts where auto-rules pass — these are shown as claimable if they have attestation rules
  const autoPassDiscounts = useMemo(
    () => allDiscounts.filter((d) => d.enabled && checkAutoRules(d, form, selectedBedTier)),
    [allDiscounts, form.contractMonths, form.sex, selectedBedTier]
  );
  // Fully eligible = auto-rules pass + attestation claimed (or no attestation rules)
  const eligibleDiscounts = useMemo(
    () => autoPassDiscounts.filter((d) => checkEligibility(d, form, selectedBedTier, claimedDiscountIds)),
    [autoPassDiscounts, form, selectedBedTier, claimedDiscountIds]
  );
  // Discounts that pass auto-rules and have attestation rules — shown as claimable checkboxes
  const claimableDiscounts = useMemo(
    () => autoPassDiscounts.filter((d) => getAttestationRules(d).length > 0),
    [autoPassDiscounts]
  );

  const totalMonthlyDiscount = eligibleDiscounts.reduce((sum, d) => sum + d.amountVnd, 0);

  const pricingSummary = selectedBed
    ? {
        monthlyPrice: selectedBed.pricing.monthlyPrice,
        deposit: selectedBed.pricing.deposit,
        discountedMonthlyPrice: Math.max(0, selectedBed.pricing.monthlyPrice - totalMonthlyDiscount),
        firstPayment:
          Math.max(0, selectedBed.pricing.monthlyPrice - totalMonthlyDiscount) * getFirstPaymentMultiplier(form.paymentFrequency) +
          selectedBed.pricing.deposit
      }
    : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");
    setSuccessMessage("");

    if (!form.sex || !form.branchId || !selectedBed || !pricingSummary) {
      setSubmitError("Please choose sex, branch, and an available bed first.");
      return;
    }

    if (!contractEndDate) {
      setSubmitError("Please provide a valid contract start date and contract length.");
      return;
    }

    if (!form.agreed) {
      setSubmitError("You need to confirm the house rules before submitting.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/public/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email,
          sex: form.sex,
          branchId: form.branchId,
          bedNumber: selectedBed.bedNumber,
          phone: form.phone,
          dateOfBirth: form.dateOfBirth || undefined,
          permanentAddress: form.permanentAddress || undefined,
          governmentId: form.governmentId || undefined,
          idIssuedDate: form.idIssuedDate || undefined,
          idIssuedPlace: form.idIssuedPlace || undefined,
          contractStartDate: form.contractStartDate,
          contractMonths,
          contractEndDate,
          monthlyPrice: pricingSummary.monthlyPrice,
          deposit: pricingSummary.deposit,
          paymentFrequency: form.paymentFrequency || undefined,
          currentStatus: form.currentStatus || undefined,
          schoolOrWorkplace: form.schoolOrWorkplace || undefined,
          referralSource: form.referralSource || undefined,
          emergencyPhone: form.emergencyPhone || undefined,
          additionalTerms: form.additionalTerms || undefined,
          claimedDiscounts: eligibleDiscounts.map((d) => d.id)
        })
      });

      const data = (await response.json()) as { contractCode?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Unable to submit registration.");
      }

      setSuccessMessage(
        data.contractCode
          ? `Registration submitted. Contract code: ${data.contractCode}.`
          : "Registration submitted successfully."
      );
      setForm((current) => ({ ...initialFormState, sex: current.sex, branchId: current.branchId }));
      setAvailability((current) =>
        current
          ? {
              ...current,
              rooms: current.rooms
                .map((room) => ({
                  ...room,
                  beds: room.beds.filter((bed) => bed.bedNumber !== selectedBed.bedNumber)
                }))
                .filter((room) => room.beds.length > 0),
              availableBeds: Math.max(0, current.availableBeds - 1)
            }
          : current
      );
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to submit registration.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-[linear-gradient(135deg,#0f766e_0%,#155e75_55%,#1e293b_100%)] px-6 py-8 text-white shadow-xl sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100/80">CozoroHome Registration</p>
        <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">Register a bed and prepare the contract online.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-cyan-50/90 sm:text-base">
          Choose branch and sex first. The page only shows beds available now or within the next 30 days, and pricing is auto-filled from current CozoroHome data.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
        <form onSubmit={handleSubmit} className="space-y-6 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">1. Branch and bed</h2>
              <p className="mt-1 text-sm text-slate-500">Beds load only after branch and sex are selected.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">Sex</span>
                <select value={form.sex} onChange={(event) => updateForm("sex", event.target.value as Sex | "")} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required>
                  <option value="">Choose sex</option>
                  <option value="female">Female / Nu</option>
                  <option value="male">Male / Nam</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">Branch</span>
                <select value={form.branchId} onChange={(event) => updateForm("branchId", event.target.value as BranchId | "")} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required>
                  <option value="">Choose branch</option>
                  {branchOptions.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.label} - {branch.address}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-4">
              {!form.sex || !form.branchId ? <p className="text-sm text-slate-500">Select sex and branch to load available beds.</p> : null}
              {loadingAvailability ? <p className="text-sm text-slate-500">Loading available beds...</p> : null}
              {availabilityError ? <p className="text-sm text-rose-600">{availabilityError}</p> : null}
              {availability && availability.rooms.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-700">{availability.availableBeds} matching bed{availability.availableBeds === 1 ? "" : "s"} found</p>
                    <p className="text-xs text-slate-400">Synced {new Date(availability.syncedAt).toLocaleString()}</p>
                  </div>
                  {availability.rooms.map((room) => (
                    <div key={`${room.floor}-${room.room}`} className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
                      <p className="text-sm font-semibold text-slate-900">Room {room.room}</p>
                      <p className="mb-3 text-xs text-slate-500">{room.floor}</p>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {room.beds.map((bed) => {
                          const isSelected = form.bedNumber === String(bed.bedNumber);
                          return (
                            <button key={bed.bedNumber} type="button" onClick={() => updateForm("bedNumber", String(bed.bedNumber))} className={`rounded-[1.25rem] border px-4 py-3 text-left ${isSelected ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-slate-50 hover:border-teal-300 hover:bg-white"}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">Bed {bed.bedNumber}</p>
                                  <p className="mt-1 text-xs text-slate-500">{bed.status === "available_now" ? "Available now" : `Available from ${bed.availableOn}`}</p>
                                </div>
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${bed.status === "available_now" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{bed.status === "available_now" ? "Now" : "Soon"}</span>
                              </div>
                              <div className="mt-3 space-y-1 text-xs text-slate-600">
                                <p>Monthly share: {formatCurrency(bed.pricing.monthlyPrice)}</p>
                                <p>Deposit: {formatCurrency(bed.pricing.deposit)}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">Full name</span><input value={form.fullName} onChange={(event) => updateForm("fullName", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">Email</span><input type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">Phone</span><input value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">Date of birth</span><input type="date" value={form.dateOfBirth} onChange={(event) => updateForm("dateOfBirth", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2 md:col-span-2"><span className="text-sm font-medium text-slate-700">Permanent address</span><input value={form.permanentAddress} onChange={(event) => updateForm("permanentAddress", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">CCCD / Passport</span><input value={form.governmentId} onChange={(event) => updateForm("governmentId", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">Issue date</span><input type="date" value={form.idIssuedDate} onChange={(event) => updateForm("idIssuedDate", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2 md:col-span-2"><span className="text-sm font-medium text-slate-700">Issue place</span><input value={form.idIssuedPlace} onChange={(event) => updateForm("idIssuedPlace", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">Contract start date</span><input type="date" value={form.contractStartDate} onChange={(event) => updateForm("contractStartDate", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">Contract length (months)</span><input type="number" min={1} max={36} value={form.contractMonths} onChange={(event) => updateForm("contractMonths", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">Payment frequency</span><select value={form.paymentFrequency} onChange={(event) => updateForm("paymentFrequency", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white">{paymentOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">Calculated contract end date</span><input value={contractEndDate} readOnly className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-slate-700 outline-none" /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">Current status</span><select value={form.currentStatus} onChange={(event) => updateForm("currentStatus", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white"><option value="">Choose current status</option>{statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
            <label className="space-y-2 md:col-span-2"><span className="text-sm font-medium text-slate-700">School or workplace</span><input value={form.schoolOrWorkplace} onChange={(event) => updateForm("schoolOrWorkplace", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">How did you hear about CozoroHome?</span><input value={form.referralSource} onChange={(event) => updateForm("referralSource", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">Emergency phone</span><input value={form.emergencyPhone} onChange={(event) => updateForm("emergencyPhone", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2 md:col-span-2"><span className="text-sm font-medium text-slate-700">Additional terms or notes</span><textarea value={form.additionalTerms} onChange={(event) => updateForm("additionalTerms", event.target.value)} rows={4} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
          </section>

          <label className="flex items-start gap-3 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
            <input type="checkbox" checked={form.agreed} onChange={(event) => updateForm("agreed", event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
            <span className="text-sm leading-6 text-slate-600">I have read, agree with, and will follow the Cozoro dorm house rules.</span>
          </label>
          {submitError ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{submitError}</p> : null}
          {successMessage ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={submitting} className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400">{submitting ? "Submitting..." : "Submit registration"}</button>
            <Link href="/client-login" className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50">Already have an account? Sign in</Link>
          </div>
        </form>

        <aside className="space-y-5">
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <p className="text-sm font-semibold text-slate-900">Pricing summary</p>
            {selectedBed && pricingSummary ? (
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="rounded-[1.5rem] bg-slate-950 px-5 py-4 text-white">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-300">{selectedBranch?.label ?? selectedBed.floor} / Room {selectedBed.room} / Bed {selectedBed.bedNumber}</p>
                  {eligibleDiscounts.length > 0 ? (
                    <>
                      <p className="mt-3 text-lg font-medium line-through text-slate-400">{formatCurrency(pricingSummary.monthlyPrice)}</p>
                      <p className="text-3xl font-bold text-emerald-400">{formatCurrency(pricingSummary.discountedMonthlyPrice)}</p>
                    </>
                  ) : (
                    <p className="mt-3 text-3xl font-bold">{formatCurrency(pricingSummary.monthlyPrice)}</p>
                  )}
                  <p className="mt-1 text-sm text-slate-300">Monthly share</p>
                </div>
                {/* Claimable discounts — auto-rules pass, user must self-attest */}
                {claimableDiscounts.length > 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
                    <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Available discounts — tick to claim</p>
                    <p className="text-xs text-amber-700">Proof will be requested before your contract is signed.</p>
                    {claimableDiscounts.map((d) => {
                      const claimed = claimedDiscountIds.has(d.id);
                      return (
                        <label key={d.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${claimed ? "border-emerald-300 bg-emerald-50" : "border-amber-200 bg-white hover:bg-amber-50"}`}>
                          <input
                            type="checkbox"
                            checked={claimed}
                            onChange={(e) => {
                              setClaimedDiscountIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(d.id); else next.delete(d.id);
                                return next;
                              });
                            }}
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-emerald-600"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div>
                                <span className={`text-sm font-semibold ${claimed ? "text-emerald-800" : "text-slate-800"}`}>{d.label}</span>
                                {d.labelVi && <span className={`ml-1.5 text-sm ${claimed ? "text-emerald-700" : "text-slate-500"}`}>— {d.labelVi}</span>}
                              </div>
                              <span className={`text-sm font-semibold ${claimed ? "text-emerald-700" : "text-slate-500"}`}>−{formatCurrency(d.amountVnd)}/month</span>
                            </div>
                            <p className="mt-0.5 text-xs text-slate-500">{d.description}{d.descriptionVi ? ` / ${d.descriptionVi}` : ""}</p>
                            <ul className="mt-1 space-y-0.5">
                              {getAttestationRules(d).map((rule, i) => (
                                <li key={i} className="text-xs text-amber-700">I confirm: {describeAttestationRule(rule)}</li>
                              ))}
                            </ul>
                            {d.durationMonths != null && <p className="mt-0.5 text-xs text-slate-400">Applied for first {d.durationMonths} month{d.durationMonths !== 1 ? "s" : ""}</p>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
                {/* Applied discounts — fully eligible */}
                {eligibleDiscounts.length > 0 ? (
                  <div className="space-y-2">
                    {eligibleDiscounts.map((d) => (
                      <div key={d.id} className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div>
                            <span className="font-semibold text-emerald-800">{d.label}</span>
                            {d.labelVi && <span className="ml-1.5 text-sm text-emerald-700">— {d.labelVi}</span>}
                          </div>
                          <span className="font-semibold text-emerald-700">−{formatCurrency(d.amountVnd)}/month</span>
                        </div>
                        <p className="mt-1 text-xs text-emerald-600">{d.description}{d.descriptionVi ? ` / ${d.descriptionVi}` : ""}</p>
                        {d.durationMonths != null && (
                          <p className="mt-0.5 text-xs text-emerald-500">Applied for first {d.durationMonths} month{d.durationMonths !== 1 ? "s" : ""}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                {/* Discounts that don't pass auto-rules */}
                {allDiscounts.filter((d) => d.enabled && !checkAutoRules(d, form, selectedBedTier)).length > 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Other discounts</p>
                    {allDiscounts.filter((d) => d.enabled && !checkAutoRules(d, form, selectedBedTier)).map((d) => (
                      <div key={d.id} className="text-xs text-slate-400">
                        <span className="font-medium text-slate-600">{d.label}</span> — {d.description}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"><span>Deposit</span><span className="font-semibold text-slate-900">{formatCurrency(pricingSummary.deposit)}</span></div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"><span>First payment estimate</span><span className="font-semibold text-slate-900">{formatCurrency(pricingSummary.firstPayment)}</span></div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"><span>Availability</span><span className="font-semibold text-slate-900">{selectedBed.status === "available_now" ? "Now" : selectedBed.availableOn}</span></div>
              </div>
            ) : (
              <div className="mt-4 rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">Select a bed to see the calculated monthly share, deposit, and first payment estimate.</div>
            )}
          </section>
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <p className="text-sm font-semibold text-slate-900">Branch details</p>
            {selectedBranch ? (
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="font-semibold text-slate-900">{selectedBranch.label}</p><p className="mt-1">{selectedBranch.address}</p></div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">Showing only beds that match {form.sex === "female" ? "Female / Nu" : form.sex === "male" ? "Male / Nam" : "..."} and are available now or within 30 days.</div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Pick a branch to show address and availability notes here.</div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
