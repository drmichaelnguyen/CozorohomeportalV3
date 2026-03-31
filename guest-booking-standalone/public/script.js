const state = {
  branchId: "D7",
  checkIn: "",
  checkOut: "",
  bioSex: "",
  selectedBed: null,
  availability: null,
  pricingConfig: null,
  stripeConfigured: false
};

const els = {
  siteTitle: document.getElementById("siteTitle"),
  branchId: document.getElementById("branchId"),
  checkIn: document.getElementById("checkIn"),
  checkOut: document.getElementById("checkOut"),
  bioSex: document.getElementById("bioSex"),
  refreshBtn: document.getElementById("refreshBtn"),
  roomsGrid: document.getElementById("roomsGrid"),
  selectedBedLabel: document.getElementById("selectedBedLabel"),
  priceSummary: document.getElementById("priceSummary"),
  priceDetails: document.getElementById("priceDetails"),
  statusMessage: document.getElementById("statusMessage"),
  guestName: document.getElementById("guestName"),
  guestEmail: document.getElementById("guestEmail"),
  guestPhone: document.getElementById("guestPhone"),
  notes: document.getElementById("notes"),
  bookBtn: document.getElementById("bookBtn")
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

function setMessage(message) {
  els.statusMessage.textContent = message || "";
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
    ? `Bed ${selectedBed.bedNumber} (${selectedBed.bedLevel})`
    : `Bed ${state.selectedBed}`;
}

function formatCurrencyVnd(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);
}

function calculatePricingPreview() {
  if (!state.pricingConfig || !els.checkIn.value || !els.checkOut.value) {
    return null;
  }

  const start = new Date(`${els.checkIn.value}T00:00:00.000Z`);
  const end = new Date(`${els.checkOut.value}T00:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) {
    return null;
  }

  const nights = Math.round((end.getTime() - start.getTime()) / 86400000);
  let discountRate = 0;

  if (nights >= 28) {
    discountRate = state.pricingConfig.monthlyDiscountRate;
  } else if (nights >= 7) {
    discountRate = state.pricingConfig.weeklyDiscountRate;
  }

  const subtotal = state.pricingConfig.baseNightlyPrice * nights;
  const discountAmount = Math.round(subtotal * discountRate);

  return {
    nights,
    baseNightlyPrice: state.pricingConfig.baseNightlyPrice,
    discountRate,
    total: subtotal - discountAmount
  };
}

function updatePriceSummary(pricing) {
  if (!pricing) {
    els.priceSummary.textContent = "Enter dates to calculate";
    els.priceDetails.textContent = "";
    return;
  }

  const discountPercent = Math.round(pricing.discountRate * 100);
  els.priceSummary.textContent = formatCurrencyVnd(pricing.total);
  els.priceDetails.textContent = discountPercent > 0
    ? `${pricing.nights} nights at ${formatCurrencyVnd(pricing.baseNightlyPrice)}/night with ${discountPercent}% discount`
    : `${pricing.nights} nights at ${formatCurrencyVnd(pricing.baseNightlyPrice)}/night`;
}

function hasRequiredBookingInputs() {
  return Boolean(
    els.branchId.value &&
    els.checkIn.value &&
    els.checkOut.value &&
    els.guestName.value.trim() &&
    els.guestEmail.value.trim() &&
    els.guestPhone.value.trim() &&
    els.bioSex.value
  );
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const data = await response.json();
  document.title = data.siteTitle;
  els.siteTitle.textContent = data.siteTitle;
  state.branchId = data.defaultBranch;
  state.pricingConfig = data.pricing || null;
  state.stripeConfigured = Boolean(data.stripeConfigured);
  els.branchId.value = data.defaultBranch;
  updatePriceSummary(calculatePricingPreview());
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
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Bed ${bed.bedNumber} - ${bed.bedLevel}`;
      button.className = `bed-chip ${bed.status}${state.selectedBed === bed.bedNumber ? " selected" : ""}`;
      button.disabled = bed.status !== "available";
      if (bed.status === "available") {
        button.addEventListener("click", () => {
          state.selectedBed = bed.bedNumber;
          updateSelectedBedLabel();
          renderRooms();
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
  state.branchId = els.branchId.value;
  state.checkIn = els.checkIn.value;
  state.checkOut = els.checkOut.value;
  state.bioSex = els.bioSex.value;
  state.selectedBed = null;
  updateSelectedBedLabel();
  updatePriceSummary(calculatePricingPreview());

  if (!hasRequiredBookingInputs()) {
    state.availability = null;
    els.roomsGrid.innerHTML = "";
    setMessage("Enter name, email, phone number, biological sex, branch, and dates to see available beds.");
    return;
  }

  setMessage("Loading available beds...");

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
    updatePriceSummary(data.pricing || calculatePricingPreview());
    renderRooms();
    setMessage(data.rooms.length ? "Select one of the available beds below." : "No beds are currently available for the information entered.");
  } catch (error) {
    state.availability = null;
    els.roomsGrid.innerHTML = "";
    setMessage(error.message || "Unable to load availability.");
  }
}

async function bookSelectedBed() {
  if (!state.selectedBed) {
    setMessage("Select an available bed first.");
    return;
  }

  if (!state.stripeConfigured) {
    setMessage("Stripe is not configured yet on this booking site.");
    return;
  }

  const payload = {
    branchId: els.branchId.value,
    bedNumber: state.selectedBed,
    checkIn: els.checkIn.value,
    checkOut: els.checkOut.value,
    guestName: els.guestName.value,
    guestEmail: els.guestEmail.value,
    bioSex: els.bioSex.value,
    guestPhone: els.guestPhone.value,
    notes: els.notes.value
  };

  setMessage("Creating secure Stripe checkout...");

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
els.branchId.addEventListener("change", () => void loadAvailability());
els.checkIn.addEventListener("change", () => void loadAvailability());
els.checkOut.addEventListener("change", () => void loadAvailability());
els.bioSex.addEventListener("change", () => void loadAvailability());
els.guestName.addEventListener("input", () => void loadAvailability());
els.guestEmail.addEventListener("input", () => void loadAvailability());
els.guestPhone.addEventListener("input", () => void loadAvailability());
els.bookBtn.addEventListener("click", () => void bookSelectedBed());

(async function init() {
  await loadConfig();
  setDefaultDates();
  updateSelectedBedLabel();
  await loadAvailability();
})();
