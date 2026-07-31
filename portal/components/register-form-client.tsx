"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { API_BASE_URL } from "../lib/api-base-url";
import { getBedTier } from "../lib/branch-bed-layout";
import { D2_NEW_REGISTRATION_CLOSED, getD2ClosureNotice, isBranchClosedForNewRegistrations } from "../lib/branch-closure";
import { formatCozoroDateTime } from "../lib/date-format";

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
  selectionMode: "manual" | "automatic";
  stackMode: "stackable" | "exclusive";
  enabled: boolean;
  /** Server: omit or false for everyone; hidden for returning emails when true. */
  firstContractOnly?: boolean;
};

type BranchPricingSettings = {
  branchId: string;
  cleaningOptOutFeeVnd: number;
  parkingFeeVnd: number;
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
        parkingFeeVnd: number;
        parkingOptions: Array<{ id: string; labelEn: string; labelVi: string; feeVnd: number }>;
        cleaningOptOutFeeVnd: number;
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
  contractCleaningOptOut: boolean;
  hasMotorbike: boolean;
  motorbikePlate: string;
  /** Selected motorbike parking tier id from `pricing.parkingOptions` */
  parkingOptionId: string;
  idScanFile: File | null;
  agreed: boolean;
  /** Friend's referral code (CZ… or MÃ HD). */
  referralCode: string;
};

const branchOptions: Array<{ id: BranchId; label: string; address: string }> = [
  { id: "D2", label: "D2", address: "491 Hau Giang, Ward 11, District 6" },
  { id: "D7", label: "D7", address: "7A/19/28 Thanh Thai, Ward 14, District 10" }
];

const paymentOptions = [
  { value: "Moi thang", labelEn: "Monthly", labelVi: "Mỗi tháng" },
  { value: "Moi 03 thang", labelEn: "Every 3 months (−500,000 VND)", labelVi: "Mỗi 3 tháng (giảm 500.000 VND)" },
  { value: "Moi 06 thang", labelEn: "Every 6 months (7th month free)", labelVi: "Mỗi 6 tháng (miễn tháng thứ 7)" }
];
const statusOptions = ["Sinh vien", "Hoc sinh", "Sau dai hoc", "Dang di lam", "Khac"];

