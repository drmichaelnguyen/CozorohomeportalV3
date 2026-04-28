const state = {
  authEmail: localStorage.getItem("guestBookingAuthEmail") || "",
  authToken: localStorage.getItem("guestBookingAuthToken") || "",
  authMode: localStorage.getItem("guestBookingAuthMode") || "verification",
  wizardStep: 1,
  isVietnamese: false,
  branchId: "D7",
  checkIn: "",
  checkOut: "",
  bioSex: "",
  selectedBed: null,
  availability: null,
  pricingConfig: null,
  cancellationPolicy: "cancellable",
  stripeConfigured: false,
  gallery: null,
  galleryIndex: 0,
  galleryBranchId: "D7",
  recentGuestProfileLoaded: false
};

let recentGuestProfileSaveTimer = null;

const els = {
  authEmail: document.getElementById("authEmail"),
  authWebsite: document.getElementById("authWebsite"),
  authCode: document.getElementById("authCode"),
  authStatus: document.getElementById("authStatus"),
  accountSetupPanel: document.getElementById("accountSetupPanel"),
  accountPassword: document.getElementById("accountPassword"),
  accountPasswordConfirm: document.getElementById("accountPasswordConfirm"),
  accountStatus: document.getElementById("accountStatus"),
  createAccountBtn: document.getElementById("createAccountBtn"),
  passwordLoginBtn: document.getElementById("passwordLoginBtn"),
  sendCodeBtn: document.getElementById("sendCodeBtn"),
  verifyCodeBtn: document.getElementById("verifyCodeBtn"),
  siteTitle: document.getElementById("siteTitle"),
  wizardCard: document.getElementById("wizardCard"),
  stepOneCard: document.getElementById("stepOneCard"),
  searchCard: document.getElementById("searchCard"),
  roomsCard: document.getElementById("roomsCard"),
  authCard: document.getElementById("authCard"),
  bookingCard: document.getElementById("bookingCard"),
  profileStatus: document.getElementById("profileStatus"),
  wizardSteps: Array.from(document.querySelectorAll("[data-step]")),
  galleryImage: document.getElementById("galleryImage"),
  galleryBranchLabel: document.getElementById("galleryBranchLabel"),
  galleryCounter: document.getElementById("galleryCounter"),
  galleryTitle: document.getElementById("galleryTitle"),
  galleryCaption: document.getElementById("galleryCaption"),
  galleryDots: document.getElementById("galleryDots"),
  galleryShell: document.getElementById("galleryShell"),
  galleryD2Btn: document.getElementById("galleryD2Btn"),
  galleryD7Btn: document.getElementById("galleryD7Btn"),
  galleryPrevBtn: document.getElementById("galleryPrevBtn"),
  galleryNextBtn: document.getElementById("galleryNextBtn"),
  isVietnamese: document.getElementById("isVietnamese"),
  branchId: document.getElementById("branchId"),
  branchLabel: document.getElementById("branchLabel"),
  checkIn: document.getElementById("checkIn"),
  checkOut: document.getElementById("checkOut"),
  bioSex: document.getElementById("bioSex"),
  idPhoto: document.getElementById("idPhoto"),
  idPhotoWrap: document.getElementById("idPhotoWrap"),
  bioSexWrap: document.querySelector('label[for="bioSex"]') || document.getElementById("bioSex").closest("label"),
  refreshBtn: document.getElementById("refreshBtn"),
  roomsGrid: document.getElementById("roomsGrid"),
  selectedBedLabel: document.getElementById("selectedBedLabel"),
  priceSummary: document.getElementById("priceSummary"),
  priceDetails: document.getElementById("priceDetails"),
  statusMessage: document.getElementById("statusMessage"),
  guestName: document.getElementById("guestName"),
  guestEmail: document.getElementById("guestEmail"),
  guestPhone: document.getElementById("guestPhone"),
  cancellationPolicy: document.getElementById("cancellationPolicy"),
  cancellationPolicyNote: document.getElementById("cancellationPolicyNote"),
  notes: document.getElementById("notes"),
  bookBtn: document.getElementById("bookBtn"),
  referralCode: document.getElementById("referralCode"),
  referralHostelBanner: document.getElementById("referralHostelBanner"),
  referralHostelBody: document.getElementById("referralHostelBody")
};

function formatDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function setDefaultDates() {
  const today = new Date();
  const checkIn = new Date(today);
  checkIn.setDate(today.getDate() + 1);
  const checkOut = new Date(today);
  checkOut.setDate(today.getDate() + 4);
  state.checkIn = formatDateInput(checkIn);
  state.checkOut = formatDateInput(checkOut);
  els.checkIn.value = state.checkIn;
  els.checkOut.value = state.checkOut;
}

function setMessage(messageKey, params = {}) {
  els.statusMessage.textContent = window.t(messageKey, params);
}

function setAuthMessage(messageKey, params = {}) {
  els.authStatus.textContent = window.t(messageKey, params);
}

function setAccountMessage(messageKey, params = {}) {
  if (els.accountStatus) {
    els.accountStatus.textContent = window.t(messageKey, params);
  }
}

function normalizeCancellationPolicy(value) {
  return String(value || "").trim().toLowerCase() === "non_refundable" ? "non_refundable" : "cancellable";
}

function getCancellationPolicyDiscountPercent(policy) {
  return normalizeCancellationPolicy(policy) === "non_refundable" ? 10 : 0;
}

function updateCancellationPolicyNote() {
  const policy = normalizeCancellationPolicy(els.cancellationPolicy.value || state.cancellationPolicy);
  state.cancellationPolicy = policy;

  if (!els.cancellationPolicyNote) {
    return;
  }

  els.cancellationPolicyNote.textContent = policy === "non_refundable"
    ? window.t("cancellationNoteNonRefundable")
    : window.t("cancellationNoteCancellable");
}

