const els = {
  captureStatus: document.getElementById("captureStatus"),
  exactAddress: document.getElementById("exactAddress"),
  cameraFeed: document.getElementById("cameraFeed"),
  captureCanvas: document.getElementById("captureCanvas"),
  idHeldTogether: document.getElementById("idHeldTogether"),
  startBtn: document.getElementById("startBtn"),
  captureBtn: document.getElementById("captureBtn"),
  submitBtn: document.getElementById("submitBtn"),
  previewImage: document.getElementById("previewImage")
};

const state = {
  bookingId: "",
  branchId: "",
  stream: null,
  capturedDataUrl: ""
};

const ADDRESS_MAP = {
  D2: "491 Hau Giang, Ward 11, District 6",
  D7: "7a/19/28 Thanh Thai, Ward 14, district 10. The alley next to CashFlow Coffee"
};

function setStatus(message) {
  els.captureStatus.textContent = message || "";
}

function getBookingId() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("booking_id") || "").trim();
}

async function loadCaptureStatus() {
  state.bookingId = getBookingId();
  if (!state.bookingId) {
    setStatus("Missing booking id.");
    els.startBtn.disabled = true;
    els.captureBtn.disabled = true;
    els.submitBtn.disabled = true;
    return;
  }

  try {
    const response = await fetch(`/api/face-capture-status?booking_id=${encodeURIComponent(state.bookingId)}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to load face capture status.");
    }

    if (data.faceCaptureCompleted) {
      setStatus("Face + ID capture is already complete for this booking.");
      els.startBtn.disabled = true;
      els.captureBtn.disabled = true;
      els.submitBtn.disabled = true;
      return;
    }

    state.branchId = data.branchId || "";
    els.exactAddress.textContent = ADDRESS_MAP[state.branchId]
      ? `Exact address for confirmed stay: ${ADDRESS_MAP[state.branchId]}`
      : "";

    if (!data.faceCaptureOpen) {
      const hours = Math.max(0, Math.ceil(Number(data.hoursUntilCheckIn || 0)));
      setStatus(`Face capture opens within 48 hours before check-in. Please come back in about ${hours} hour(s).`);
      els.startBtn.disabled = true;
      els.captureBtn.disabled = true;
      els.submitBtn.disabled = true;
      return;
    }

    setStatus("Face + ID capture is open. Start the camera and capture your face with the ID visible next to it.");
    els.startBtn.disabled = false;
  } catch (error) {
    setStatus(error.message || "Unable to load face capture status.");
  }
}

async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });
    els.cameraFeed.srcObject = state.stream;
    els.captureBtn.disabled = false;
    setStatus("Camera ready. Capture a clear face photo with your physical ID held next to your face.");
  } catch (error) {
    setStatus(error.message || "Unable to access the camera.");
  }
}

function captureFrame() {
  if (!state.stream) {
    setStatus("Start the camera first.");
    return;
  }

  const video = els.cameraFeed;
  const canvas = els.captureCanvas;
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  state.capturedDataUrl = canvas.toDataURL("image/jpeg", 0.92);
  els.previewImage.src = state.capturedDataUrl;
  els.previewImage.classList.remove("hidden");
  els.submitBtn.disabled = false;
  setStatus("Face + ID captured locally. Save it to the booking now.");
}

async function submitCapture() {
  if (!state.capturedDataUrl) {
    setStatus("Capture your face first.");
    return;
  }

  if (!els.idHeldTogether.checked) {
    setStatus("Confirm that you are holding your physical ID next to your face.");
    return;
  }

  try {
    const response = await fetch("/api/face-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId: state.bookingId,
        faceDataUrl: state.capturedDataUrl,
        idHeldTogether: true
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to save face capture.");
    }

    setStatus("Face + ID capture saved locally.");
    els.captureBtn.disabled = true;
    els.submitBtn.disabled = true;
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
      state.stream = null;
    }
  } catch (error) {
    setStatus(error.message || "Unable to save face capture.");
  }
}

els.startBtn.addEventListener("click", () => void startCamera());
els.captureBtn.addEventListener("click", () => captureFrame());
els.submitBtn.addEventListener("click", () => void submitCapture());

loadCaptureStatus();
