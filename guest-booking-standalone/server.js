const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs/promises");
const mysql = require("mysql2/promise");
const Stripe = require("stripe");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = Number(process.env.PORT || 3100);
const SITE_TITLE = process.env.SITE_TITLE || "CozoroHome Guest Booking";
const DEFAULT_BRANCH = normalizeBranch(process.env.DEFAULT_BRANCH || "D7");
const CLIENT_CACHE_PATH = path.resolve(__dirname, process.env.CLIENT_CACHE_PATH || "../api/data/clients-cache.json");
const BOOKING_TABLE_NAME = process.env.BOOKING_TABLE_NAME || "guest_stay_bookings";
const DATABASE_URL = process.env.DATABASE_URL || "";
const SITE_URL = process.env.SITE_URL || process.env.ONLINE_URL || `http://localhost:${PORT}`;
const MAIN_APP_API_URL = String(process.env.MAIN_APP_API_URL || "http://localhost:4000").replace(/\/+$/, "");
const MAIN_APP_API_KEY = String(process.env.INTERNAL_API_KEY || process.env.MAIN_APP_API_KEY || "").trim();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const BIO_SEX_RULES = {
  female: new Set(["Floor 1", "Floor 3"]),
  male: new Set(["Floor 2"])
};
const PRICING = {
  currency: "VND",
  baseNightlyPrice: 221425,
  weeklyDiscountRate: 0.4,
  monthlyDiscountRate: 0.55
};

const BRANCH_LAYOUTS = {
  D2: [
    { roomCode: "1", floorLabel: "D2", startBed: 1, endBed: 9 },
    { roomCode: "2", floorLabel: "D2", startBed: 10, endBed: 15 },
    { roomCode: "3", floorLabel: "D2", startBed: 16, endBed: 21 }
  ],
  D7: [
    { roomCode: "1.1", floorLabel: "Floor 1", startBed: 1, endBed: 9 },
    { roomCode: "1.2", floorLabel: "Floor 1", startBed: 10, endBed: 15 },
    { roomCode: "1.3", floorLabel: "Floor 1", startBed: 16, endBed: 24 },
    { roomCode: "2.1", floorLabel: "Floor 2", startBed: 25, endBed: 33 },
    { roomCode: "2.2", floorLabel: "Floor 2", startBed: 34, endBed: 39 },
    { roomCode: "2.3", floorLabel: "Floor 2", startBed: 40, endBed: 48 },
    { roomCode: "3.1", floorLabel: "Floor 3", startBed: 49, endBed: 57 },
    { roomCode: "3.2", floorLabel: "Floor 3", startBed: 58, endBed: 63 }
  ]
};

let pool = null;

function normalizeBranch(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "7" || normalized === "D7" || normalized.includes("D7") || normalized.includes("AD7")) {
    return "D7";
  }
  return "D2";
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getRowValue(row, matcher) {
  for (const [key, value] of Object.entries(row || {})) {
    if (matcher(normalizeKey(key))) {
      return String(value || "").trim();
    }
  }
  return "";
}

function getActiveStayValue(row) {
  return getRowValue(row, (key) => key.includes("hienconoo") || key.includes("hiencono") || key === "activeStay");
}

function getBedValue(row) {
  return getRowValue(row, (key) => key.includes("sogiuong") || key === "bed" || key.includes("bednumber"));
}

function getBranchValue(row) {
  return getRowValue(row, (key) => key.includes("chinhanhcozorodorm") || (key.includes("chinhanh") && key.includes("dorm")) || key === "branch");
}