const T = {
  en: {
    // Hero
    heroLabel: "CozoroHome Registration",
    heroTitle: "Register a bed and prepare the contract online.",
    heroSubtitle: "Choose branch and sex first. The page only shows beds available now or within the next 30 days, and pricing is auto-filled from current CozoroHome data.",
    // Section headings
    sectionBranchBed: "1. Branch and bed",
    bedsLoadNote: "Beds load only after branch and sex are selected.",
    // Sex / Branch
    sexLabel: "Sex",
    sexPlaceholder: "Choose sex",
    sexFemale: "Female / Nu",
    sexMale: "Male / Nam",
    branchLabel: "Branch",
    branchPlaceholder: "Choose branch",
    d2FemaleOnly: "D2 is female-only.",
    // Bed loading states
    selectSexBranch: "Select sex and branch to load available beds.",
    loadingBeds: "Loading available beds...",
    bedsFound: (n: number) => `${n} matching bed${n === 1 ? "" : "s"} found`,
    synced: "Synced",
    roomLabel: "Room",
    topBunk: "Top bunk",
    middleBunk: "Middle bunk",
    bottomBunk: "Bottom bunk",
    availableNow: "Available now",
    availableFrom: "Available from",
    monthlyShare: "Monthly share:",
    depositLabel: "Deposit:",
    nowBadge: "Now",
    soonBadge: "Soon",
    // Personal info
    fullName: "Full name",
    email: "Email",
    phone: "Phone",
    dateOfBirth: "Date of birth",
    permanentAddress: "Permanent address",
    governmentId: "CCCD / Passport",
    issueDate: "Issue date",
    issuePlace: "Issue place",
    contractStartDate: "Contract start date",
    contractLengthMonths: "Contract length (months)",
    paymentFrequency: "Payment frequency",
    contractEndDate: "Calculated contract end date",
    currentStatus: "Current status",
    currentStatusPlaceholder: "Choose current status",
    schoolOrWorkplace: "School or workplace",
    referralSource: "How did you hear about CozoroHome?",
    emergencyPhone: "Emergency phone",
    additionalTerms: "Additional terms or notes",
    additionalTermsHint:
      "When you submit, every promotion you qualified for above is copied into this block for the contract (you can still add your own notes below).",
    // Pricing sidebar
    pricingSummary: "Pricing summary",
    selectBedPrompt: "Select a bed to see the calculated monthly share, deposit, and first payment estimate.",
    monthlyShareLabel: "Monthly share",
    depositSideLabel: "Deposit",
    firstPaymentEstimate: "First payment estimate",
    availability: "Availability",
    availableDiscountsTitle: "Available discounts — tick to claim",
    priorResidentDiscountsNote:
      "This email already has a CozoroHome record. First-contract-only promotions are not shown. Renewals use the in-portal extension flow; if you are re-applying, contact staff.",
    proofNotice: "Proof will be requested before your contract is signed.",
    perMonth: "/month",
    appliedForFirst: "Applied for first",
    months: "months",
    month: "month",
    iConfirm: "I confirm:",
    myStatusIs: "My status is:",
    myOccupationIs: "My occupation is:",
    referredByResident: "I was referred by a current resident",
    otherDiscounts: "Other discounts",
    cleaningFeeTitle: "Cleaning opt-out for full contract",
    cleaningFeeDesc: (fee: number) => `Pay an extra ${fee.toLocaleString("vi-VN")} VND/month as a cleaning fee to be exempt from cleaning assignments for the rest of your contract.`,
    addCleaningFee: (fee: number) => `Add cleaning fee (+${fee.toLocaleString("vi-VN")} VND/month)`,
    cleaningFeeLabel: "Cleaning fee",
    paymentFrequencyDiscount3mo: "3-month payment: −500,000 VND discount",
    paymentFrequencyDiscount6mo: "6-month payment: 7th month free",
    paymentFrequencyDiscountLabel: "Payment frequency discount",
    motorbikeParkingTitle: "Motorbike parking",
    hasMotorbikeLabel: "I have a motorbike and want a parking spot",
    motorbikePlateLabel: "Motorbike licence plate",
    motorbikePlateRequired: "Licence plate is required if you request parking.",
    parkingFeeLabel: "Parking fee",
    selectParkingPlan: "Choose a parking plan",
    selectParkingPlanError: "Please choose one of the parking plans.",
    parkingFrom: "From",
    idScanLabel: "ID / Passport scan",
    idScanDesc: "Upload a scan or photo of your CCCD or Passport (required).",
    idScanUploading: "Uploading…",
    idScanUploaded: "Uploaded",
    surcharge12Title: "Short-term contract surcharge: +12%",
    surcharge8Title: "Short-term contract surcharge: +8%",
    surcharge12Desc: "Contracts of 1–3 months carry a 12% monthly surcharge over the base rate.",
    surcharge8Desc: "Contracts of 4–5 months carry an 8% monthly surcharge over the base rate.",
    surchargeLabel: "Short-term contract surcharge",
    hostelRedirectTitle: "For stays under 1 month",
    hostelRedirectDesc: "Contracts shorter than 1 month are treated as short-term stays. Please book through our hostel portal.",
    hostelRedirectBtn: "Go to hostel booking",
    // Branch details
    branchDetailsTitle: "Branch details",
    pickBranchPrompt: "Pick a branch to show address and availability notes here.",
    showingBeds: (sex: string) => `Showing only beds that match ${sex} and are available now or within 30 days.`,
    // Agreement / submit
    agreeHouseRules: "I have read, agree with, and will follow the Cozoro dorm house rules.",
    submitting: "Submitting...",
    submitRegistration: "Submit registration",
    alreadyHaveAccount: "Already have an account? Sign in",
    referralProgramBanner: "Referral program",
    referralProgramIntro: (discount: string, cNew: string, cRef: string) =>
      `First-time registration: ${discount} off your first payment (one-time), ${cNew} coins for you, ${cRef} coins for your friend who referred you.`,
    referralCodeLabel: "Referral code (optional)",
    referralCodePlaceholder: "e.g. CZ… or contract code",
    referralChecking: "Checking code…",
    referralValid: "Code accepted",
    referralInvalid: "Invalid code or program inactive",
    referralFirstPaymentOff: (n: string) => `Referral (one-time): −${n} from first payment estimate`,
    // Validation errors
    chooseSexBranchBed: "Please choose sex, branch, and an available bed first.",
    invalidContractDate: "Please provide a valid contract start date and contract length.",
    agreeFirst: "You need to confirm the house rules before submitting.",
  },
  vi: {
    // Hero
    heroLabel: "Đăng ký CozoroHome",
    heroTitle: "Đặt giường và chuẩn bị hợp đồng trực tuyến.",
    heroSubtitle: "Chọn chi nhánh và giới tính trước. Trang chỉ hiển thị các giường trống hiện tại hoặc trong vòng 30 ngày tới, giá được tự động điền từ dữ liệu CozoroHome.",
    // Section headings
    sectionBranchBed: "1. Chi nhánh và giường",
    bedsLoadNote: "Giường chỉ tải sau khi chọn chi nhánh và giới tính.",
    // Sex / Branch
    sexLabel: "Giới tính",
    sexPlaceholder: "Chọn giới tính",
    sexFemale: "Nữ / Female",
    sexMale: "Nam / Male",
    branchLabel: "Chi nhánh",
    branchPlaceholder: "Chọn chi nhánh",
    d2FemaleOnly: "D2 chỉ dành cho nữ.",
    // Bed loading states
    selectSexBranch: "Chọn giới tính và chi nhánh để tải danh sách giường.",
    loadingBeds: "Đang tải danh sách giường...",
    bedsFound: (n: number) => `Tìm thấy ${n} giường phù hợp`,
    synced: "Cập nhật lúc",
    roomLabel: "Phòng",
    topBunk: "Tầng trên",
    middleBunk: "Tầng giữa",
    bottomBunk: "Tầng dưới",
    availableNow: "Còn trống",
    availableFrom: "Trống từ ngày",
    monthlyShare: "Tiền phòng:",
    depositLabel: "Tiền cọc:",
    nowBadge: "Ngay",
    soonBadge: "Sắp",
    // Personal info
    fullName: "Họ và tên",
    email: "Email",
    phone: "Số điện thoại",
    dateOfBirth: "Ngày sinh",
    permanentAddress: "Địa chỉ thường trú",
    governmentId: "CCCD / Hộ chiếu",
    issueDate: "Ngày cấp",
    issuePlace: "Nơi cấp",
    contractStartDate: "Ngày bắt đầu hợp đồng",
    contractLengthMonths: "Thời hạn hợp đồng (tháng)",
    paymentFrequency: "Kỳ thanh toán",
    contractEndDate: "Ngày kết thúc hợp đồng (tự tính)",
    currentStatus: "Tình trạng hiện tại",
    currentStatusPlaceholder: "Chọn tình trạng",
    schoolOrWorkplace: "Trường học hoặc nơi làm việc",
    referralSource: "Bạn biết CozoroHome qua đâu?",
    emergencyPhone: "Số điện thoại khẩn cấp",
    additionalTerms: "Điều khoản hoặc ghi chú thêm",
    additionalTermsHint:
      "Khi gửi đơn, toàn bộ khuyến mãi bạn đủ điều kiện ở phần trên sẽ được ghi vào đây cho hợp đồng (bạn vẫn có thể thêm ghi chú của mình bên dưới).",
    // Pricing sidebar
    pricingSummary: "Tóm tắt chi phí",
    selectBedPrompt: "Chọn giường để xem tiền phòng, tiền cọc và ước tính thanh toán đầu tiên.",
    monthlyShareLabel: "Tiền phòng / tháng",
    depositSideLabel: "Tiền cọc",
    firstPaymentEstimate: "Ước tính thanh toán lần đầu",
    availability: "Tình trạng",
    availableDiscountsTitle: "Ưu đãi có thể nhận — tick để xác nhận",
    priorResidentDiscountsNote:
      "Email này đã có hồ sơ tại CozoroHome. Các ưu đãi chỉ dành cho hợp đồng đầu tiên sẽ không hiển thị. Gia hạn vui lòng dùng chức năng trong cổng thông tin; nếu đăng ký lại, vui lòng liên hệ quản lý.",
    proofNotice: "Bằng chứng sẽ được yêu cầu trước khi ký hợp đồng.",
    perMonth: "/tháng",
    appliedForFirst: "Áp dụng trong",
    months: "tháng đầu",
    month: "tháng đầu",
    iConfirm: "Tôi xác nhận:",
    myStatusIs: "Tình trạng của tôi là:",
    myOccupationIs: "Nghề nghiệp của tôi là:",
    referredByResident: "Tôi được giới thiệu bởi cư dân hiện tại",
    otherDiscounts: "Ưu đãi khác",
    cleaningFeeTitle: "Miễn vệ sinh cho toàn bộ hợp đồng",
    cleaningFeeDesc: (fee: number) => `Trả thêm ${fee.toLocaleString("vi-VN")} VND/tháng như phí vệ sinh để được miễn các lịch trực vệ sinh trong suốt thời hạn hợp đồng còn lại.`,
    addCleaningFee: (fee: number) => `Thêm phí vệ sinh (+${fee.toLocaleString("vi-VN")} VND/tháng)`,
    cleaningFeeLabel: "Phí vệ sinh",
    paymentFrequencyDiscount3mo: "Thanh toán 3 tháng: giảm 500.000 VND",
    paymentFrequencyDiscount6mo: "Thanh toán 6 tháng: được miễn tháng thứ 7",
    paymentFrequencyDiscountLabel: "Ưu đãi kỳ thanh toán",
    motorbikeParkingTitle: "Gởi xe máy",
    hasMotorbikeLabel: "Tôi có xe máy và muốn đăng ký gởi xe",
    motorbikePlateLabel: "Biển số xe máy",
    motorbikePlateRequired: "Vui lòng nhập biển số xe nếu muốn đăng ký gởi xe.",
    parkingFeeLabel: "Phí gởi xe",
    selectParkingPlan: "Chọn gói gửi xe",
    selectParkingPlanError: "Vui lòng chọn một gói gửi xe.",
    parkingFrom: "Từ",
    idScanLabel: "Ảnh CMND / Căn cước công dân",
    idScanDesc: "Tải lên ảnh chụp CMND hoặc Hộ chiếu của bạn (bắt buộc).",
    idScanUploading: "Đang tải lên…",
    idScanUploaded: "Đã tải lên",
    surcharge12Title: "Phụ phí hợp đồng ngắn hạn: +12%",
    surcharge8Title: "Phụ phí hợp đồng ngắn hạn: +8%",
    surcharge12Desc: "Hợp đồng 1–3 tháng có phụ phí 12%/tháng so với giá cơ bản.",
    surcharge8Desc: "Hợp đồng 4–5 tháng có phụ phí 8%/tháng so với giá cơ bản.",
    surchargeLabel: "Phụ phí hợp đồng ngắn hạn",
    hostelRedirectTitle: "Ở dưới 1 tháng",
    hostelRedirectDesc: "Hợp đồng dưới 1 tháng được xử lý như lưu trú ngắn hạn. Vui lòng đặt phòng qua cổng hostel.",
    hostelRedirectBtn: "Đặt phòng hostel",
    // Branch details
    branchDetailsTitle: "Thông tin chi nhánh",
    pickBranchPrompt: "Chọn chi nhánh để xem địa chỉ và thông tin phòng.",
    showingBeds: (sex: string) => `Chỉ hiển thị giường phù hợp với ${sex} và còn trống trong vòng 30 ngày.`,
    // Agreement / submit
    agreeHouseRules: "Tôi đã đọc, đồng ý và sẽ tuân thủ nội quy nhà ở Cozoro.",
    submitting: "Đang gửi...",
    submitRegistration: "Gửi đăng ký",
    alreadyHaveAccount: "Đã có tài khoản? Đăng nhập",
    referralProgramBanner: "Chương trình giới thiệu",
    referralProgramIntro: (discount: string, cNew: string, cRef: string) =>
      `Đăng ký lần đầu: giảm ${discount} trên tổng thanh toán lần đầu (một lần), ${cNew} coins cho bạn, ${cRef} coins cho người giới thiệu.`,
    referralCodeLabel: "Mã giới thiệu (không bắt buộc)",
    referralCodePlaceholder: "VD: CZ… hoặc mã HĐ",
    referralChecking: "Đang kiểm tra mã…",
    referralValid: "Mã hợp lệ",
    referralInvalid: "Mã không hợp lệ hoặc chương trình tắt",
    referralFirstPaymentOff: (n: string) => `Giới thiệu (một lần): −${n} trên thanh toán lần đầu (ước tính)`,
    // Validation errors
    chooseSexBranchBed: "Vui lòng chọn giới tính, chi nhánh và giường trống trước.",
    invalidContractDate: "Vui lòng nhập ngày bắt đầu hợp đồng và thời hạn hợp lệ.",
    agreeFirst: "Bạn cần xác nhận nội quy trước khi gửi đăng ký.",
  }
} as const;
type Lang = keyof typeof T;

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
  contractCleaningOptOut: false,
  hasMotorbike: false,
  motorbikePlate: "",
  parkingOptionId: "",
  idScanFile: null,
  agreed: false,
  referralCode: ""
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);
}

/** Lines for sheet columns e.g. "Khoản ưu đãi…" / Điều khoản bổ sung — lists discounts the resident actually qualified for. */
function buildClaimedDiscountsContractLines(discounts: DiscountRule[]): string {
  if (discounts.length === 0) {
    return "";
  }
  const lines = discounts.map((d) => {
    const title = d.labelVi?.trim() ? `${d.labelVi.trim()} (${d.label})` : d.label;
    if (d.durationMonths == null) {
      return `• ${title}: ${formatCurrency(d.amountVnd)}/tháng (định kỳ · recurring)`;
    }
    return `• ${title}: ${formatCurrency(d.amountVnd)} × ${d.durationMonths} tháng đầu · first ${d.durationMonths} mo`;
  });
  return ["Khuyến mãi đã chọn / Selected discounts:", ...lines].join("\n");
}