function getFieldWrapper(element) {
  if (!element || typeof element.closest !== "function") {
    return null;
  }

  return element.closest("label");
}

function clearValidationHighlights() {
  Array.from(document.querySelectorAll(".field-invalid")).forEach((element) => {
    element.classList.remove("field-invalid");
  });
  Array.from(document.querySelectorAll(".validation-target-invalid")).forEach((element) => {
    element.classList.remove("validation-target-invalid");
  });
}

function markInvalid(element, options = {}) {
  if (!element) {
    return;
  }

  const wrapper = options.wrapper || getFieldWrapper(element);
  element.classList.add("field-invalid");
  element.setAttribute("aria-invalid", "true");
  if (wrapper) {
    wrapper.classList.add("field-invalid");
  }
}

function markInvalidTarget(element) {
  if (!element) {
    return;
  }

  element.classList.add("validation-target-invalid");
}

function clearFieldInvalidState(element) {
  if (!element) {
    return;
  }

  element.classList.remove("field-invalid");
  element.removeAttribute("aria-invalid");
  const wrapper = getFieldWrapper(element);
  if (wrapper) {
    wrapper.classList.remove("field-invalid");
  }
}

function validateBookingBeforeCheckout() {
  clearValidationHighlights();

  const missing = [];
  const addMissing = (element, label, options = {}) => {
    if (options.target) {
      markInvalidTarget(options.target);
    } else {
      markInvalid(element, options);
    }
    missing.push({ element: options.scrollElement || element || options.target, label: window.t(`validation${label}`) });
  };

  if (els.isVietnamese.value === "") {
    addMissing(els.isVietnamese, "Nationality");
  }

  if (!els.bioSex.value) {
    addMissing(els.bioSex, "BioSex", { wrapper: els.bioSexWrap });
  }

  if (!els.branchId.value) {
    addMissing(els.branchId, "Branch");
  }

  if (!els.checkIn.value) {
    addMissing(els.checkIn, "CheckIn");
  }

  if (!els.checkOut.value) {
    addMissing(els.checkOut, "CheckOut");
  }

  if (!state.selectedBed) {
    addMissing(null, "BedSelection", { target: els.roomsCard, scrollElement: els.roomsCard });
  }

  if (!String(els.guestName.value || "").trim()) {
    addMissing(els.guestName, "GuestName");
  }

  if (!String(els.guestEmail.value || "").trim()) {
    addMissing(els.guestEmail, "GuestEmail");
  }

  if (!String(els.guestPhone.value || "").trim()) {
    addMissing(els.guestPhone, "GuestPhone");
  }

  if (state.branchId === "D2" && !els.idPhoto.files.length) {
    addMissing(els.idPhoto, "IdPhoto", { wrapper: els.idPhotoWrap });
  }

  if (!hasValidBookingSession()) {
    addMissing(els.authEmail, "Account", { scrollElement: els.authCard });
  }

  if (!missing.length) {
    return true;
  }

  const firstMissing = missing[0];
  if (firstMissing && firstMissing.element && typeof firstMissing.element.scrollIntoView === "function") {
    firstMissing.element.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const labels = missing.map((entry) => entry.label);
  setMessage("pleaseCompleteFields", {
    plural: labels.length > 1 ? (localStorage.getItem("cozoroGuestLanguage") === "vi" ? " các" : "s") : "",
    labels: labels.join(", ")
  });
  return false;
}

function collectRecentGuestProfile() {
  return {
    guestName: String(els.guestName.value || "").trim(),
    guestEmail: String(els.guestEmail.value || "").trim(),
    guestPhone: String(els.guestPhone.value || "").trim(),
    notes: String(els.notes.value || "").trim(),
    isVietnamese: els.isVietnamese.value === "yes",
    bioSex: String(els.bioSex.value || "").trim(),
    branchId: String(els.branchId.value || "").trim(),
    cancellationPolicy: normalizeCancellationPolicy(els.cancellationPolicy.value || state.cancellationPolicy)
  };
}

function applyRecentGuestProfile(profile) {
  if (!profile || typeof profile !== "object") {
    state.recentGuestProfileLoaded = true;
    return;
  }

  if (!els.guestName.value.trim() && profile.guestName) {
    els.guestName.value = profile.guestName;
  }

  if (!els.guestEmail.value.trim() && profile.guestEmail) {
    els.guestEmail.value = profile.guestEmail;
  }

  if (!els.guestPhone.value.trim() && profile.guestPhone) {
    els.guestPhone.value = profile.guestPhone;
  }

  if (!els.notes.value.trim() && profile.notes) {
    els.notes.value = profile.notes;
  }

  if (!els.authEmail.value.trim() && profile.guestEmail) {
    els.authEmail.value = profile.guestEmail;
  }

  if (profile.cancellationPolicy) {
    els.cancellationPolicy.value = normalizeCancellationPolicy(profile.cancellationPolicy);
  }

  if (!els.isVietnamese.value && typeof profile.isVietnamese === "boolean") {
    els.isVietnamese.value = profile.isVietnamese ? "yes" : "no";
  }

  if (!els.bioSex.value && profile.bioSex) {
    els.bioSex.value = profile.bioSex;
  }

  syncBranchMode();

  if (!els.branchId.value && profile.branchId) {
    els.branchId.value = profile.branchId;
    syncBranchMode();
  }

  updateCancellationPolicyNote();
  state.recentGuestProfileLoaded = true;
  syncAuthUi();
}

async function loadRecentGuestProfile() {
  try {
    const response = await fetch("/api/recent-guest-profile");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to load recent guest profile.");
    }
    applyRecentGuestProfile(data.profile || null);
  } catch {
    state.recentGuestProfileLoaded = true;
  }
}