function parseBedNumber(value) {
  const parsed = Number.parseInt(String(value || "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dateOnlyToUtc(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function nightsBetween(checkIn, checkOut) {
  const start = dateOnlyToUtc(checkIn);
  const end = dateOnlyToUtc(checkOut);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function ensureValidDateRange(checkIn, checkOut) {
  const start = dateOnlyToUtc(checkIn);
  const end = dateOnlyToUtc(checkOut);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) {
    throw new Error("Invalid check-in/check-out dates.");
  }
  return { start, end };
}

function getRoomLayoutForBed(branchId, bedNumber) {
  return BRANCH_LAYOUTS[branchId].find((room) => bedNumber >= room.startBed && bedNumber <= room.endBed) || null;
}

function normalizeBioSex(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["female", "f", "woman", "girl"].includes(normalized)) {
    return "female";
  }
  if (["male", "m", "man", "boy"].includes(normalized)) {
    return "male";
  }
  return "";
}

function isRoomAllowedForBioSex(branchId, room, bioSex) {
  if (branchId !== "D7") {
    return true;
  }

  const allowedFloors = BIO_SEX_RULES[bioSex];
  return Boolean(allowedFloors && allowedFloors.has(room.floorLabel));
}

function getBedLevelLabel(room, bedNumber) {
  const offset = bedNumber - room.startBed;
  const cycle = ["Bottom bed", "Middle bed", "Top bed"];
  return cycle[((offset % cycle.length) + cycle.length) % cycle.length];
}

async function syncPaidGuestBookingToMainApp(input) {
  const response = await fetch(`${MAIN_APP_API_URL}/internal/guest-bookings/import-paid`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(MAIN_APP_API_KEY ? { "x-internal-api-key": MAIN_APP_API_KEY } : {})
    },
    body: JSON.stringify({
      guestEmail: String(input.guestEmail || "").trim().toLowerCase(),
      guestName: input.guestName,
      guestPhone: input.guestPhone || "",
      bioSex: input.bioSex,
      branchId: input.branchId,
      bedNumber: Number(input.bedNumber),
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      pricingTotal: Number(input.pricing.total) || 0,
      notes: input.notes || ""
    })
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Main app import failed (${response.status}): ${payload}`);
  }
}

async function getPool() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!pool) {
    pool = mysql.createPool(DATABASE_URL);
    await ensureBookingTable();
  }

  return pool;
}

async function ensureBookingTable() {
  const connectionPool = pool || mysql.createPool(DATABASE_URL);
  await connectionPool.query(`
    CREATE TABLE IF NOT EXISTS \`${BOOKING_TABLE_NAME}\` (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      branch_id VARCHAR(10) NOT NULL,
      room_code VARCHAR(20) NOT NULL,
      bed_number INT NOT NULL,
      guest_name VARCHAR(255) NOT NULL,
      guest_email VARCHAR(255) NOT NULL,
      guest_phone VARCHAR(100) NULL,
      bio_sex VARCHAR(20) NULL,
      check_in DATETIME NOT NULL,
      check_out DATETIME NOT NULL,
      nights INT NOT NULL,
      notes TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
      payment_status VARCHAR(30) NULL,
      stripe_session_id VARCHAR(255) NULL,
      amount_paid INT NULL,
      currency VARCHAR(10) NULL,
      source VARCHAR(40) NOT NULL DEFAULT 'STANDALONE_WEB',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_branch_dates (branch_id, check_in, check_out),
      INDEX idx_branch_bed_dates (branch_id, bed_number, check_in, check_out),
      INDEX idx_guest_email_created (guest_email, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  try {
    await connectionPool.query(`ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN bio_sex VARCHAR(20) NULL AFTER guest_phone`);
  } catch (error) {
    if (!error || error.code !== "ER_DUP_FIELDNAME") {
      throw error;
    }
  }
  for (const statement of [
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN payment_status VARCHAR(30) NULL AFTER status`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN stripe_session_id VARCHAR(255) NULL AFTER payment_status`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN amount_paid INT NULL AFTER stripe_session_id`,
    `ALTER TABLE \`${BOOKING_TABLE_NAME}\` ADD COLUMN currency VARCHAR(10) NULL AFTER amount_paid`
  ]) {
    try {
      await connectionPool.query(statement);
    } catch (error) {
      if (!error || error.code !== "ER_DUP_FIELDNAME") {
        throw error;
      }
    }
  }
  if (!pool) {
    await connectionPool.end();
  }
}

async function readClientCache() {
  try {
    const raw = await fs.readFile(CLIENT_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.rows) ? parsed.rows : [];
  } catch {
    return [];
  }
}

async function getResidentOccupiedBeds(branchId) {
  const rows = await readClientCache();
  const occupied = new Set();

  for (const row of rows) {
    if (getActiveStayValue(row) !== "1") {
      continue;
    }

    if (normalizeBranch(getBranchValue(row)) !== branchId) {
      continue;
    }

    const bedNumber = parseBedNumber(getBedValue(row));
    if (bedNumber) {
      occupied.add(bedNumber);
    }
  }

  return occupied;
}

async function getOverlappingGuestBookings(branchId, checkIn, checkOut) {
  const { start, end } = ensureValidDateRange(checkIn, checkOut);
  const connectionPool = await getPool();
  const [rows] = await connectionPool.query(
    `
      SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, check_in, check_out, nights, notes, status
      FROM \`${BOOKING_TABLE_NAME}\`
      WHERE branch_id = ?
        AND status = 'CONFIRMED'
        AND check_in < ?
        AND check_out > ?
      ORDER BY room_code ASC, bed_number ASC
    `,
    [branchId, end, start]
  );

  return rows;
}