function mergeAdditionalTermsForContract(userNotes: string, discounts: DiscountRule[]): string | undefined {
  const autoBlock = buildClaimedDiscountsContractLines(discounts);
  const manual = userNotes.trim();
  if (!autoBlock && !manual) {
    return undefined;
  }
  if (!autoBlock) {
    return manual || undefined;
  }
  if (!manual) {
    return autoBlock;
  }
  return `${autoBlock}\n\n${manual}`;
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
    return 7;
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

type TStrings = { myStatusIs: string; myOccupationIs: string; referredByResident: string; iConfirm: string };
function describeAttestationRule(rule: EligibilityRule, t: TStrings): string {
  if (rule.type === "status") return `${t.myStatusIs} ${("values" in rule ? rule.values : []).join(" or ")}`;
  if (rule.type === "occupation") return `${t.myOccupationIs} ${("values" in rule ? rule.values : []).join(", ")}`;
  if (rule.type === "referral") return t.referredByResident;
  return rule.type;
}

function checkEligibility(discount: DiscountRule, form: FormState, selectedBedTier?: "top" | "middle" | "bottom", claimedIds?: Set<string>): boolean {
  if (!checkAutoRules(discount, form, selectedBedTier)) return false;
  const requiresClaim = discount.selectionMode === "manual" || getAttestationRules(discount).length > 0;
  if (requiresClaim && !claimedIds?.has(discount.id)) return false;
  return true;
}

function resolveCompatibleDiscounts(discounts: DiscountRule[]): DiscountRule[] {
  const exclusiveDiscounts = discounts
    .filter((discount) => discount.stackMode === "exclusive")
    .sort((left, right) => {
      if (right.amountVnd !== left.amountVnd) {
        return right.amountVnd - left.amountVnd;
      }
      return left.id.localeCompare(right.id);
    });

  if (exclusiveDiscounts.length > 0) {
    return [exclusiveDiscounts[0]];
  }

  return discounts;
}

export function RegisterFormClient() {
  const [lang, setLang] = useState<Lang>("en");
  const t = T[lang];
  const [form, setForm] = useState<FormState>(initialFormState);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [availabilityError, setAvailabilityError] = useState("");
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [allDiscounts, setAllDiscounts] = useState<DiscountRule[]>([]);
  const [priorResidentContract, setPriorResidentContract] = useState(false);
  const [claimedDiscountIds, setClaimedDiscountIds] = useState<Set<string>>(new Set());
  const [branchPricingSettings, setBranchPricingSettings] = useState<BranchPricingSettings[]>([]);
  const [idScanUploading, setIdScanUploading] = useState(false);
  const [idScanFileName, setIdScanFileName] = useState("");
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isSigning, setIsSigning] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  // House rules modal state
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [rulesStep, setRulesStep] = useState(0);
  const [showFirstPaymentDetail, setShowFirstPaymentDetail] = useState(false);
  const [referralMarketing, setReferralMarketing] = useState<{
    enabled: boolean;
    fullOfferContractMonths: number;
    newRegistrantDiscountVnd: number;
    newRegistrantCoins: number;
    referrerCoins: number;
    headlineEn: string;
    headlineVi: string;
    detailsEn: string;
    detailsVi: string;
  } | null>(null);
  const [referralLookup, setReferralLookup] = useState<"idle" | "checking" | "ok" | "bad">("idle");

  useEffect(() => {
    const email = form.email.trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const controller = new AbortController();
    const delayMs = emailOk ? 400 : 0;
    const timer = window.setTimeout(() => {
      const qs = emailOk ? `?email=${encodeURIComponent(email.toLowerCase())}` : "";
      void fetch(`${API_BASE_URL}/api/public/pricing-discounts${qs}`, { signal: controller.signal })
        .then((r) => r.json())
        .then(
          (data: {
            discounts?: DiscountRule[];
            branchSettings?: BranchPricingSettings[];
            priorResidentContract?: boolean;
          }) => {
            if (data.discounts) setAllDiscounts(data.discounts);
            if (data.branchSettings) setBranchPricingSettings(data.branchSettings);
            setPriorResidentContract(Boolean(data.priorResidentContract));
          }
        )
        .catch(() => {});
    }, delayMs);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [form.email]);

  useEffect(() => {
    const allowed = new Set(allDiscounts.map((d) => d.id));
    setClaimedDiscountIds((prev) => {
      const next = new Set([...prev].filter((id) => allowed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [allDiscounts]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/public/referral-program`)
      .then((r) => r.json())
      .then(
        (data: {
          enabled?: boolean;
          fullOfferContractMonths?: number;
          newRegistrantDiscountVnd?: number;
          newRegistrantCoins?: number;
          referrerCoins?: number;
          headlineEn?: string;
          headlineVi?: string;
          detailsEn?: string;
          detailsVi?: string;
        }) => {
          setReferralMarketing({
            enabled: Boolean(data.enabled),
            fullOfferContractMonths: Math.min(36, Math.max(1, Number(data.fullOfferContractMonths) || 6)),
            newRegistrantDiscountVnd: Number(data.newRegistrantDiscountVnd) || 0,
            newRegistrantCoins: Number(data.newRegistrantCoins) || 0,
            referrerCoins: Number(data.referrerCoins) || 0,
            headlineEn: data.headlineEn ?? "",
            headlineVi: data.headlineVi ?? "",
            detailsEn: data.detailsEn ?? "",
            detailsVi: data.detailsVi ?? ""
          });
        }
      )
      .catch(() => setReferralMarketing(null));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const q = new URLSearchParams(window.location.search).get("ref");
    if (q) {
      setForm((cur) => ({ ...cur, referralCode: q }));
    }
  }, []);

  useEffect(() => {
    const code = form.referralCode.trim();
    if (!code) {
      setReferralLookup("idle");
      return;
    }
    if (referralMarketing === null) {
      return;
    }
    if (!referralMarketing.enabled) {
      setReferralLookup("bad");
      return;
    }
    setReferralLookup("checking");
    const tmr = window.setTimeout(() => {
      void fetch(`${API_BASE_URL}/api/public/referral/lookup?code=${encodeURIComponent(code)}`)
        .then((r) => r.json())
        .then((data: { ok?: boolean }) => {
          setReferralLookup(data.ok ? "ok" : "bad");
        })
        .catch(() => setReferralLookup("bad"));
    }, 450);
    return () => window.clearTimeout(tmr);
  }, [form.referralCode, referralMarketing]);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function getCanvasPoint(event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const point = "touches" in event ? event.touches[0] : event;
    if (!point) return null;
    return {
      x: point.clientX - rect.left,
      y: point.clientY - rect.top
    };
  }

  function startSignature(event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const ctx = signatureCanvasRef.current?.getContext("2d");
    const point = getCanvasPoint(event);
    if (!ctx || !point) return;
    setIsSigning(true);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function drawSignature(event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!isSigning) return;
    const ctx = signatureCanvasRef.current?.getContext("2d");
    const point = getCanvasPoint(event);
    if (!ctx || !point) return;
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    setHasSignature(true);
  }

  function stopSignature() {
    setIsSigning(false);
    signatureCanvasRef.current?.getContext("2d")?.beginPath();
  }

  function clearSignature() {
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
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

  useEffect(() => {
    if (!availability || !form.bedNumber) {
      return;
    }
    const numericBed = Number(form.bedNumber);
    const bed = availability.rooms
      .flatMap((room) => room.beds.map((b) => ({ ...b, room: room.room, floor: room.floor })))
      .find((b) => b.bedNumber === numericBed);
    const opts = bed?.pricing.parkingOptions ?? [];
    if (opts.length === 0) {
      return;
    }
    setForm((f) => {
      if (opts.some((o) => o.id === f.parkingOptionId)) {
        return f;
      }
      return { ...f, parkingOptionId: opts[0]!.id };
    });
  }, [availability, form.bedNumber]);

  const contractMonths = Number(form.contractMonths);

  // Short-stay surcharge: 1-3 months = 12%, 4-5 months = 8%, 6+ = 0%
  const tenureSurchargeRate = useMemo(() => {
    if (contractMonths >= 1 && contractMonths <= 3) return 0.12;
    if (contractMonths >= 4 && contractMonths <= 5) return 0.08;
    return 0;
  }, [contractMonths]);

  const contractEndDate = useMemo(
    () => addMonthsMinusOneDay(form.contractStartDate, contractMonths),
    [form.contractStartDate, contractMonths]
  );
  const selectedBedTier = useMemo(
    () => (form.bedNumber && form.branchId ? getBedTier(form.branchId, Number(form.bedNumber)) : null) ?? undefined,
    [form.branchId, form.bedNumber]
  );
  // Discounts where auto-rules pass — these are shown as claimable if they have attestation rules
  const autoPassDiscounts = useMemo(
    () => allDiscounts.filter((d) => d.enabled && checkAutoRules(d, form, selectedBedTier)),
    [allDiscounts, form.contractMonths, form.sex, selectedBedTier]
  );
  const activeDiscountCandidates = useMemo(
    () => autoPassDiscounts.filter((d) => checkEligibility(d, form, selectedBedTier, claimedDiscountIds)),
    [autoPassDiscounts, form, selectedBedTier, claimedDiscountIds]
  );
  // Fully eligible = auto-rules pass + attestation claimed (or no attestation rules), then stacking rules are applied
  const eligibleDiscounts = useMemo(
    () => resolveCompatibleDiscounts(activeDiscountCandidates),
    [activeDiscountCandidates]
  );
  const activeExclusiveDiscount = useMemo(
    () => eligibleDiscounts.find((discount) => discount.stackMode === "exclusive") ?? null,
    [eligibleDiscounts]
  );
  // Discounts that pass auto-rules and must be explicitly selected by the resident
  const claimableDiscounts = useMemo(
    () => autoPassDiscounts.filter((d) => d.selectionMode === "manual" || getAttestationRules(d).length > 0),
    [autoPassDiscounts]
  );

  // Recurring discounts apply every month; one-time discounts apply only for durationMonths months
  const recurringDiscounts = eligibleDiscounts.filter((d) => d.durationMonths == null);
  const oneTimeDiscounts = eligibleDiscounts.filter((d) => d.durationMonths != null);
  const totalRecurringDiscount = recurringDiscounts.reduce((sum, d) => sum + d.amountVnd, 0);
  const totalMonthlyDiscount = eligibleDiscounts.reduce((sum, d) => sum + d.amountVnd, 0);

  const selectedBedCleaningOptOutFee = selectedBed?.pricing.cleaningOptOutFeeVnd ?? 100000;
  const selectedParkingFeeVnd = useMemo(() => {
    if (!selectedBed || !form.hasMotorbike) {
      return 0;
    }
    const opts = selectedBed.pricing.parkingOptions ?? [];
    const pick = opts.find((o) => o.id === form.parkingOptionId) ?? opts[0];
    return pick?.feeVnd ?? selectedBed.pricing.parkingFeeVnd ?? 0;
  }, [selectedBed, form.hasMotorbike, form.parkingOptionId]);
  const tenureSurchargeVnd = useMemo(() => {
    if (!selectedBed) return 0;
    return Math.round(selectedBed.pricing.monthlyPrice * tenureSurchargeRate);
  }, [selectedBed, tenureSurchargeRate]);
  const pricingSummary = selectedBed
    ? (() => {
        const discountedMonthlyPrice = Math.max(0, selectedBed.pricing.monthlyPrice - totalRecurringDiscount);
        const parkingFee = form.hasMotorbike ? selectedParkingFeeVnd : 0;
        const cleaningFee = form.contractCleaningOptOut ? selectedBedCleaningOptOutFee : 0;
        // Full recurring monthly cost (bed after recurring discounts + fees)
        const monthlyRecurringTotal = discountedMonthlyPrice + tenureSurchargeVnd + parkingFee + cleaningFee;
        // Payment frequency discount spread over months for average display:
        // 6+1 plan: 7× gross − 1 month free → net 6 months over 7 months of coverage → ~1/7 off per month
        // 3-month plan: flat 500k off
        const paymentFreqMonthlyDiscount = form.paymentFrequency.includes("06")
          ? Math.round(monthlyRecurringTotal / 7)
          : form.paymentFrequency.includes("03")
            ? Math.round(500000 / 3)
            : 0;
        const multiplier = getFirstPaymentMultiplier(form.paymentFrequency);
        const oneTimeFlatDiscount = oneTimeDiscounts.reduce(
          (sum, d) => sum + d.amountVnd * Math.min(d.durationMonths!, multiplier),
          0
        );
        // 6-month: 7th month free = subtract full monthly total once; 3-month: flat 500k
        const freqDiscount = form.paymentFrequency.includes("06")
          ? monthlyRecurringTotal
          : form.paymentFrequency.includes("03")
            ? 500000
            : 0;
        const firstPaymentBeforeReferral =
          monthlyRecurringTotal * multiplier - oneTimeFlatDiscount - freqDiscount + selectedBed.pricing.deposit;
        const basisMonths = referralMarketing?.fullOfferContractMonths ?? 6;
        const referralScale =
          referralLookup === "ok" && referralMarketing?.enabled
            ? Math.min(1, contractMonths / Math.max(1, basisMonths))
            : 0;
        const scaledReferralDiscount =
          referralLookup === "ok" && referralMarketing?.enabled
            ? Math.floor(referralMarketing.newRegistrantDiscountVnd * referralScale)
            : 0;
        const referralFirstPaymentCut =
          referralLookup === "ok" && referralMarketing?.enabled
            ? Math.min(scaledReferralDiscount, firstPaymentBeforeReferral)
            : 0;
        return {
          monthlyPrice: selectedBed.pricing.monthlyPrice,
          deposit: selectedBed.pricing.deposit,
          firstPaymentBeforeReferral,
          referralFirstPaymentCut,
          discountedMonthlyPrice,
          cleaningFee,
          parkingFee,
          paymentFreqMonthlyDiscount,
          tenureSurchargeVnd,
          tenureSurchargeRate,
          oneTimeDiscounts,
          // Average monthly cost = recurring total minus the freq discount spread
          monthlyTotal: monthlyRecurringTotal - paymentFreqMonthlyDiscount,
          firstPayment: Math.max(0, firstPaymentBeforeReferral - referralFirstPaymentCut),
        };
      })()
    : null;

  async function uploadIdScan(file: File): Promise<string> {
    setIdScanUploading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/public/register/id-scan?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body: file
      });
      const data = await res.json() as { ok?: boolean; fileName?: string; error?: string };
      if (!res.ok || !data.fileName) throw new Error(data.error ?? "Upload failed");
      setIdScanFileName(data.fileName);
      return data.fileName;
    } finally {
      setIdScanUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");
    setSuccessMessage("");

    if (!form.sex || !form.branchId || !selectedBed || !pricingSummary) {
      setSubmitError(t.chooseSexBranchBed);
      return;
    }

    if (contractMonths < 1) {
      setSubmitError(t.hostelRedirectDesc);
      return;
    }

    if (!contractEndDate) {
      setSubmitError(t.invalidContractDate);
      return;
    }

    if (!form.agreed) {
      setSubmitError(t.agreeFirst);
      return;
    }

    if (!hasSignature) {
      setSubmitError(lang === "vi" ? "Vui lòng ký tên trước khi gửi đăng ký." : "Please sign before submitting your registration.");
      return;
    }

    if (form.hasMotorbike && !form.motorbikePlate.trim()) {
      setSubmitError(t.motorbikePlateRequired);
      return;
    }

    if (form.hasMotorbike) {
      const opts = selectedBed.pricing.parkingOptions ?? [];
      const ok = opts.length > 0 && opts.some((o) => o.id === form.parkingOptionId);
      if (!ok) {
        setSubmitError(t.selectParkingPlanError);
        return;
      }
    }

    const referralTrimmed = form.referralCode.trim();
    if (referralTrimmed && referralLookup !== "ok") {
      setSubmitError(
        lang === "vi"
          ? "Nhập mã giới thiệu hợp lệ hoặc để trống ô mã."
          : "Enter a valid referral code or clear the field."
      );
      return;
    }

    setSubmitting(true);

    try {
      // Upload ID scan first if provided
      let idScanUrl = idScanFileName || undefined;
      if (form.idScanFile && !idScanFileName) {
        idScanUrl = await uploadIdScan(form.idScanFile);
      }

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
          firstPaymentSubtotalBeforeReferral: referralTrimmed
            ? pricingSummary.firstPaymentBeforeReferral
            : undefined,
          paymentFrequency: form.paymentFrequency || undefined,
          currentStatus: form.currentStatus || undefined,
          schoolOrWorkplace: form.schoolOrWorkplace || undefined,
          referralSource: form.referralSource || undefined,
          emergencyPhone: form.emergencyPhone || undefined,
          additionalTerms: mergeAdditionalTermsForContract(form.additionalTerms, eligibleDiscounts),
          contractCleaningOptOut: form.contractCleaningOptOut,
          hasMotorbike: form.hasMotorbike,
          motorbikePlate: form.hasMotorbike ? form.motorbikePlate : undefined,
          parkingOptionId: form.hasMotorbike ? form.parkingOptionId : undefined,
          idScanUrl,
          clientSignatureDataUrl: signatureCanvasRef.current?.toDataURL("image/png"),
          clientSignatureTimestamp: new Date().toISOString(),
          referralCode: referralTrimmed || undefined,
          claimedDiscounts: eligibleDiscounts.map((d) => d.id)
        })
      });

      const data = (await response.json()) as {
        contractCode?: string;
        error?: string;
        referralCoinsWarning?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Unable to submit registration.");
      }

      setSuccessMessage(
        data.contractCode
          ? `Registration submitted for owner approval. Reference: ${data.contractCode}.${data.referralCoinsWarning ? ` Note: ${data.referralCoinsWarning}` : ""}`
          : `Registration submitted for owner approval.${data.referralCoinsWarning ? ` Note: ${data.referralCoinsWarning}` : ""}`
      );
      setReferralLookup("idle");
      setIdScanFileName("");
      clearSignature();
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

  const houseRules = lang === "vi" ? [
    { title: "1. Yên tĩnh – trật tự", body: "- Không tụ tập bạn bè uống rượu bia, liên hoan, mở nhạc to gây ồn ào, mất trật tự ảnh hưởng đến dân cư lân cận.\n- Nếu có nhu cầu hội họp tụ tập, vui lòng tới khu BBQ và đăng ký trước với ban quản lý tòa nhà nếu có tổ chức ăn uống.\n- Không tụ tập quá 05 người tại khu vực sảnh và hành lang.\n- Giữ yên lặng, đi nhẹ, nói khẽ vào buổi trưa và sau 9h tối; có quyền tắt đèn khu vực chung sau 22h.\n- Sử dụng tai nghe cá nhân.\n- Báo thức cá nhân phải tắt ngay và để âm lượng vừa đủ để nghe; nếu không thể nghe khi ngủ, vui lòng dùng vòng đeo tay rung báo thức.\n- Xe máy vui lòng gửi ở bãi xe tập trung. Phí để xe trước và trong cổng: 5.000đ/giờ khi để hơn 30 phút, 20.000đ khi để qua đêm (23h-7h)." },
    { title: "2. Ngăn nắp", body: "- Để giày dép vào tủ và kệ dép, không đi dép trong nhà.\n- Vật dụng cá nhân để không đúng quy định sẽ được xử lý như rác.\n- Đồ dùng cá nhân để gọn gàng tại giường, cất ngay sau khi sử dụng và không để tại khu vực chung.\n- Đồ dùng chung sử dụng xong phải vệ sinh sạch sẽ, để lại đúng vị trí và gọn gàng.\n- Thức ăn để trong tủ lạnh không được quá 05 ngày.\n- Tủ lạnh cần được dọn và xả định kỳ mỗi tháng; vui lòng tiêu thụ hết thực phẩm trước ngày xả tủ." },
    { title: "3. Sạch sẽ", body: "- Có ý thức giữ vệ sinh chung, tự dọn rác cá nhân.\n- Các loại rác có mùi phải bỏ ngay tại phòng gom rác của chung cư.\n- Không có người dọn vệ sinh mỗi ngày, vì vậy cư dân phải tự giữ gìn vệ sinh chung.\n- Tự đổ rác của mình hàng ngày. Dọn vệ sinh theo sự phân công theo chu kỳ tùy từng cơ sở, ít nhất 01 lần mỗi tháng.\n- Rác kích thước lớn hơn 40cm phải thu gọn và đem đến nơi tập kết rác quá cỡ của tòa nhà hoặc khu phố." },
    { title: "4. Bảo quản nhà", body: "- Không tự ý dán giấy, đóng đinh, gắn móc treo lên tường hoặc trần nhà.\n- Đem thêm nội thất cồng kềnh vào nhà phải xin phép bên A.\n- Giữ tường, trần, sàn nhà nguyên vẹn và sạch sẽ.\n- Giữ cẩn thận vách ngăn thạch cao nếu có.\n- Làm hỏng hoặc mất tài sản đã bàn giao phải bồi thường.\n- Cozoro Home hỗ trợ sửa chữa hỏng hóc nhưng có thể phát sinh phí nếu lỗi do người sử dụng gây ra." },
    { title: "5. Tuân thủ pháp luật – nội quy tòa nhà", body: "- Không tổ chức bất kỳ hình thức phạm pháp nào tại nhà như đánh bạc, mại dâm, hút chích...\n- Tuân thủ nội quy của tòa nhà; tuyệt đối không đi các tầng khác của tòa nhà ngoại trừ tầng gửi xe, tầng sảnh, tầng tiện ích và tầng căn hộ trong hợp đồng." },
    { title: "6. Đoàn kết – thân thiện", body: "- Không xích mích, trêu chọc, gây sự mất đoàn kết với các thành viên khác trong cùng một nhà.\n- Nếu có vấn đề không hài lòng với thành viên khác, vui lòng báo quản lý nhà hoặc BQT Cozoro Home để được giải quyết.\n- Có ý thức cộng đồng khi sử dụng tiện nghi chung như nhà vệ sinh, bếp, tủ lạnh, lò nướng.\n- Không để đồ ăn trong tủ lạnh quá 05 ngày, không lưu đồ ăn trong nồi quá 24 giờ, hạn chế sử dụng nhà vệ sinh quá 10 phút.\n- Cùng chia sẻ phòng tắm, phòng vệ sinh và phòng bếp trong nhà." },
    { title: "7. Tiết kiệm", body: "- Cozoro Dorm bao tiêu chi phí điện nước; vui lòng có ý thức tiết kiệm trong sử dụng.\n- Khi ra khỏi phòng sau cùng phải tắt đèn và máy lạnh.\n- Không bật máy lạnh khi mở cửa.\n- Nước ở vòi nước lọc chỉ dùng để uống." },
    { title: "8. An ninh", body: "- Ra vào đóng cửa chính.\n- Có camera an ninh tại khu vực chung." },
    { title: "9. Không hút thuốc", body: "- Tuyệt đối không hút thuốc lá trong khuôn viên Cozoro Dorm." },
    { title: "Chế tài", body: "- Bất kỳ cá nhân nào vi phạm các điều trên, Cozoro Home có quyền yêu cầu bồi thường hư hại đã gây ra và đơn phương chấm dứt hợp đồng.\n- Tiền đặt cọc và chi phí ở chưa sử dụng hết có thể không được hoàn trả theo quy định này." },
  ] : [
    { title: "1. Quiet hours and order", body: "- No loud parties, drinking gatherings, or music that disturbs neighbors.\n- If you need to gather, use the BBQ area and register with building management in advance for food events.\n- No gatherings of more than 5 people in the lobby or hallways.\n- Keep quiet at noon and after 9 PM; common-area lights may be turned off after 10 PM.\n- Use personal headphones.\n- Alarm clocks must be turned off immediately and kept at a reasonable volume; use a vibrating wrist device if needed.\n- Motorbikes must be parked in the designated parking area. Gate-area parking fees apply." },
    { title: "2. Tidiness", body: "- Store shoes on the shoe rack and do not wear sandals inside.\n- Personal belongings placed incorrectly may be treated as trash.\n- Keep personal items neat at your bed and out of shared areas.\n- Clean and return shared items to the proper place after use.\n- Food may not stay in the refrigerator for more than 5 days.\n- The refrigerator is emptied and defrosted monthly, so finish your food before the scheduled cleanup day." },
    { title: "3. Cleanliness", body: "- Keep shared spaces clean and remove your own trash.\n- Smelly trash must be taken directly to the building trash room.\n- There is no daily cleaner, so residents must maintain common cleanliness themselves.\n- Take out your own trash every day and follow assigned cleaning duties, at least once per month depending on the branch.\n- Large trash over 40 cm must be compacted and taken to the building or neighborhood oversized-trash area." },
    { title: "4. Protecting the property", body: "- Do not attach paper, nails, or hooks to walls or ceilings without permission.\n- Large additional furniture requires approval from the landlord side.\n- Keep walls, ceilings, and floors intact and clean.\n- Handle any drywall partition carefully.\n- Any lost or damaged handed-over property must be compensated.\n- Cozoro Home can help with repairs, but fees may apply if the resident caused the damage." },
    { title: "5. Legal and building compliance", body: "- No illegal activity is allowed, including gambling, prostitution, or drug use.\n- Follow all building rules and do not access floors other than parking, lobby, amenities, and the contracted apartment floor." },
    { title: "6. Friendly community living", body: "- Do not provoke conflict or create hostility with housemates.\n- If there is any issue with another resident, report it to house management or Cozoro Home management.\n- Use shared facilities responsibly, including bathrooms, kitchen, fridge, and oven.\n- Do not keep food in the fridge longer than 5 days, do not leave food in pots longer than 24 hours, and avoid using the bathroom for more than 10 minutes.\n- Respect shared use of bathrooms, toilets, and kitchen areas." },
    { title: "7. Saving utilities", body: "- Cozoro Dorm covers electricity and water, so please use them responsibly.\n- The last person leaving the room must turn off lights and air conditioning.\n- Do not run the air conditioner while the door is open.\n- Filtered-water taps are for drinking water only." },
    { title: "8. Security", body: "- Always close the main entrance when entering or leaving.\n- Security cameras are installed in common areas." },
    { title: "9. No smoking", body: "- Smoking is strictly forbidden anywhere inside the Cozoro Dorm premises." },
    { title: "Enforcement", body: "- Anyone violating these rules may be required to compensate for damages.\n- Cozoro Home may also terminate the contract unilaterally and may refuse to refund the deposit or unused stay fees under this policy." },
  ];
  const currentRule = houseRules[rulesStep];

  return (
    <div className="space-y-6">
      {/* House rules step modal */}
      {showRulesModal && currentRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{lang === "vi" ? "Nội quy" : "House Rules"} {rulesStep + 1}/{houseRules.length}</p>
              <div className="flex gap-1">
                {houseRules.map((_, i) => (
                  <span key={i} className={`h-1.5 w-6 rounded-full ${i <= rulesStep ? "bg-teal-500" : "bg-slate-200"}`} />
                ))}
              </div>
            </div>
            <h3 className="text-xl font-bold text-slate-900">{currentRule.title}</h3>
            <p className="whitespace-pre-line text-sm leading-6 text-slate-600">{currentRule.body}</p>
            <div className="flex justify-end gap-3 pt-2">
              {rulesStep > 0 && (
                <button type="button" onClick={() => setRulesStep((s) => s - 1)} className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  {lang === "vi" ? "Quay lại" : "Back"}
                </button>
              )}
              {rulesStep < houseRules.length - 1 ? (
                <button type="button" onClick={() => setRulesStep((s) => s + 1)} className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                  {lang === "vi" ? "Tiếp theo" : "Next"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    updateForm("agreed", true);
                    setShowRulesModal(false);
                  }}
                  className="rounded-full bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-500"
                >
                  {lang === "vi" ? "Tôi đồng ý & Ký" : "I agree & Sign"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="rounded-[2rem] bg-[linear-gradient(135deg,#0f766e_0%,#155e75_55%,#1e293b_100%)] px-6 py-8 text-white shadow-xl sm:px-8">
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100/80">{t.heroLabel}</p>
          <button
            type="button"
            onClick={() => setLang((l) => l === "en" ? "vi" : "en")}
            className="shrink-0 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
          >
            {lang === "en" ? "Tiếng Việt" : "English"}
          </button>
        </div>
        <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">{t.heroTitle}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-cyan-50/90 sm:text-base">
          {t.heroSubtitle}
        </p>
      </section>

      {referralMarketing?.enabled ? (
        <section className="rounded-[2rem] border border-emerald-300/80 bg-emerald-50 px-5 py-4 text-emerald-950 shadow-sm sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{t.referralProgramBanner}</p>
          <p className="mt-1 text-sm font-semibold">
            {lang === "vi" ? referralMarketing.headlineVi : referralMarketing.headlineEn}
          </p>
          <p className="mt-2 text-sm text-emerald-900/90">
            {lang === "vi" ? referralMarketing.detailsVi : referralMarketing.detailsEn}
          </p>
          <p className="mt-2 text-sm font-medium text-emerald-900">
            {t.referralProgramIntro(
              formatCurrency(referralMarketing.newRegistrantDiscountVnd),
              referralMarketing.newRegistrantCoins.toLocaleString("vi-VN"),
              referralMarketing.referrerCoins.toLocaleString("vi-VN")
            )}
          </p>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
        <form onSubmit={handleSubmit} className="space-y-6 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t.sectionBranchBed}</h2>
              <p className="mt-1 text-sm text-slate-500">{t.bedsLoadNote}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">{t.sexLabel}</span>
                <select value={form.sex} onChange={(event) => {
                  const sex = event.target.value as Sex | "";
                  // D2 is female-only — clear branch if male picks D2
                  if (sex === "male" && form.branchId === "D2") {
                    setForm((cur) => ({ ...cur, sex, branchId: "", bedNumber: "" }));
                  } else {
                    updateForm("sex", sex);
                  }
                }} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required>
                  <option value="">{t.sexPlaceholder}</option>
                  <option value="female">{t.sexFemale}</option>
                  <option value="male">{t.sexMale}</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">{t.branchLabel}</span>
                <select value={form.branchId} onChange={(event) => updateForm("branchId", event.target.value as BranchId | "")} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required>
                  <option value="">{t.branchPlaceholder}</option>
                  {branchOptions
                    .filter((branch) => !isBranchClosedForNewRegistrations(branch.id))
                    .filter((branch) => !(form.sex === "male" && branch.id === "D2"))
                    .map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.label} - {branch.address}</option>
                    ))}
                </select>
                {form.sex === "male" && <p className="text-xs text-slate-400 mt-1">{t.d2FemaleOnly}</p>}
              </label>
            </div>
            <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/80 p-4">
              {!form.sex || !form.branchId ? <p className="text-sm text-slate-500">{t.selectSexBranch}</p> : null}
              {loadingAvailability ? <p className="text-sm text-slate-500">{t.loadingBeds}</p> : null}
              {availabilityError ? <p className="text-sm text-rose-600">{availabilityError}</p> : null}
              {availability && availability.rooms.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-700">{t.bedsFound(availability.availableBeds)}</p>
                    <p className="text-xs text-slate-400">{t.synced} {formatCozoroDateTime(availability.syncedAt)}</p>
                  </div>
                  {availability.rooms.map((room) => (
                    <div key={`${room.floor}-${room.room}`} className="rounded-[1.25rem] border border-slate-200 bg-white p-4">
                      <p className="text-sm font-semibold text-slate-900">{t.roomLabel} {room.room}</p>
                      <p className="mb-3 text-xs text-slate-500">{room.floor}</p>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {room.beds.map((bed) => {
                          const isSelected = form.bedNumber === String(bed.bedNumber);
                          const tier = form.branchId ? getBedTier(form.branchId, bed.bedNumber) : null;
                          const tierLabel = tier === "top" ? t.topBunk : tier === "middle" ? t.middleBunk : tier === "bottom" ? t.bottomBunk : null;
                          const tierColor = tier === "top" ? "bg-sky-100 text-sky-700" : tier === "middle" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600";
                          return (
                            <button key={bed.bedNumber} type="button" onClick={() => updateForm("bedNumber", String(bed.bedNumber))} className={`rounded-[1.25rem] border px-4 py-3 text-left ${isSelected ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-slate-50 hover:border-teal-300 hover:bg-white"}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">Bed {bed.bedNumber}</p>
                                  {tierLabel && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${tierColor}`}>{tierLabel}</span>}
                                  <p className="mt-1 text-xs text-slate-500">{bed.status === "available_now" ? t.availableNow : `${t.availableFrom} ${bed.availableOn}`}</p>
                                </div>
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${bed.status === "available_now" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{bed.status === "available_now" ? t.nowBadge : t.soonBadge}</span>
                              </div>
                              <div className="mt-3 space-y-1 text-xs text-slate-600">
                                <p>{t.monthlyShare} {formatCurrency(bed.pricing.monthlyPrice)}</p>
                                <p>{t.depositLabel} {formatCurrency(bed.pricing.deposit)}</p>
                                {(() => {
                                  const po = bed.pricing.parkingOptions ?? [];
                                  if (po.length > 1) {
                                    const fees = po.map((p) => p.feeVnd);
                                    const lo = Math.min(...fees);
                                    const hi = Math.max(...fees);
                                    return (
                                      <p className="text-amber-800 font-medium">
                                        {t.parkingFrom} {formatCurrency(lo)}
                                        {hi !== lo ? ` – ${formatCurrency(hi)}` : ""}
                                        {t.perMonth}
                                      </p>
                                    );
                                  }
                                  if (bed.pricing.parkingFeeVnd > 0) {
                                    return (
                                      <p className="text-amber-800 font-medium">
                                        {t.parkingFeeLabel}: {formatCurrency(bed.pricing.parkingFeeVnd)}
                                        {t.perMonth}
                                      </p>
                                    );
                                  }
                                  return null;
                                })()}
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
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">{t.fullName}</span><input value={form.fullName} onChange={(event) => updateForm("fullName", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">{t.email}</span><input type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required /></label>
            {referralMarketing?.enabled ? (
              <div className="md:col-span-2 rounded-[1.5rem] border border-emerald-200 bg-emerald-50/50 p-4 space-y-2">
                <label className="space-y-2 block">
                  <span className="text-sm font-medium text-slate-700">{t.referralCodeLabel}</span>
                  <input
                    value={form.referralCode}
                    onChange={(event) => updateForm("referralCode", event.target.value.toUpperCase())}
                    placeholder={t.referralCodePlaceholder}
                    className="w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 font-mono text-sm outline-none focus:border-teal-500"
                    autoComplete="off"
                  />
                </label>
                <p className="min-h-[1.25rem] text-xs text-slate-600">
                  {referralLookup === "checking" ? t.referralChecking : null}
                  {referralLookup === "ok" ? (
                    <span className="font-medium text-emerald-700">{t.referralValid}</span>
                  ) : null}
                  {referralLookup === "bad" && form.referralCode.trim() ? (
                    <span className="text-rose-600">{t.referralInvalid}</span>
                  ) : null}
                </p>
              </div>
            ) : null}
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">{t.phone}</span><input value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">{t.dateOfBirth}</span><input type="date" value={form.dateOfBirth} onChange={(event) => updateForm("dateOfBirth", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2 md:col-span-2"><span className="text-sm font-medium text-slate-700">{t.permanentAddress}</span><input value={form.permanentAddress} onChange={(event) => updateForm("permanentAddress", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">{t.governmentId}</span><input type="text" inputMode="text" autoComplete="off" value={form.governmentId} onChange={(event) => updateForm("governmentId", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">{t.issueDate}</span><input type="date" value={form.idIssuedDate} onChange={(event) => updateForm("idIssuedDate", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2 md:col-span-2"><span className="text-sm font-medium text-slate-700">{t.issuePlace}</span><input value={form.idIssuedPlace} onChange={(event) => updateForm("idIssuedPlace", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">{t.contractStartDate}</span><input type="date" value={form.contractStartDate} onChange={(event) => updateForm("contractStartDate", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required /></label>
            <div className="space-y-2">
              <label className="space-y-2 block"><span className="text-sm font-medium text-slate-700">{t.contractLengthMonths}</span><input type="number" min={1} max={36} value={form.contractMonths} onChange={(event) => updateForm("contractMonths", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" required /></label>
              {contractMonths > 0 && contractMonths < 1 ? (
                <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 flex items-start gap-3">
                  <span className="text-rose-500 text-lg">🏨</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-rose-900">{t.hostelRedirectTitle}</p>
                    <p className="text-xs text-rose-700 mt-1">{t.hostelRedirectDesc}</p>
                    <a href="https://hostel.cozorohome.com" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block rounded-full bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-500">{t.hostelRedirectBtn}</a>
                  </div>
                </div>
              ) : tenureSurchargeRate > 0 ? (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
                  <span className="text-amber-500 text-lg">⚠️</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-900">{tenureSurchargeRate === 0.12 ? t.surcharge12Title : t.surcharge8Title}</p>
                    <p className="text-xs text-amber-700 mt-1">{tenureSurchargeRate === 0.12 ? t.surcharge12Desc : t.surcharge8Desc}</p>
                    {selectedBed && <p className="text-xs font-semibold text-amber-800 mt-1">+{formatCurrency(tenureSurchargeVnd)}{t.perMonth}</p>}
                  </div>
                </div>
              ) : null}
            </div>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">{t.paymentFrequency}</span><select value={form.paymentFrequency} onChange={(event) => updateForm("paymentFrequency", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white">{paymentOptions.map((opt) => <option key={opt.value} value={opt.value}>{lang === "vi" ? opt.labelVi : opt.labelEn}</option>)}</select></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">{t.contractEndDate}</span><input value={contractEndDate} readOnly className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-slate-700 outline-none" /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">{t.currentStatus}</span><select value={form.currentStatus} onChange={(event) => updateForm("currentStatus", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white"><option value="">{t.currentStatusPlaceholder}</option>{statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
            <label className="space-y-2 md:col-span-2"><span className="text-sm font-medium text-slate-700">{t.schoolOrWorkplace}</span><input value={form.schoolOrWorkplace} onChange={(event) => updateForm("schoolOrWorkplace", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">{t.referralSource}</span><input value={form.referralSource} onChange={(event) => updateForm("referralSource", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2"><span className="text-sm font-medium text-slate-700">{t.emergencyPhone}</span><input value={form.emergencyPhone} onChange={(event) => updateForm("emergencyPhone", event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" /></label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium text-slate-700">{t.additionalTerms}</span>
              <p className="text-xs text-slate-500">{t.additionalTermsHint}</p>
              <textarea
                value={form.additionalTerms}
                onChange={(event) => updateForm("additionalTerms", event.target.value)}
                rows={4}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-teal-500 focus:bg-white"
              />
            </label>
          </section>

          {/* Motorbike parking */}
          <section className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 space-y-4">
            <h2 className="text-base font-semibold text-slate-900">{t.motorbikeParkingTitle}</h2>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={form.hasMotorbike} onChange={(e) => { updateForm("hasMotorbike", e.target.checked); if (!e.target.checked) updateForm("motorbikePlate", ""); }} className="h-4 w-4 rounded border-slate-300 text-teal-600" />
              <span className="text-sm text-slate-700">{t.hasMotorbikeLabel}</span>
              {form.hasMotorbike && selectedBed && selectedParkingFeeVnd > 0 && (
                <span className="ml-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">+{formatCurrency(selectedParkingFeeVnd)}{t.perMonth}</span>
              )}
            </label>
            {form.hasMotorbike && selectedBed && (selectedBed.pricing.parkingOptions?.length ?? 0) > 1 ? (
              <div className="space-y-2 rounded-2xl border border-amber-200/80 bg-white p-4">
                <p className="text-sm font-medium text-slate-800">{t.selectParkingPlan}</p>
                <div className="space-y-2">
                  {(selectedBed.pricing.parkingOptions ?? []).map((opt) => (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                        form.parkingOptionId === opt.id ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-slate-50 hover:border-teal-200"
                      }`}
                    >
                      <input
                        type="radio"
                        name="parkingOption"
                        checked={form.parkingOptionId === opt.id}
                        onChange={() => updateForm("parkingOptionId", opt.id)}
                        className="h-4 w-4 border-slate-300 text-teal-600"
                      />
                      <span className="flex-1 text-slate-800">{lang === "vi" ? opt.labelVi : opt.labelEn}</span>
                      <span className="shrink-0 font-semibold text-amber-800">+{formatCurrency(opt.feeVnd)}{t.perMonth}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            {form.hasMotorbike && (
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">{t.motorbikePlateLabel} <span className="text-rose-500">*</span></span>
                <input value={form.motorbikePlate} onChange={(e) => updateForm("motorbikePlate", e.target.value)} placeholder="e.g. 59A1-12345" className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-teal-500 focus:bg-white" />
              </label>
            )}
          </section>

          {/* ID scan upload */}
          <section className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 space-y-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{t.idScanLabel}</h2>
              <p className="mt-1 text-sm text-slate-500">{t.idScanDesc}</p>
            </div>
            {idScanFileName ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <span className="text-emerald-600 font-semibold text-sm">{t.idScanUploaded}:</span>
                <span className="text-xs text-emerald-700 break-all">{idScanFileName}</span>
                <button type="button" onClick={() => { setIdScanFileName(""); updateForm("idScanFile", null); }} className="ml-auto text-xs text-slate-500 underline">Remove</button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-6 text-center hover:border-teal-400 hover:bg-teal-50">
                <span className="text-3xl">📎</span>
                <span className="text-sm font-medium text-slate-700">{idScanUploading ? t.idScanUploading : lang === "vi" ? "Chọn file ảnh…" : "Choose image file…"}</span>
                <span className="text-xs text-slate-400">JPG, PNG, PDF — max 10 MB</span>
                <input type="file" accept="image/*,application/pdf" className="hidden" disabled={idScanUploading} onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  updateForm("idScanFile", file);
                  await uploadIdScan(file).catch(() => {});
                }} />
              </label>
            )}
          </section>

          {form.agreed ? (
            <div className="flex items-start gap-3 rounded-[1.25rem] border border-teal-200 bg-teal-50 p-4">
              <span className="mt-0.5 text-teal-600 text-lg leading-none">✓</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-teal-800">{t.agreeHouseRules}</p>
                <button type="button" onClick={() => { setRulesStep(0); setShowRulesModal(true); }} className="mt-1 text-xs text-teal-600 underline hover:text-teal-500">
                  {lang === "vi" ? "Xem lại nội quy" : "Review rules again"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setRulesStep(0); setShowRulesModal(true); }}
              className="flex w-full items-center justify-center gap-2 rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-600 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700"
            >
              <span>📋</span>
              {lang === "vi" ? "Đọc và xác nhận nội quy nhà ở" : "Read and confirm house rules"}
            </button>
          )}
          <section className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{lang === "vi" ? "Chữ ký khách hàng" : "Client signature"}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {lang === "vi" ? "Chữ ký và thời gian ký sẽ được lưu để đưa vào hợp đồng sau khi chủ nhà duyệt." : "Your signature and signing timestamp will be saved for the contract after owner approval."}
                </p>
              </div>
              {hasSignature ? (
                <button type="button" onClick={clearSignature} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  {lang === "vi" ? "Ký lại" : "Clear"}
                </button>
              ) : null}
            </div>
            <div className="relative h-32 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-1">
              <canvas
                ref={signatureCanvasRef}
                width={700}
                height={128}
                onMouseDown={startSignature}
                onMouseMove={drawSignature}
                onMouseUp={stopSignature}
                onMouseLeave={stopSignature}
                onTouchStart={startSignature}
                onTouchMove={drawSignature}
                onTouchEnd={stopSignature}
                className="h-full w-full cursor-crosshair touch-none rounded-xl bg-white"
              />
              {!hasSignature ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm italic text-slate-400">
                  {lang === "vi" ? "Ký tại đây" : "Sign here"}
                </div>
              ) : null}
            </div>
          </section>
          {submitError ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{submitError}</p> : null}
          {successMessage ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={submitting} className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400">{submitting ? t.submitting : t.submitRegistration}</button>
            <Link href="/client-login" className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50">{t.alreadyHaveAccount}</Link>
          </div>
        </form>

        <aside className="space-y-5">
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <p className="text-sm font-semibold text-slate-900">{t.pricingSummary}</p>
            {selectedBed && pricingSummary ? (
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                {priorResidentContract ? (
                  <p className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">{t.priorResidentDiscountsNote}</p>
                ) : null}
                <div className="rounded-[1.5rem] bg-slate-950 px-5 py-4 text-white">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-300">{selectedBranch?.label ?? selectedBed.floor} / {t.roomLabel} {selectedBed.room} / Bed {selectedBed.bedNumber}</p>
                  {(eligibleDiscounts.length > 0 || pricingSummary.cleaningFee > 0 || pricingSummary.parkingFee > 0 || pricingSummary.paymentFreqMonthlyDiscount > 0 || pricingSummary.tenureSurchargeVnd > 0) ? (
                    <>
                      <p className="mt-3 text-lg font-medium line-through text-slate-400">{formatCurrency(pricingSummary.monthlyPrice)}</p>
                      <p className="text-3xl font-bold text-emerald-400">{formatCurrency(pricingSummary.monthlyTotal)}</p>
                    </>
                  ) : (
                    <p className="mt-3 text-3xl font-bold">{formatCurrency(pricingSummary.monthlyPrice)}</p>
                  )}
                  <p className="mt-1 text-sm text-slate-300">{t.monthlyShareLabel}</p>
                </div>
                {/* Claimable discounts — auto-rules pass, user must self-attest */}
                {claimableDiscounts.length > 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
                    <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">{t.availableDiscountsTitle}</p>
                    <p className="text-xs text-amber-700">{t.proofNotice}</p>
                    {claimableDiscounts.map((d) => {
                      const claimed = claimedDiscountIds.has(d.id);
                      const disabledByExclusive =
                        activeExclusiveDiscount != null && activeExclusiveDiscount.id !== d.id;
                      return (
                        <label key={d.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${disabledByExclusive ? "cursor-not-allowed opacity-60 border-slate-200 bg-slate-100" : claimed ? "cursor-pointer border-emerald-300 bg-emerald-50" : "cursor-pointer border-amber-200 bg-white hover:bg-amber-50"}`}>
                          <input
                            type="checkbox"
                            checked={claimed}
                            disabled={disabledByExclusive}
                            onChange={(e) => {
                              setClaimedDiscountIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) {
                                  if (d.stackMode === "exclusive") {
                                    return new Set([d.id]);
                                  }
                                  next.delete(activeExclusiveDiscount?.id ?? "");
                                  next.add(d.id);
                                } else {
                                  next.delete(d.id);
                                }
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
                              <span className={`text-sm font-semibold ${claimed ? "text-emerald-700" : "text-slate-500"}`}>−{formatCurrency(d.amountVnd)}{d.durationMonths == null ? t.perMonth : ""}</span>
                            </div>
                            <p className="mt-0.5 text-xs text-slate-500">{d.description}{d.descriptionVi ? ` / ${d.descriptionVi}` : ""}</p>
                            <ul className="mt-1 space-y-0.5">
                              {getAttestationRules(d).map((rule, i) => (
                                <li key={i} className="text-xs text-amber-700">{t.iConfirm} {describeAttestationRule(rule, t)}</li>
                              ))}
                            </ul>
                            {d.durationMonths != null && <p className="mt-0.5 text-xs text-slate-400">{t.appliedForFirst} {d.durationMonths} {d.durationMonths !== 1 ? t.months : t.month}</p>}
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
                          <span className="font-semibold text-emerald-700">−{formatCurrency(d.amountVnd)}{d.durationMonths == null ? t.perMonth : ""}</span>
                        </div>
                        <p className="mt-1 text-xs text-emerald-600">{d.description}{d.descriptionVi ? ` / ${d.descriptionVi}` : ""}</p>
                        {d.durationMonths != null && (
                          <p className="mt-0.5 text-xs text-emerald-500">{t.appliedForFirst} {d.durationMonths} {d.durationMonths !== 1 ? t.months : t.month}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                {/* Discounts that don't pass auto-rules */}
                {allDiscounts.filter((d) => d.enabled && !checkAutoRules(d, form, selectedBedTier)).length > 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t.otherDiscounts}</p>
                    {allDiscounts.filter((d) => d.enabled && !checkAutoRules(d, form, selectedBedTier)).map((d) => (
                      <div key={d.id} className="text-xs text-slate-400">
                        <span className="font-medium text-slate-600">{d.label}</span> — {d.description}
                      </div>
                    ))}
                  </div>
                ) : null}
                {/* Short-stay surcharge */}
                {pricingSummary.tenureSurchargeVnd > 0 ? (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-1">
                    <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">{t.surchargeLabel} (+{Math.round(pricingSummary.tenureSurchargeRate * 100)}%)</p>
                    <p className="text-xs text-amber-700">{pricingSummary.tenureSurchargeRate === 0.12 ? t.surcharge12Desc : t.surcharge8Desc}</p>
                    <p className="text-sm font-semibold text-amber-700">+{formatCurrency(pricingSummary.tenureSurchargeVnd)}{t.perMonth}</p>
                  </div>
                ) : null}
                {/* Payment frequency discount */}
                {pricingSummary.paymentFreqMonthlyDiscount > 0 ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-1">
                    <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">{t.paymentFrequencyDiscountLabel}</p>
                    <p className="text-xs text-emerald-700">{form.paymentFrequency.includes("06") ? t.paymentFrequencyDiscount6mo : t.paymentFrequencyDiscount3mo}</p>
                    <p className="text-sm font-semibold text-emerald-700">−{formatCurrency(pricingSummary.paymentFreqMonthlyDiscount)}{t.perMonth}</p>
                  </div>
                ) : null}
                <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors ${form.contractCleaningOptOut ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-slate-50 hover:border-sky-200 hover:bg-white"}`}>
                  <input
                    type="checkbox"
                    checked={form.contractCleaningOptOut}
                    onChange={(event) => updateForm("contractCleaningOptOut", event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-sky-600"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{t.cleaningFeeTitle}</p>
                    <p className="mt-1 text-xs text-slate-500">{t.cleaningFeeDesc(selectedBedCleaningOptOutFee)}</p>
                    <p className="mt-2 text-xs font-medium text-sky-700">{t.addCleaningFee(selectedBedCleaningOptOutFee)}</p>
                  </div>
                </label>
                {pricingSummary.cleaningFee > 0 ? (
                  <div className="flex items-center justify-between rounded-2xl bg-sky-50 px-4 py-3 text-sky-900"><span>{t.cleaningFeeLabel}</span><span className="font-semibold">{formatCurrency(pricingSummary.cleaningFee)}</span></div>
                ) : null}
                {pricingSummary.parkingFee > 0 ? (
                  <div className="flex items-center justify-between rounded-2xl bg-amber-50 px-4 py-3 text-amber-900"><span>{t.parkingFeeLabel}</span><span className="font-semibold">{formatCurrency(pricingSummary.parkingFee)}</span></div>
                ) : null}
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span>{t.depositSideLabel}</span>
                  <span className="font-semibold text-slate-900">{formatCurrency(pricingSummary.deposit)}</span>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm">{t.firstPaymentEstimate}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {pricingSummary.referralFirstPaymentCut > 0 ? (
                        <>
                          <span className="font-semibold text-slate-400 line-through">
                            {formatCurrency(pricingSummary.firstPaymentBeforeReferral)}
                          </span>
                          <span className="font-semibold text-emerald-700">{formatCurrency(pricingSummary.firstPayment)}</span>
                        </>
                      ) : (
                        <span className="font-semibold text-slate-900">{formatCurrency(pricingSummary.firstPayment)}</span>
                      )}
                      <button type="button" onClick={() => setShowFirstPaymentDetail((v) => !v)} className="rounded-lg border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100">{showFirstPaymentDetail ? (lang === "vi" ? "Ẩn" : "Hide") : (lang === "vi" ? "Chi tiết" : "Detail")}</button>
                    </div>
                  </div>
                  {pricingSummary.referralFirstPaymentCut > 0 ? (
                    <p className="mt-2 text-xs text-emerald-700">{t.referralFirstPaymentOff(formatCurrency(pricingSummary.referralFirstPaymentCut))}</p>
                  ) : null}
                  {showFirstPaymentDetail ? (() => {
                    const multiplier = getFirstPaymentMultiplier(form.paymentFrequency);
                    const is6Month = form.paymentFrequency.includes("06");
                    const is3Month = form.paymentFrequency.includes("03");
                    // For 6-month plan: display as ×7 months − 1 free month (net = ×6 paid)
                    const displayMultiplier = is6Month ? 7 : multiplier;
                    const monthlyBeforeFreq = pricingSummary.discountedMonthlyPrice + pricingSummary.tenureSurchargeVnd + pricingSummary.parkingFee + pricingSummary.cleaningFee;
                    const oneTimeFlatDiscount = pricingSummary.oneTimeDiscounts.reduce(
                      (sum, d) => sum + d.amountVnd * Math.min(d.durationMonths!, multiplier),
                      0
                    );
                    const recurringNames = recurringDiscounts.map((d) => lang === "vi" && d.labelVi ? d.labelVi : d.label).join(", ");
                    return (
                      <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 text-xs text-slate-600">
                        <p className="font-semibold text-slate-700 text-xs uppercase tracking-wide mb-2">{lang === "vi" ? "Cách tính" : "Breakdown"}</p>
                        <div className="flex justify-between">
                          <span>
                            {lang === "vi" ? "Giá giường" : "Bed price"}{" "}
                            {recurringDiscounts.length > 0 && (
                              <span className="text-emerald-600">
                                {lang === "vi"
                                  ? `(−${formatCurrency(totalRecurringDiscount)}/tháng: ${recurringNames})`
                                  : `(−${formatCurrency(totalRecurringDiscount)}/mo: ${recurringNames})`}
                              </span>
                            )}
                          </span>
                          <span className="font-medium">{formatCurrency(pricingSummary.discountedMonthlyPrice)}</span>
                        </div>
                        {pricingSummary.tenureSurchargeVnd > 0 && <div className="flex justify-between text-amber-700"><span>{lang === "vi" ? "Phụ phí hợp đồng ngắn hạn" : "Short-term contract surcharge"}</span><span className="font-medium">+{formatCurrency(pricingSummary.tenureSurchargeVnd)}</span></div>}
                        {pricingSummary.parkingFee > 0 && <div className="flex justify-between"><span>{lang === "vi" ? "Phí gửi xe" : "Parking fee"}</span><span className="font-medium">+{formatCurrency(pricingSummary.parkingFee)}</span></div>}
                        {pricingSummary.cleaningFee > 0 && <div className="flex justify-between"><span>{lang === "vi" ? "Phí vệ sinh" : "Cleaning fee"}</span><span className="font-medium">+{formatCurrency(pricingSummary.cleaningFee)}</span></div>}
                        <div className="flex justify-between border-t border-slate-200 pt-1.5 font-medium text-slate-700">
                          <span>{lang === "vi" ? `Tổng/tháng × ${displayMultiplier} tháng` : `Monthly total × ${displayMultiplier} month${displayMultiplier > 1 ? "s" : ""}`}</span>
                          <span>{formatCurrency(monthlyBeforeFreq)} × {displayMultiplier} = {formatCurrency(monthlyBeforeFreq * displayMultiplier)}</span>
                        </div>
                        {is6Month && <div className="flex justify-between text-emerald-700"><span>{lang === "vi" ? "Tháng thứ 7 miễn phí" : "7th month free"}</span><span className="font-medium">−{formatCurrency(monthlyBeforeFreq)}</span></div>}
                        {is3Month && <div className="flex justify-between text-emerald-700"><span>{lang === "vi" ? "Ưu đãi thanh toán 3 tháng" : "3-month payment discount"}</span><span className="font-medium">−{formatCurrency(500000)}</span></div>}
                        {oneTimeFlatDiscount > 0 && <div className="flex justify-between text-emerald-700"><span>{lang === "vi" ? "Giảm giá 1 lần (ưu đãi tháng đầu)" : "One-time discounts (first-month)"}</span><span className="font-medium">−{formatCurrency(oneTimeFlatDiscount)}</span></div>}
                        <div className="flex justify-between">
                          <span>{lang === "vi" ? "Tiền cọc" : "Deposit"}</span>
                          <span className="font-medium">+{formatCurrency(pricingSummary.deposit)}</span>
                        </div>
                        {pricingSummary.referralFirstPaymentCut > 0 ? (
                          <div className="flex justify-between text-emerald-700">
                            <span>{lang === "vi" ? "Giảm giới thiệu (một lần, tổng lần đầu)" : "Referral (one-time, first payment total)"}</span>
                            <span className="font-medium">−{formatCurrency(pricingSummary.referralFirstPaymentCut)}</span>
                          </div>
                        ) : null}
                        <div className="flex justify-between border-t-2 border-slate-300 pt-1.5 font-bold text-slate-900">
                          <span>{lang === "vi" ? "Tổng lần đầu" : "Total first payment"}</span>
                          <span>
                            {pricingSummary.referralFirstPaymentCut > 0 ? (
                              <>
                                <span className="font-normal text-slate-400 line-through mr-2">{formatCurrency(pricingSummary.firstPaymentBeforeReferral)}</span>
                                <span>{formatCurrency(pricingSummary.firstPayment)}</span>
                              </>
                            ) : (
                              formatCurrency(pricingSummary.firstPayment)
                            )}
                          </span>
                        </div>
                        <p className="mt-2 text-slate-400">{lang === "vi" ? `Thanh toán trung bình mỗi tháng: ${formatCurrency(pricingSummary.monthlyTotal)}` : `Average monthly payment: ${formatCurrency(pricingSummary.monthlyTotal)}`}</p>
                      </div>
                    );
                  })() : null}
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"><span>{t.availability}</span><span className="font-semibold text-slate-900">{selectedBed.status === "available_now" ? t.nowBadge : selectedBed.availableOn}</span></div>
              </div>
            ) : (
              <div className="mt-4 rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">{t.selectBedPrompt}</div>
            )}
          </section>
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <p className="text-sm font-semibold text-slate-900">{t.branchDetailsTitle}</p>
            {selectedBranch ? (
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="font-semibold text-slate-900">{selectedBranch.label}</p><p className="mt-1">{selectedBranch.address}</p></div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">{t.showingBeds(form.sex === "female" ? t.sexFemale : form.sex === "male" ? t.sexMale : "...")}</div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{t.pickBranchPrompt}</div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