async function persistRecentGuestProfile() {
  const profile = collectRecentGuestProfile();

  try {
    await fetch("/api/recent-guest-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile)
    });
  } catch {
    // Autofill is a convenience feature; ignore save failures.
  }
}

function scheduleRecentGuestProfileSave(delay = 500) {
  if (!state.recentGuestProfileLoaded) {
    return;
  }

  window.clearTimeout(recentGuestProfileSaveTimer);
  recentGuestProfileSaveTimer = window.setTimeout(() => {
    void persistRecentGuestProfile();
  }, delay);
}

function getAuthEmail() {
  return String(els.authEmail.value || "").trim().toLowerCase();
}

function hasValidBookingSession() {
  const authEmail = getAuthEmail();
  return Boolean(
    state.authMode === "account" &&
    state.authToken &&
    state.authEmail &&
    authEmail &&
    state.authEmail === authEmail &&
    els.guestEmail.value.trim().toLowerCase() === authEmail
  );
}

function syncAuthUi() {
  if (state.authEmail && !els.authEmail.value.trim()) {
    els.authEmail.value = state.authEmail;
  }

  if (state.authEmail && !els.guestEmail.value.trim()) {
    els.guestEmail.value = state.authEmail;
  }

  const verified = hasValidBookingSession();
  els.bookBtn.disabled = false;
  els.bookBtn.title = verified ? "Proceed to Stripe checkout" : "Complete email verification and account sign-in before booking";
  if (verified) {
    els.authCard.classList.remove("validation-target-invalid");
  }

  const showAccountPanel = Boolean(state.authToken && state.authEmail && state.authMode === "verification");
  if (els.accountSetupPanel) {
    els.accountSetupPanel.classList.toggle("hidden", !showAccountPanel);
  }

  if (verified) {
    setAuthMessage("signedInAs", { email: state.authEmail });
    setAccountMessage("");
  } else if (state.authToken && state.authEmail) {
    setAuthMessage("verifiedEmail", { email: state.authEmail });
    setAccountMessage("accountSetupMsg");
  } else if (state.authEmail) {
    setAuthMessage("emailNotVerified", { email: state.authEmail });
    setAccountMessage("");
  } else {
    setAuthMessage("verifyEmailUnlock");
    setAccountMessage("");
  }

  updateWizardUi();
}

function persistAuthSession(email, token, mode = "verification") {
  state.authEmail = email;
  state.authToken = token;
  state.authMode = mode;
  localStorage.setItem("guestBookingAuthEmail", email);
  localStorage.setItem("guestBookingAuthToken", token);
  localStorage.setItem("guestBookingAuthMode", mode);
  els.authEmail.value = email;
  els.guestEmail.value = email;
  syncAuthUi();
  scheduleRecentGuestProfileSave(0);
}

function clearAuthSession() {
  state.authEmail = "";
  state.authToken = "";
  state.authMode = "verification";
  localStorage.removeItem("guestBookingAuthEmail");
  localStorage.removeItem("guestBookingAuthToken");
  localStorage.removeItem("guestBookingAuthMode");
  syncAuthUi();
  updateWizardUi();
  scheduleRecentGuestProfileSave(0);
}

function getAllowedBranches() {
  if (!state.isVietnamese) {
    return ["D7"];
  }

  if (els.bioSex.value === "female") {
    return ["D2", "D7"];
  }

  if (els.bioSex.value === "male") {
    return ["D7"];
  }

  return [];
}

function updateBranchOptions() {
  const allowedBranches = getAllowedBranches();
  const currentValue = allowedBranches.includes(els.branchId.value) ? els.branchId.value : (allowedBranches[0] || "");

  els.branchId.innerHTML = allowedBranches.length
    ? allowedBranches.map((branchId) => `<option value="${branchId}">${branchId}</option>`).join("")
    : `<option value="">${window.t("select")} ${window.t("biologicalSex")}</option>`;
  els.branchId.value = currentValue;
}

function syncBranchMode() {
  const previousGalleryBranchId = state.galleryBranchId;
  state.isVietnamese = els.isVietnamese.value === "yes";
  updateBranchOptions();
  state.branchId = els.branchId.value || "D7";
  els.branchId.value = state.branchId;
  els.branchLabel.textContent = state.branchId;
  els.idPhotoWrap.classList.toggle("hidden", state.branchId !== "D2");
  state.galleryBranchId = state.branchId;
  if (previousGalleryBranchId !== state.galleryBranchId) {
    state.galleryIndex = 0;
  }
  renderGallery();
  updateWizardUi();
}

function getWizardState() {
  const nationalityChosen = els.isVietnamese.value !== "";
  const sexChosen = els.bioSex.value !== "";
  const step1Complete = nationalityChosen && sexChosen;
  const step2Ready = step1Complete && Boolean(els.branchId.value) && Boolean(els.checkIn.value) && Boolean(els.checkOut.value);
  const step3Complete = step2Ready && Boolean(state.selectedBed);
  const step4Ready = step3Complete && hasValidBookingSession();

  return {
    step1Complete,
    step2Ready,
    step3Complete,
    step4Ready
  };
}