async function buildAvailability(branchId, checkIn, checkOut, bioSex) {
  const normalizedBioSex = normalizeBioSex(bioSex);
  if (branchId === "D7" && !normalizedBioSex) {
    throw new Error("Biological sex is required to view D7 availability.");
  }
  const nights = nightsBetween(checkIn, checkOut);

  const [residentBeds, guestBookings] = await Promise.all([
    getResidentOccupiedBeds(branchId),
    getOverlappingGuestBookings(branchId, checkIn, checkOut)
  ]);

  const bookedBeds = new Map(guestBookings.map((booking) => [Number(booking.bed_number), booking]));
  const rooms = BRANCH_LAYOUTS[branchId]
    .filter((room) => isRoomAllowedForBioSex(branchId, room, normalizedBioSex))
    .map((room) => {
    const beds = Array.from({ length: room.endBed - room.startBed + 1 }, (_, index) => {
      const bedNumber = room.startBed + index;
      const guestBooking = bookedBeds.get(bedNumber) || null;
      let status = "available";

      if (residentBeds.has(bedNumber)) {
        status = "occupied_resident";
      } else if (guestBooking) {
        status = "occupied_booking";
      }

      return {
        bedNumber,
        bedLevel: getBedLevelLabel(room, bedNumber),
        status,
        bookingGuestName: guestBooking ? guestBooking.guest_name : null
      };
    }).filter((bed) => bed.status === "available");

    return {
      roomCode: room.roomCode,
      floorLabel: room.floorLabel,
      beds
    };
  })
    .filter((room) => room.beds.length > 0);

  return {
    branchId,
    checkIn,
    checkOut,
    nights,
    bioSex: normalizedBioSex,
    pricing: calculatePricing(nights),
    rooms
  };
}

function createId() {
  return `stay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function calculatePricing(nights) {
  let discountRate = 0;

  if (nights >= 28) {
    discountRate = PRICING.monthlyDiscountRate;
  } else if (nights >= 7) {
    discountRate = PRICING.weeklyDiscountRate;
  }

  const subtotal = PRICING.baseNightlyPrice * nights;
  const discountAmount = Math.round(subtotal * discountRate);

  return {
    currency: PRICING.currency,
    baseNightlyPrice: PRICING.baseNightlyPrice,
    nights,
    discountRate,
    discountAmount,
    total: subtotal - discountAmount
  };
}

function getRequestSiteUrl(req) {
  const origin = String(req.get("origin") || "").trim();
  return origin || SITE_URL;
}

async function createPendingBooking(input) {
  const connectionPool = await getPool();
  const { start, end } = ensureValidDateRange(input.checkIn, input.checkOut);
  const pricing = calculatePricing(nightsBetween(input.checkIn, input.checkOut));
  const id = createId();

  await connectionPool.query(
    `
      INSERT INTO \`${BOOKING_TABLE_NAME}\`
      (id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, bio_sex, check_in, check_out, nights, notes, status, payment_status, currency, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT', 'unpaid', ?, 'STANDALONE_WEB')
    `,
    [
      id,
      input.branchId,
      input.roomCode,
      input.bedNumber,
      input.guestName,
      input.guestEmail,
      input.guestPhone || null,
      input.bioSex,
      start,
      end,
      pricing.nights,
      input.notes || null,
      pricing.currency.toLowerCase()
    ]
  );

  return { id, pricing, start, end };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (_req, res) => {
  res.json({
    siteTitle: SITE_TITLE,
    defaultBranch: DEFAULT_BRANCH,
    siteUrl: SITE_URL,
    stripeConfigured: Boolean(stripe),
    pricing: {
      currency: PRICING.currency,
      baseNightlyPrice: PRICING.baseNightlyPrice,
      weeklyDiscountRate: PRICING.weeklyDiscountRate,
      monthlyDiscountRate: PRICING.monthlyDiscountRate
    }
  });
});

app.get("/api/availability", async (req, res) => {
  const branchId = normalizeBranch(req.query.branchId || DEFAULT_BRANCH);
  const checkIn = String(req.query.checkIn || "");
  const checkOut = String(req.query.checkOut || "");
  const bioSex = String(req.query.bioSex || "");

  if (!checkIn || !checkOut) {
    return res.status(400).json({ error: "checkIn and checkOut are required." });
  }

  try {
    const availability = await buildAvailability(branchId, checkIn, checkOut, bioSex);
    return res.json(availability);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to load availability." });
  }
});

