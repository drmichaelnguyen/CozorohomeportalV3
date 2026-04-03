const els = {
  loginForm: document.getElementById("loginForm"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginStatus: document.getElementById("loginStatus"),
  bookingsList: document.getElementById("bookingsList"),
  refreshBtn: document.getElementById("refreshBtn"),
  logoutBtn: document.getElementById("logoutBtn")
};

const state = {
  email: localStorage.getItem("guestBookingAuthEmail") || "",
  token: localStorage.getItem("guestBookingAuthToken") || "",
  bookings: [],
  previewTimers: new Map()
};

const ADDRESS_MAP = {
  D2: "491 Hau Giang, Ward 11, District 6",
  D7: "7a/19/28 Thanh Thai, Ward 14, district 10. The alley next to CashFlow Coffee"
};

function setStatus(message) {
  els.loginStatus.textContent = message || "";
}

function formatCurrencyVnd(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);
}

function renderBookings() {
  els.bookingsList.innerHTML = "";

  if (!state.bookings.length) {
    els.bookingsList.innerHTML = '<p class="section-note">No bookings found for that email.</p>';
    return;
  }

  for (const booking of state.bookings) {
    const card = document.createElement("article");
    card.className = "booking-manage-card";
    const isCancelled = booking.status === "CANCELLED";
    const refundSummary = booking.cancellationTerms
      ? `${booking.cancellationTerms.message} Refund if cancelled now: ${formatCurrencyVnd(booking.cancellationTerms.refundableAmount || 0)}.`
      : "Cancellation policy unavailable.";
    card.innerHTML = `
      <div class="booking-manage-head">
        <div>
          <h3>${escapeHtml(booking.branchId)} - Bed ${escapeHtml(String(booking.bedNumber))}</h3>
          <p class="section-note">${escapeHtml(booking.exactAddress)}</p>
        </div>
        <div class="summary-box compact">
          <div class="summary-label">Status</div>
          <div class="summary-value">${escapeHtml(booking.status)}</div>
        </div>
      </div>
      <div class="booking-manage-grid">
        <label>
          Guest name
          <input data-field="guestName" type="text" value="${escapeHtml(booking.guestName || "")}" disabled />
        </label>
        <label>
          Guest phone
          <input data-field="guestPhone" type="text" value="${escapeHtml(booking.guestPhone || "")}" ${isCancelled ? "disabled" : ""} />
        </label>
        <label>
          Check-in
          <input data-field="checkIn" type="date" value="${booking.checkIn}" ${isCancelled ? "disabled" : ""} />
        </label>
        <label>
          Check-out
          <input data-field="checkOut" type="date" value="${booking.checkOut}" ${isCancelled ? "disabled" : ""} />
        </label>
        <label>
          Cancellation option
          <input type="text" value="${escapeHtml(booking.cancellationPolicyLabel || booking.cancellationPolicy || "")}" disabled />
        </label>
      </div>
      <label>
        Notes
        <textarea data-field="notes" rows="4" ${isCancelled ? "disabled" : ""}>${escapeHtml(booking.notes || "")}</textarea>
      </label>
      <div class="section-note">${escapeHtml(booking.cancellationPolicyDescription || "")}</div>
      <div class="section-note">${escapeHtml(refundSummary)}</div>
      ${booking.refundStatus ? `<div class="section-note">Refund status: ${escapeHtml(booking.refundStatus)}${booking.refundedAmount ? ` · Refunded ${escapeHtml(formatCurrencyVnd(booking.refundedAmount))}` : ""}</div>` : ""}
      ${isCancelled ? "" : '<div class="booking-change-preview" data-preview><strong>Change preview</strong><div class="section-note">Edit the dates to preview any extra payment or refund before saving.</div></div>'}
      <div class="section-note">
        ${booking.faceCaptureCompleted ? "Face + ID capture completed." : booking.faceCaptureOpen ? "Face + ID capture is open within the 48-hour window." : "Face + ID capture is not open yet."}
      </div>
      <div class="booking-actions">
        <button type="button" data-action="save" ${isCancelled ? "disabled" : ""}>Save changes</button>
        <button type="button" data-action="cancel" class="secondary-btn" ${isCancelled ? "disabled" : ""}>Cancel booking</button>
        ${isCancelled ? "" : `<a class="ghost-link" href="/face-capture.html?booking_id=${encodeURIComponent(booking.id)}">Open face capture</a>`}
      </div>
      <p class="status-message card-status" data-status></p>
    `;

    const statusEl = card.querySelector("[data-status]");
    const saveBtn = card.querySelector('[data-action="save"]');
    const cancelBtn = card.querySelector('[data-action="cancel"]');
    const previewEl = card.querySelector("[data-preview]");
    saveBtn.addEventListener("click", () => void saveBooking(booking, card, statusEl));
    cancelBtn.addEventListener("click", () => void cancelBooking(booking, statusEl));
    if (!isCancelled && previewEl) {
      for (const field of ["guestPhone", "checkIn", "checkOut", "notes"]) {
        const input = card.querySelector(`[data-field="${field}"]`);
        if (input) {
          input.addEventListener("input", () => schedulePreviewBookingChange(booking, card, previewEl));
          input.addEventListener("change", () => schedulePreviewBookingChange(booking, card, previewEl));
        }
      }
      void previewBookingChange(booking, card, previewEl);
    }
    els.bookingsList.appendChild(card);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPreview(previewEl, preview) {
  if (!previewEl) {
    return;
  }

  if (!preview) {
    previewEl.innerHTML = '<strong>Change preview</strong><div class="section-note">Edit the dates to preview any extra payment or refund before saving.</div>';
    return;
  }

  const diffText = preview.totalDifference > 0
    ? `Additional payment: ${formatCurrencyVnd(preview.totalDifference)}`
    : preview.totalDifference < 0
      ? `Potential refund: ${formatCurrencyVnd(preview.refundAmount || 0)}`
      : "No price difference";

  previewEl.innerHTML = `
    <strong>Change preview</strong>
    <div class="section-note">${escapeHtml(preview.message || "")}</div>
    <div class="section-note">${escapeHtml(diffText)}</div>
    <div class="section-note">Current total: ${escapeHtml(formatCurrencyVnd(preview.currentPricing?.total || 0))}</div>
    <div class="section-note">Updated total: ${escapeHtml(formatCurrencyVnd(preview.requestedPricing?.total || 0))}</div>
  `;
}

async function previewBookingChange(booking, card, previewEl) {
  const guestPhone = card.querySelector('[data-field="guestPhone"]').value.trim();
  const checkIn = card.querySelector('[data-field="checkIn"]').value;
  const checkOut = card.querySelector('[data-field="checkOut"]').value;
  const notes = card.querySelector('[data-field="notes"]').value.trim();

  try {
    const response = await fetch(`/api/guest-bookings/${encodeURIComponent(booking.id)}/preview-change`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guestEmail: state.email,
        guestAuthToken: state.token,
        guestPhone,
        checkIn,
        checkOut,
        notes
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to preview booking change.");
    }
    renderPreview(previewEl, data.preview || null);
  } catch (error) {
    previewEl.innerHTML = `<strong>Change preview</strong><div class="section-note">${escapeHtml(error.message || "Unable to preview booking change.")}</div>`;
  }
}

function schedulePreviewBookingChange(booking, card, previewEl) {
  const existing = state.previewTimers.get(booking.id);
  if (existing) {
    window.clearTimeout(existing);
  }
  const timer = window.setTimeout(() => {
    void previewBookingChange(booking, card, previewEl);
  }, 350);
  state.previewTimers.set(booking.id, timer);
}

async function loadBookings() {
  if (!state.email || !state.token) {
    els.bookingsList.innerHTML = '<p class="section-note">Log in with your email and password to see your bookings.</p>';
    return;
  }

  setStatus("Loading your bookings...");

  try {
    const response = await fetch(`/api/guest-bookings?email=${encodeURIComponent(state.email)}&guestAuthToken=${encodeURIComponent(state.token)}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to load bookings.");
    }
    state.bookings = data.bookings || [];
    renderBookings();
    setStatus(`Loaded ${state.bookings.length} booking(s) for ${state.email}.`);
  } catch (error) {
    els.bookingsList.innerHTML = "";
    setStatus(error.message || "Unable to load bookings.");
  }
}

async function saveBooking(booking, card, statusEl) {
  const guestPhone = card.querySelector('[data-field="guestPhone"]').value.trim();
  const checkIn = card.querySelector('[data-field="checkIn"]').value;
  const checkOut = card.querySelector('[data-field="checkOut"]').value;
  const notes = card.querySelector('[data-field="notes"]').value.trim();

  statusEl.textContent = "Saving changes...";

  try {
    const response = await fetch(`/api/guest-bookings/${encodeURIComponent(booking.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guestEmail: state.email,
        guestAuthToken: state.token,
        guestPhone,
        checkIn,
        checkOut,
        notes
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to save booking.");
    }

    if (data.requiresPayment && data.checkoutUrl) {
      statusEl.textContent = data.message || "Redirecting to Stripe for the additional payment...";
      window.location.href = data.checkoutUrl;
      return;
    }

    statusEl.textContent = data.message || "Saved.";
    setStatus(`Saved changes for ${state.email}.`);
    await loadBookings();
  } catch (error) {
    statusEl.textContent = error.message || "Unable to save booking.";
  }
}

async function cancelBooking(booking, statusEl) {
  const refundableNow = booking.cancellationTerms ? formatCurrencyVnd(booking.cancellationTerms.refundableAmount || 0) : formatCurrencyVnd(0);
  const confirmed = window.confirm(`Cancel this booking?\n\n${booking.cancellationTerms?.message || "Refund policy unavailable."}\nRefund if cancelled now: ${refundableNow}`);
  if (!confirmed) {
    return;
  }

  statusEl.textContent = "Cancelling booking and processing any refund...";

  try {
    const response = await fetch(`/api/guest-bookings/${encodeURIComponent(booking.id)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guestEmail: state.email,
        guestAuthToken: state.token
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to cancel booking.");
    }

    statusEl.textContent = data.refund?.message
      ? `${data.refund.message} ${data.refund.amount ? `Refund started: ${formatCurrencyVnd(data.refund.amount)}.` : ""}`.trim()
      : "Booking cancelled.";
    await loadBookings();
  } catch (error) {
    statusEl.textContent = error.message || "Unable to cancel booking.";
  }
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.email = els.loginEmail.value.trim().toLowerCase();
  const password = String(els.loginPassword.value || "");

  if (!state.email || !password) {
    setStatus("Enter your email and password.");
    return;
  }

  setStatus("Signing in...");

  try {
    const response = await fetch("/api/guest-account/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: state.email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to sign in.");
    }
    state.token = data.token;
    localStorage.setItem("guestBookingAuthEmail", data.email);
    localStorage.setItem("guestBookingAuthToken", data.token);
    localStorage.setItem("guestBookingAuthMode", "account");
    els.loginPassword.value = "";
    await loadBookings();
  } catch (error) {
    setStatus(error.message || "Unable to sign in.");
  }
});

els.refreshBtn.addEventListener("click", () => void loadBookings());
els.logoutBtn.addEventListener("click", () => {
  state.email = "";
  state.token = "";
  state.bookings = [];
  localStorage.removeItem("guestBookingAuthEmail");
  localStorage.removeItem("guestBookingAuthToken");
  localStorage.removeItem("guestBookingAuthMode");
  els.loginEmail.value = "";
  els.loginPassword.value = "";
  els.bookingsList.innerHTML = '<p class="section-note">You have been logged out.</p>';
  setStatus("");
});

function init() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");
  if (sessionId) {
    void confirmBookingPayment(sessionId);
  }

  if (state.email) {
    els.loginEmail.value = state.email;
    if (state.token) {
      void loadBookings();
    } else {
      els.bookingsList.innerHTML = '<p class="section-note">Log in with your email and password to see your bookings.</p>';
    }
  } else {
    els.bookingsList.innerHTML = '<p class="section-note">Log in with your email and password to see your bookings.</p>';
  }
}

async function confirmBookingPayment(sessionId) {
  setStatus("Confirming your Stripe payment...");

  try {
    const response = await fetch(`/api/confirm-payment?session_id=${encodeURIComponent(sessionId)}`);
    const data = await response.json();
    if (!response.ok || !data.paid) {
      throw new Error(data.error || "Payment not completed yet.");
    }

    const actionMessage = data.action === "booking_adjustment"
      ? "Payment complete. Your booking change is now confirmed."
      : "Payment complete.";
    setStatus(actionMessage);
    window.history.replaceState({}, document.title, "/manage-booking.html");
    if (state.email && state.token) {
      await loadBookings();
    }
  } catch (error) {
    setStatus(error.message || "Unable to confirm payment.");
  }
}

init();