function updateWizardUi() {
  const wizardState = getWizardState();

  if (els.profileStatus) {
    if (!els.isVietnamese.value && !els.bioSex.value) {
      els.profileStatus.textContent = window.t("profileStatusStart");
    } else if (els.isVietnamese.value && !els.bioSex.value) {
      els.profileStatus.textContent = window.t("profileStatusNextSex");
    } else {
      const femaleVietnamese = els.isVietnamese.value === "yes" && els.bioSex.value === "female";
      const allowedText = femaleVietnamese ? "D2 / D7" : "D7";
      els.profileStatus.textContent = window.t("profileStatusEligible", { allowedText });
    }
  }

  if (els.searchCard) {
    els.searchCard.classList.toggle("hidden", !wizardState.step1Complete);
  }
  if (els.roomsCard) {
    els.roomsCard.classList.toggle("hidden", !wizardState.step2Ready);
  }
  if (els.authCard) {
    els.authCard.classList.toggle("hidden", !wizardState.step3Complete);
  }
  if (els.bookingCard) {
    els.bookingCard.classList.toggle("hidden", !wizardState.step4Ready);
  }

  if (els.wizardSteps) {
    const activeStep = wizardState.step4Ready ? 4 : wizardState.step3Complete ? 4 : wizardState.step2Ready ? 3 : wizardState.step1Complete ? 2 : 1;
    els.wizardSteps.forEach((stepEl) => {
      const stepNumber = Number(stepEl.getAttribute("data-step") || 0);
      stepEl.classList.toggle("active", stepNumber === activeStep);
      stepEl.classList.toggle("complete", stepNumber < activeStep);
    });
  }
}

function updateSelectedBedLabel() {
  if (!state.selectedBed) {
    els.selectedBedLabel.textContent = "None selected";
    return;
  }

  const selectedRoom = state.availability
    ? state.availability.rooms.find((room) => room.beds.some((bed) => bed.bedNumber === state.selectedBed))
    : null;
  const selectedBed = selectedRoom
    ? selectedRoom.beds.find((bed) => bed.bedNumber === state.selectedBed)
    : null;

  els.selectedBedLabel.textContent = selectedBed
    ? window.t("bedDetails", {
        number: selectedBed.bedNumber,
        level: selectedBed.bedLevel,
        price: formatCurrencyVnd(selectedBed.nightlyPrice)
      })
    : window.t("bedLabel", { number: state.selectedBed });
}

function formatCurrencyVnd(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);
}

function getGalleryBranchData(branchId = state.galleryBranchId) {
  if (!state.gallery || !Array.isArray(state.gallery.branches)) {
    return null;
  }

  return state.gallery.branches.find((branch) => branch.branchId === branchId) || state.gallery.branches[0] || null;
}

function renderGalleryDots(images, activeIndex) {
  if (!els.galleryDots) {
    return;
  }

  els.galleryDots.innerHTML = "";
  images.forEach((_image, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `carousel-dot${index === activeIndex ? " active" : ""}`;
    dot.setAttribute("aria-label", `Show gallery image ${index + 1}`);
    dot.setAttribute("aria-pressed", index === activeIndex ? "true" : "false");
    dot.addEventListener("click", () => {
      state.galleryIndex = index;
      renderGallery();
    });
    els.galleryDots.appendChild(dot);
  });
}

function renderGallery() {
  if (!els.galleryImage || !els.galleryTitle || !els.galleryCaption || !els.galleryBranchLabel || !els.galleryCounter) {
    return;
  }

  const branchData = getGalleryBranchData();
  const images = branchData?.images || [];
  if (!images.length) {
    els.galleryImage.removeAttribute("src");
    els.galleryImage.alt = "Gallery preview";
    els.galleryBranchLabel.textContent = state.branchId || "D7";
    els.galleryCounter.textContent = "0 / 0";
    els.galleryTitle.textContent = branchData ? branchData.title : "Loading gallery...";
    els.galleryCaption.textContent = branchData ? branchData.description : "We are preparing the photo tour.";
    renderGalleryDots([], 0);
    return;
  }

  if (state.galleryIndex < 0 || state.galleryIndex >= images.length) {
    state.galleryIndex = 0;
  }

  const image = images[state.galleryIndex];
  els.galleryImage.src = image.src;
  els.galleryImage.alt = image.alt;
  els.galleryBranchLabel.textContent = branchData.branchId;
  els.galleryCounter.textContent = `${state.galleryIndex + 1} / ${images.length}`;
  els.galleryTitle.textContent = branchData.title;
  els.galleryCaption.textContent = `${branchData.description} Photo ${state.galleryIndex + 1} of ${images.length}.`;
  renderGalleryDots(images, state.galleryIndex);
  if (els.galleryD2Btn && els.galleryD7Btn) {
    els.galleryD2Btn.classList.toggle("selected", branchData.branchId === "D2");
    els.galleryD7Btn.classList.toggle("selected", branchData.branchId === "D7");
  }
}

function advanceGallery(step) {
  const branchData = getGalleryBranchData();
  const images = branchData?.images || [];
  if (!images.length) {
    return;
  }

  state.galleryIndex = (state.galleryIndex + step + images.length) % images.length;
  renderGallery();
}

function setupGallerySwipe() {
  if (!els.galleryShell || els.galleryShell.dataset.swipeReady === "true") {
    return;
  }

  let startX = 0;
  let startY = 0;
  let tracking = false;

  els.galleryShell.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) {
        return;
      }

      tracking = true;
      startX = touch.clientX;
      startY = touch.clientY;
    },
    { passive: true }
  );

  els.galleryShell.addEventListener(
    "touchend",
    (event) => {
      if (!tracking) {
        return;
      }

      tracking = false;
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) {
        return;
      }

      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;

      if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY)) {
        return;
      }

      advanceGallery(deltaX < 0 ? 1 : -1);
    },
    { passive: true }
  );

  els.galleryShell.dataset.swipeReady = "true";
}

function getSelectedBedDetails() {
  if (!state.selectedBed || !state.availability) {
    return null;
  }

  for (const room of state.availability.rooms) {
    const match = room.beds.find((bed) => bed.bedNumber === state.selectedBed);
    if (match) {
      return match;
    }
  }

  return null;
}