app.post("/api/bookings", async (req, res) => {
  const branchId = normalizeBranch(req.body.branchId || DEFAULT_BRANCH);
  const bedNumber = Number(req.body.bedNumber);
  const checkIn = String(req.body.checkIn || "");
  const checkOut = String(req.body.checkOut || "");
  const guestName = String(req.body.guestName || "").trim();
  const guestEmail = String(req.body.guestEmail || "").trim().toLowerCase();
  const guestPhone = String(req.body.guestPhone || "").trim();
  const bioSex = normalizeBioSex(req.body.bioSex || "");
  const notes = String(req.body.notes || "").trim();

  if (!Number.isFinite(bedNumber) || bedNumber <= 0 || !guestName || !guestEmail || !guestPhone || !bioSex || !checkIn || !checkOut) {
    return res.status(400).json({ error: "Missing required booking fields." });
  }

  try {
    ensureValidDateRange(checkIn, checkOut);
    const room = getRoomLayoutForBed(branchId, bedNumber);

    if (!room) {
      throw new Error("Selected bed does not belong to a known room.");
    }

    if (!isRoomAllowedForBioSex(branchId, room, bioSex)) {
      throw new Error("That bed is not available for the selected biological sex.");
    }

    const availability = await buildAvailability(branchId, checkIn, checkOut, bioSex);
    const roomAvailability = availability.rooms.find((entry) => entry.roomCode === room.roomCode);
    const bedAvailability = roomAvailability && roomAvailability.beds.find((entry) => entry.bedNumber === bedNumber);

    if (!bedAvailability || bedAvailability.status !== "available") {
      throw new Error("That bed is no longer available for the selected dates.");
    }

    const connectionPool = await getPool();
    const { start, end } = ensureValidDateRange(checkIn, checkOut);
    const pricing = calculatePricing(nightsBetween(checkIn, checkOut));
    const id = createId();
    await connectionPool.query(
      `
        INSERT INTO \`${BOOKING_TABLE_NAME}\`
        (id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, bio_sex, check_in, check_out, nights, notes, status, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', 'STANDALONE_WEB')
      `,
      [id, branchId, room.roomCode, bedNumber, guestName, guestEmail, guestPhone || null, bioSex, start, end, nightsBetween(checkIn, checkOut), notes || null]
    );

    return res.status(201).json({
      booking: {
        id,
        branchId,
        roomCode: room.roomCode,
        bedNumber,
        guestName,
        guestEmail,
        bioSex,
        checkIn,
        checkOut,
        pricing
      },
      pricing
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create booking." });
  }
});

app.post("/api/create-checkout-session", async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe is not configured yet. Add STRIPE_SECRET_KEY to .env." });
  }

  const branchId = normalizeBranch(req.body.branchId || DEFAULT_BRANCH);
  const bedNumber = Number(req.body.bedNumber);
  const checkIn = String(req.body.checkIn || "");
  const checkOut = String(req.body.checkOut || "");
  const guestName = String(req.body.guestName || "").trim();
  const guestEmail = String(req.body.guestEmail || "").trim().toLowerCase();
  const guestPhone = String(req.body.guestPhone || "").trim();
  const bioSex = normalizeBioSex(req.body.bioSex || "");
  const notes = String(req.body.notes || "").trim();

  if (!Number.isFinite(bedNumber) || bedNumber <= 0 || !guestName || !guestEmail || !guestPhone || !bioSex || !checkIn || !checkOut) {
    return res.status(400).json({ error: "Missing required booking fields." });
  }

  try {
    ensureValidDateRange(checkIn, checkOut);
    const room = getRoomLayoutForBed(branchId, bedNumber);

    if (!room) {
      throw new Error("Selected bed does not belong to a known room.");
    }

    if (!isRoomAllowedForBioSex(branchId, room, bioSex)) {
      throw new Error("That bed is not available for the selected biological sex.");
    }

    const availability = await buildAvailability(branchId, checkIn, checkOut, bioSex);
    const roomAvailability = availability.rooms.find((entry) => entry.roomCode === room.roomCode);
    const bedAvailability = roomAvailability && roomAvailability.beds.find((entry) => entry.bedNumber === bedNumber);

    if (!bedAvailability || bedAvailability.status !== "available") {
      throw new Error("That bed is no longer available for the selected dates.");
    }

    const requestSiteUrl = getRequestSiteUrl(req);
    const pendingBooking = await createPendingBooking({
      branchId,
      roomCode: room.roomCode,
      bedNumber,
      guestName,
      guestEmail,
      guestPhone,
      bioSex,
      checkIn,
      checkOut,
      notes
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: guestEmail,
      success_url: `${requestSiteUrl}/booking-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${requestSiteUrl}/?canceled=1`,
      metadata: { bookingId: pendingBooking.id },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: pendingBooking.pricing.currency.toLowerCase(),
            unit_amount: pendingBooking.pricing.total,
            product_data: {
              name: `${SITE_TITLE} - Room ${room.roomCode} Bed ${bedNumber}`,
              description: `${checkIn} to ${checkOut} (${pendingBooking.pricing.nights} nights, ${getBedLevelLabel(room, bedNumber)})`
            }
          }
        }
      ]
    });

    const connectionPool = await getPool();
    await connectionPool.query(
      `
        UPDATE \`${BOOKING_TABLE_NAME}\`
        SET stripe_session_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [session.id, pendingBooking.id]
    );

    return res.status(201).json({
      mode: "card",
      checkoutUrl: session.url,
      bookingId: pendingBooking.id,
      pricing: pendingBooking.pricing
    });
  } catch (error) {
    if (error && error.message) {
      try {
        const connectionPool = await getPool();
        await connectionPool.query(
          `
            UPDATE \`${BOOKING_TABLE_NAME}\`
            SET status = 'PAYMENT_FAILED',
                payment_status = 'payment_failed',
                updated_at = CURRENT_TIMESTAMP
            WHERE guest_email = ?
              AND check_in = ?
              AND check_out = ?
              AND status = 'PENDING_PAYMENT'
          `,
          [guestEmail, dateOnlyToUtc(checkIn), dateOnlyToUtc(checkOut)]
        );
      } catch {
        // Best-effort cleanup only.
      }
    }
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to start Stripe checkout." });
  }
});