function getActiveDiscountRule(nights) {
  if (!state.pricingConfig || !state.pricingConfig.discounts) {
    return null;
  }

  const weekly = state.pricingConfig.discounts.weekly || {};
  const monthly = state.pricingConfig.discounts.monthly || {};

  if (monthly.enabled && nights >= Number(monthly.minNights || 30)) {
    return { name: "monthly", percent: Number(monthly.percent || 0) };
  }

  if (weekly.enabled && nights >= Number(weekly.minNights || 7)) {
    return { name: "weekly", percent: Number(weekly.percent || 0) };
  }

  return null;
}

function calculateBedPricingPreview(bedDetails) {
  if (!state.pricingConfig || !els.checkIn.value || !els.checkOut.value || !bedDetails) {
    return null;
  }

  const start = new Date(`${els.checkIn.value}T00:00:00.000Z`);
  const end = new Date(`${els.checkOut.value}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) {
    return null;
  }

  const nights = Math.round((end.getTime() - start.getTime()) / 86400000);
  const discountRule = getActiveDiscountRule(nights);
  const cancellationPolicy = normalizeCancellationPolicy(els.cancellationPolicy.value || state.cancellationPolicy);
  const nightlyRates = Array.isArray(bedDetails.nightlyPrices) && bedDetails.nightlyPrices.length
    ? bedDetails.nightlyPrices.map((entry) => Number(entry?.nightlyPrice ?? entry)).filter((rate) => Number.isFinite(rate) && rate > 0)
    : [];
  const nightlyPrice = nightlyRates[0] || Number(bedDetails.nightlyPrice) || 0;
  const subtotal = nightlyRates.length > 0 ? nightlyRates.reduce((sum, rate) => sum + rate, 0) : nightlyPrice * nights;
  const hasVariableNightlyRates = nightlyRates.length > 1 && new Set(nightlyRates).size > 1;
  const stayDiscountPercent = discountRule ? discountRule.percent : 0;
  const stayDiscountAmount = Math.round(subtotal * (stayDiscountPercent / 100));
  const cancellationDiscountPercent = getCancellationPolicyDiscountPercent(cancellationPolicy);
  const cancellationDiscountAmount = Math.round(subtotal * (cancellationDiscountPercent / 100));
  const discountPercent = stayDiscountPercent + cancellationDiscountPercent;
  const discountAmount = stayDiscountAmount + cancellationDiscountAmount;
  const depositAmount = state.pricingConfig.depositAmount || 0;
  const stayTotal = subtotal - discountAmount;
  const nightlyRateAfterDiscount = nights > 0 ? Math.round(stayTotal / nights) : 0;

  return {
    nights,
    nightlyPrice,
    cancellationPolicy,
    stayDiscountPercent,
    stayDiscountAmount,
    cancellationDiscountPercent,
    cancellationDiscountAmount,
    discountPercent,
    discountType: discountRule ? discountRule.name : "",
    nightlyPriceSource: bedDetails.nightlyPriceSource || "configured",
    hasVariableNightlyRates,
    subtotal,
    discountAmount,
    depositAmount,
    stayTotal,
    nightlyRateAfterDiscount,
    total: stayTotal + depositAmount,
    minimumStay: Number(state.pricingConfig.minimumStay || 1)
  };
}

function calculatePricingPreview() {
  if (!state.selectedBed) {
    return null;
  }

  return calculateBedPricingPreview(getSelectedBedDetails());
}

function updatePriceSummary(pricing) {
  if (!pricing) {
    els.priceSummary.textContent = state.selectedBed ? "Enter dates to calculate" : "Select a bed to calculate";
    els.priceDetails.innerHTML = "";
    return;
  }

  if (pricing.minimumStay && pricing.nights < pricing.minimumStay) {
    els.priceSummary.textContent = `Minimum stay is ${pricing.minimumStay} nights`;
    els.priceDetails.innerHTML = "";
    return;
  }

  els.priceSummary.textContent = window.t("totalAfterDiscount", { price: formatCurrencyVnd(pricing.stayTotal) });
  const rows = [
    { label: window.t("totalNights"), value: `${pricing.nights} ${localStorage.getItem("cozoroGuestLanguage") === "vi" ? "đêm" : (pricing.nights === 1 ? "night" : "nights")}` },
    { label: window.t("totalPrice"), value: formatCurrencyVnd(pricing.subtotal) },
    {
      label: pricing.discountPercent > 0
        ? window.t("discountBonus")
        : window.t("discount"),
      value: pricing.discountPercent > 0 ? `-${formatCurrencyVnd(pricing.discountAmount)}` : formatCurrencyVnd(0)
    },
    { label: window.t("totalAfterDiscount", { price: "" }).replace(":", "").trim(), value: formatCurrencyVnd(pricing.stayTotal) },
    { label: window.t("nightlyRateAfterDiscount"), value: `${formatCurrencyVnd(pricing.nightlyRateAfterDiscount)}/${localStorage.getItem("cozoroGuestLanguage") === "vi" ? "đêm" : "night"}` }
  ];

  els.priceDetails.innerHTML = rows.map((row) => `
    <div class="price-breakdown-row">
      <span class="price-breakdown-label">${row.label}</span>
      <span class="price-breakdown-value">${row.value}</span>
    </div>
  `).join("");

  if (pricing.nightlyPriceSource === "fallback") {
    els.priceDetails.insertAdjacentHTML("beforeend", `
      <div class="section-note">Default nightly price applied until this bed is configured in the main app.</div>
    `);
  }

  if (pricing.depositAmount) {
    els.priceDetails.insertAdjacentHTML("beforeend", `
      <div class="section-note">Refundable damage deposit (separate): ${formatCurrencyVnd(pricing.depositAmount)}</div>
    `);
  }

  if (pricing.hasVariableNightlyRates) {
    els.priceDetails.insertAdjacentHTML("beforeend", `
      <div class="section-note">This stay uses different nightly prices by date. The total above already sums each night.</div>
    `);
  }

  els.priceDetails.insertAdjacentHTML("beforeend", `
    <div class="section-note">${pricing.cancellationPolicy === "non_refundable"
      ? "Non-refundable option selected: extra 10% stay discount applied. After the 24-hour grace period, only the deposit is refunded."
      : "Cancellable option selected: full refund within 24 hours of booking, or until 48 hours before check-in. After that, only the deposit is refunded."}</div>
  `);
}

function hasRequiredBookingInputs() {
  return Boolean(
    els.isVietnamese.value !== "" &&
    els.bioSex.value &&
    els.branchId.value &&
    els.checkIn.value &&
    els.checkOut.value
  );
}

async function loadReferralProgram() {
  try {
    const r = await fetch("/api/referral-program");
    const data = await r.json();
    if (!r.ok || !data.enabled || !data.hostelEnabled) {
      if (els.referralHostelBanner) els.referralHostelBanner.classList.add("hidden");
      return;
    }
    const lang = localStorage.getItem("cozoroGuestLanguage") === "vi" ? "vi" : "en";
    const headline =
      lang === "vi" ? data.hostelHeadlineVi || data.hostelHeadlineEn : data.hostelHeadlineEn || data.hostelHeadlineVi;
    const details =
      lang === "vi" ? data.hostelDetailsVi || data.hostelDetailsEn : data.hostelDetailsEn || data.hostelDetailsVi;
    if (els.referralHostelBody) {
      els.referralHostelBody.textContent = [headline, details].filter(Boolean).join(" ");
    }
    if (els.referralHostelBanner) els.referralHostelBanner.classList.remove("hidden");
  } catch {
    if (els.referralHostelBanner) els.referralHostelBanner.classList.add("hidden");
  }
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const data = await response.json();
  document.title = data.siteTitle;
  els.siteTitle.textContent = data.siteTitle;
  state.branchId = data.defaultBranch;
  state.isVietnamese = false;
  state.pricingConfig = data.pricing || null;
  state.cancellationPolicy = normalizeCancellationPolicy(els.cancellationPolicy.value || "cancellable");
  state.stripeConfigured = Boolean(data.stripeConfigured);
  els.isVietnamese.value = "";
  els.bioSex.value = "";
  els.cancellationPolicy.value = state.cancellationPolicy;
  els.branchId.innerHTML = `<option value="">${window.t("select")} ${window.t("areYouVietnamese")} / ${window.t("biologicalSex")}</option>`;
  els.branchId.value = "";
  syncBranchMode();
  updateCancellationPolicyNote();
  updatePriceSummary(calculatePricingPreview());
  syncAuthUi();
}

async function loadGallery() {
  try {
    const response = await fetch("/api/gallery");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to load gallery.");
    }
    state.gallery = data;
    state.galleryBranchId = state.branchId;
    state.galleryIndex = 0;
    renderGallery();
  } catch (error) {
    state.gallery = null;
    if (els.galleryTitle && els.galleryCaption) {
      els.galleryImage.removeAttribute("src");
      els.galleryTitle.textContent = window.t("galleryUnavailable");
      els.galleryCaption.textContent = error.message || window.t("unableToLoadGallery");
      els.galleryBranchLabel.textContent = state.branchId || "D7";
      els.galleryCounter.textContent = "0 / 0";
      if (els.galleryDots) {
        els.galleryDots.innerHTML = "";
      }
    }
  }
}

async function sendVerificationCode() {
  const email = getAuthEmail();
  if (!email) {
    setAuthMessage("enterEmailFirst");
    return;
  }

  setAuthMessage("sendingCode");

  try {
    const response = await fetch("/api/guest-auth/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, website: String(els.authWebsite.value || "") })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to send verification code.");
    }
    setAuthMessage("codeSent", { email });
  } catch (error) {
    setAuthMessage(error.message || window.t("unableToSendCode"));
  }
}

async function verifyEmailCode() {
  const email = getAuthEmail();
  const code = String(els.authCode.value || "").trim();

  if (!email || !code) {
    setAuthMessage("enterEmailAndCode");
    return;
  }

  setAuthMessage("verifyingCode");

  try {
    const response = await fetch("/api/guest-auth/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to verify code.");
    }
    persistAuthSession(data.email, data.token, "verification");
    els.authCode.value = "";
    setAuthMessage("verifiedEmailNowBook", { email: data.email });
  } catch (error) {
    setAuthMessage(error.message || window.t("unableToVerifyCode"));
  }
}

async function createGuestAccountPassword() {
  const email = getAuthEmail();
  const password = String(els.accountPassword.value || "");
  const confirmPassword = String(els.accountPasswordConfirm.value || "");

  if (!email || !state.authToken) {
    setAccountMessage("verifyEmailFirst");
    return;
  }

  if (!password || password.length < 8) {
    setAccountMessage("passwordTooShort");
    return;
  }

  if (password !== confirmPassword) {
    setAccountMessage("passwordsDoNotMatch");
    return;
  }

  setAccountMessage("creatingAccount");

  try {
    const response = await fetch("/api/guest-account/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        guestAuthToken: state.authToken
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to create account.");
    }
    persistAuthSession(data.email, data.token, "account");
    els.accountPassword.value = "";
    els.accountPasswordConfirm.value = "";
    setAccountMessage("accountCreatedSignedIn");
  } catch (error) {
    setAccountMessage(error.message || window.t("unableToCreateAccount"));
  }
}

async function signInWithPassword() {
  const email = getAuthEmail();
  const password = String(els.accountPassword.value || "");

  if (!email || !password) {
    setAccountMessage("enterEmailPassword");
    return;
  }

  setAccountMessage("signingIn");

  try {
    const response = await fetch("/api/guest-account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to sign in.");
    }
    persistAuthSession(data.email, data.token, "account");
    els.accountPasswordConfirm.value = "";
    setAccountMessage("signedInPassword");
  } catch (error) {
    setAccountMessage(error.message || window.t("unableToSignIn"));
  }
}

function updateBookingInstructions() {
  if (state.isVietnamese && els.bioSex.value === "female" && state.branchId === "D2") {
    setMessage("instructionStep3D2VietnameseFemale");
    return;
  }
  if (state.isVietnamese && els.bioSex.value === "female" && state.branchId === "D7") {
    setMessage("instructionStep3D7VietnameseFemale");
    return;
  }
  if (state.isVietnamese && els.bioSex.value === "male") {
    setMessage("instructionStep3D7VietnameseMale");
    return;
  }
  if (!state.isVietnamese) {
    setMessage("instructionStep3D7Foreign");
    return;
  }
}

function renderRooms() {
  els.roomsGrid.innerHTML = "";

  if (!state.availability) {
    return;
  }

  for (const room of state.availability.rooms) {
    const card = document.createElement("article");
    card.className = "room-card";

    const meta = document.createElement("div");
    meta.className = "room-meta";
    meta.innerHTML = `
      <div>
        <h3>Room ${room.roomCode}</h3>
        <div class="section-note">${room.floorLabel}</div>
      </div>
    `;

    const bedsWrap = document.createElement("div");
    bedsWrap.className = "beds-wrap";

    for (const bed of room.beds) {
      const isSelected = state.selectedBed === bed.bedNumber;
      const bedPricing = calculateBedPricingPreview(bed);
      const hasPricing = Boolean(bedPricing && bedPricing.nights >= bedPricing.minimumStay);
      const showPricingDetails = Boolean(isSelected && hasPricing);
      const selectedPricing = showPricingDetails ? bedPricing : null;
      const priceText = showPricingDetails
        ? `Total after discount: ${formatCurrencyVnd(bedPricing.stayTotal)}`
        : `${formatCurrencyVnd(bed.nightlyPrice)}/night`;
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `
        <span class="bed-chip-label">Bed ${bed.bedNumber} - ${bed.bedLevel}</span>
        <span class="bed-chip-price">${priceText}</span>
        ${showPricingDetails ? `
          <span class="bed-chip-breakdown">
            <span class="bed-chip-breakdown-row"><span>Total nights</span><strong>${bedPricing.nights}</strong></span>
            <span class="bed-chip-breakdown-row"><span>Total price</span><strong>${formatCurrencyVnd(bedPricing.subtotal)}</strong></span>
            <span class="bed-chip-breakdown-row"><span>Discount</span><strong>${bedPricing.discountPercent > 0 ? `-${formatCurrencyVnd(bedPricing.discountAmount)}` : formatCurrencyVnd(0)}</strong></span>
            <span class="bed-chip-breakdown-row"><span>After discount</span><strong>${formatCurrencyVnd(bedPricing.stayTotal)}</strong></span>
            <span class="bed-chip-breakdown-row"><span>Nightly after discount</span><strong>${formatCurrencyVnd(bedPricing.nightlyRateAfterDiscount)}</strong></span>
          </span>
        ` : ""}
        ${isSelected && selectedPricing ? '<span class="bed-chip-note">Deposit excluded · 1,000,000 VND deposit shown below</span>' : ""}
      `;
      button.className = `bed-chip ${bed.status}${isSelected ? " selected" : ""}`;
      button.disabled = bed.status !== "available";
      if (bed.status === "available") {
        button.addEventListener("click", () => {
          state.selectedBed = bed.bedNumber;
          els.roomsCard.classList.remove("validation-target-invalid");
          updateSelectedBedLabel();
          updatePriceSummary(calculatePricingPreview());
          renderRooms();
          updateWizardUi();
        });
      }
      bedsWrap.appendChild(button);
    }

    card.appendChild(meta);
    card.appendChild(bedsWrap);
    els.roomsGrid.appendChild(card);
  }
}

async function loadAvailability() {
  syncBranchMode();
  state.checkIn = els.checkIn.value;
  state.checkOut = els.checkOut.value;
  state.bioSex = els.bioSex.value;
  state.selectedBed = null;
  updateSelectedBedLabel();
  updatePriceSummary(calculatePricingPreview());

  if (!hasRequiredBookingInputs()) {
    state.availability = null;
    els.roomsGrid.innerHTML = "";
    updateBookingInstructions();
    updateWizardUi();
    return;
  }

  setMessage("loadingAvailability");

  const params = new URLSearchParams({
    branchId: state.branchId,
    checkIn: state.checkIn,
    checkOut: state.checkOut,
    bioSex: state.bioSex
  });

  try {
    const response = await fetch(`/api/availability?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to load availability.");
    }
    state.availability = data;
    updatePriceSummary(calculatePricingPreview());
    renderRooms();
    setMessage(data.rooms.length ? "selectAvailableBed" : "noBedsEnteredInfo");
    updateWizardUi();
  } catch (error) {
    state.availability = null;
    els.roomsGrid.innerHTML = "";
    els.statusMessage.textContent = error.message || window.t("noBedsAvailable");
    updateWizardUi();
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read the ID photo."));
    reader.readAsDataURL(file);
  });
}

async function bookSelectedBed() {
  syncBranchMode();

  if (!validateBookingBeforeCheckout()) {
    return;
  }

  if (!state.stripeConfigured) {
    setMessage("stripeNotConfigured");
    return;
  }

  if (!state.isVietnamese && state.branchId === "D2") {
    setMessage("foreignGuestLimitedD7");
    return;
  }

  const pricingPreview = calculatePricingPreview();
  if (pricingPreview && pricingPreview.minimumStay && pricingPreview.nights < pricingPreview.minimumStay) {
    setMessage("minimumStayError", { min: pricingPreview.minimumStay });
    return;
  }

  if (state.branchId === "D2" && !els.idPhoto.files.length) {
    setMessage("Please upload a physical ID photo for D2 bookings.");
    return;
  }

  const payload = {
    branchId: els.branchId.value,
    isVietnamese: state.isVietnamese,
    cancellationPolicy: normalizeCancellationPolicy(els.cancellationPolicy.value || state.cancellationPolicy),
    bedNumber: state.selectedBed,
    checkIn: els.checkIn.value,
    checkOut: els.checkOut.value,
    guestName: els.guestName.value,
    guestEmail: els.guestEmail.value,
    bioSex: els.bioSex.value,
    guestPhone: els.guestPhone.value,
    notes: els.notes.value,
    guestAuthToken: state.authToken,
    referralCode: els.referralCode ? String(els.referralCode.value || "").trim() : ""
  };

  if (state.branchId === "D2") {
    const photoFile = els.idPhoto.files[0];
    payload.idPhotoFileName = photoFile.name;
    payload.idPhotoDataUrl = await readFileAsDataUrl(photoFile);
  }

  await persistRecentGuestProfile();

  setMessage("creatingCheckout");

  try {
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to create booking.");
    }
    if (data.mode === "card" && data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }
    throw new Error("Stripe checkout URL was not returned.");
  } catch (error) {
    setMessage(error.message || "Unable to create booking.");
  }
}