app.get("/api/confirm-payment", async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "Stripe is not configured yet." });
  }

  const sessionId = String(req.query.session_id || "").trim();
  if (!sessionId) {
    return res.status(400).json({ error: "session_id is required." });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const bookingId = session.metadata ? String(session.metadata.bookingId || "") : "";
    if (!bookingId) {
      return res.status(404).json({ error: "Booking not found for this payment session." });
    }

    const connectionPool = await getPool();
    const [rows] = await connectionPool.query(
      `
        SELECT id, branch_id, room_code, bed_number, guest_name, guest_email, guest_phone, bio_sex, check_in, check_out, nights, notes, status, payment_status, amount_paid, currency
        FROM \`${BOOKING_TABLE_NAME}\`
        WHERE id = ?
        LIMIT 1
      `,
      [bookingId]
    );

    const booking = rows[0];
    if (!booking) {
      return res.status(404).json({ error: "Booking record does not exist." });
    }

    if (session.payment_status === "paid") {
      await connectionPool.query(
        `
          UPDATE \`${BOOKING_TABLE_NAME}\`
          SET status = 'CONFIRMED',
              payment_status = 'paid',
              amount_paid = ?,
              currency = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [session.amount_total || 0, (session.currency || PRICING.currency).toLowerCase(), bookingId]
      );

      await syncPaidGuestBookingToMainApp({
        guestEmail: booking.guest_email,
        guestName: booking.guest_name,
        guestPhone: booking.guest_phone || "",
        bioSex: booking.bio_sex,
        branchId: booking.branch_id,
        bedNumber: booking.bed_number,
        checkIn: new Date(booking.check_in).toISOString().slice(0, 10),
        checkOut: new Date(booking.check_out).toISOString().slice(0, 10),
        notes: booking.notes || "",
        pricing: calculatePricing(Number(booking.nights) || nightsBetween(new Date(booking.check_in).toISOString().slice(0, 10), new Date(booking.check_out).toISOString().slice(0, 10)))
      });
    }

    return res.json({
      paid: session.payment_status === "paid",
      booking: {
        id: booking.id,
        branchId: booking.branch_id,
        roomCode: booking.room_code,
        bedNumber: booking.bed_number,
        bioSex: booking.bio_sex,
        checkIn: new Date(booking.check_in).toISOString().slice(0, 10),
        checkOut: new Date(booking.check_out).toISOString().slice(0, 10),
        pricing: calculatePricing(Number(booking.nights) || nightsBetween(new Date(booking.check_in).toISOString().slice(0, 10), new Date(booking.check_out).toISOString().slice(0, 10)))
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to verify payment session.",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`${SITE_TITLE} listening on http://localhost:${PORT}`);
  console.log(`Using resident cache: ${CLIENT_CACHE_PATH}`);
  console.log(`Using booking table: ${BOOKING_TABLE_NAME}`);
});