els.refreshBtn.addEventListener("click", () => void loadAvailability());
els.galleryD2Btn.addEventListener("click", () => {
  state.galleryBranchId = "D2";
  state.galleryIndex = 0;
  renderGallery();
});
els.galleryD7Btn.addEventListener("click", () => {
  state.galleryBranchId = "D7";
  state.galleryIndex = 0;
  renderGallery();
});
els.galleryPrevBtn.addEventListener("click", () => advanceGallery(-1));
els.galleryNextBtn.addEventListener("click", () => advanceGallery(1));
els.sendCodeBtn.addEventListener("click", () => void sendVerificationCode());
els.verifyCodeBtn.addEventListener("click", () => void verifyEmailCode());
els.createAccountBtn.addEventListener("click", () => void createGuestAccountPassword());
els.passwordLoginBtn.addEventListener("click", () => void signInWithPassword());
els.authEmail.addEventListener("input", () => {
  clearFieldInvalidState(els.authEmail);
  const current = getAuthEmail();
  if (state.authEmail && current !== state.authEmail) {
    clearAuthSession();
  } else {
    syncAuthUi();
  }
  scheduleRecentGuestProfileSave();
});
els.guestEmail.addEventListener("input", () => {
  clearFieldInvalidState(els.guestEmail);
  if (!String(els.authEmail.value || "").trim()) {
    els.authEmail.value = els.guestEmail.value.trim();
  }
  syncAuthUi();
  scheduleRecentGuestProfileSave();
});
els.guestName.addEventListener("input", () => {
  clearFieldInvalidState(els.guestName);
  scheduleRecentGuestProfileSave();
});
els.guestPhone.addEventListener("input", () => {
  clearFieldInvalidState(els.guestPhone);
  scheduleRecentGuestProfileSave();
});
els.cancellationPolicy.addEventListener("change", () => {
  clearFieldInvalidState(els.cancellationPolicy);
  updateCancellationPolicyNote();
  scheduleRecentGuestProfileSave();
  updatePriceSummary(calculatePricingPreview());
  renderRooms();
});
els.notes.addEventListener("input", () => scheduleRecentGuestProfileSave());
els.isVietnamese.addEventListener("change", () => {
  clearFieldInvalidState(els.isVietnamese);
  scheduleRecentGuestProfileSave();
  void loadAvailability();
});
els.branchId.addEventListener("change", () => {
  clearFieldInvalidState(els.branchId);
  scheduleRecentGuestProfileSave();
  void loadAvailability();
});
els.checkIn.addEventListener("change", () => {
  clearFieldInvalidState(els.checkIn);
  void loadAvailability();
});
els.checkOut.addEventListener("change", () => {
  clearFieldInvalidState(els.checkOut);
  void loadAvailability();
});
els.bioSex.addEventListener("change", () => {
  clearFieldInvalidState(els.bioSex);
  scheduleRecentGuestProfileSave();
  void loadAvailability();
});
els.idPhoto.addEventListener("change", () => {
  clearFieldInvalidState(els.idPhoto);
  if (els.idPhoto.files.length) {
    els.statusMessage.textContent = `${localStorage.getItem("cozoroGuestLanguage") === "vi" ? "Đã chọn ảnh:" : "Selected ID photo:"} ${els.idPhoto.files[0].name}`;
  } else {
    updateBookingInstructions();
  }
});
els.bookBtn.addEventListener("click", () => void bookSelectedBed());

(async function init() {
  await loadConfig();
  await loadReferralProgram();
  const refParam = new URLSearchParams(window.location.search).get("ref");
  if (refParam && els.referralCode) {
    els.referralCode.value = refParam.trim();
  }
  await loadRecentGuestProfile();
  await loadGallery();
  syncAuthUi();
  syncBranchMode();
  updateCancellationPolicyNote();
  setupGallerySwipe();
  setDefaultDates();
  updateSelectedBedLabel();
  updateBookingInstructions();
  await loadAvailability();
})();

window.addEventListener("languageChanged", () => {
  renderRooms();
  updateSelectedBedLabel();
  updatePriceSummary(calculatePricingPreview());
  updateWizardUi();
  updateCancellationPolicyNote();
  updateBranchOptions();
});
