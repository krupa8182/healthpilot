import { auth, db } from "./firebase-client.js";
import { reload } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref,
  get,
  push,
  set,
  update,
  query,
  orderByChild,
  equalTo
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { hideInjectedTestModeBadge } from "./utils/hide-test-mode-badge.js";

const params = new URLSearchParams(window.location.search);
const labUID = params.get("uid");
const debugMode = params.get("debug") === "1";
const DEMO_PAYMENT_MODE = params.get("demoPayment") === "1";

hideInjectedTestModeBadge();

if (!labUID) {
  alert("Lab not selected. Please choose a lab first.");
  window.location.href = "labs.html";
}

const form = document.getElementById("labBookingForm");
const submitBtn = form?.querySelector("button[type='submit']");
const labNameText = document.getElementById("labNameText");
const testSelect = document.getElementById("testSelect");
const dateInput = document.getElementById("date");
const timeInput = document.getElementById("time");
const timeSlots = document.getElementById("timeSlots");
const notesInput = document.getElementById("notes");
const testRequirementText = document.getElementById("testRequirement");
const feeDisplay = document.getElementById("feeDisplay");
const feeAmount = document.getElementById("feeAmount");
const paymentMethodInputs = document.querySelectorAll("input[name='paymentMethod']");
const onlinePaymentInfo = document.getElementById("onlinePaymentInfo");
const razorpayOrderIdEl = document.getElementById("razorpayOrderId");
const demoPaymentNote = document.getElementById("demoPaymentNote");

const today = new Date().toISOString().split("T")[0];
dateInput.min = today;

let labProfile = null;
let bookingsByDate = {};
let blockedByDate = {};
let selectedTest = null;
let flatpickrInstance = null;
let debugState = {};
let isPaying = false;
const RAZORPAY_KEY = "rzp_test_STR3klzZtBgwGO";

function renderDebugPanel(data) {
  if (!debugMode) return;

  const host = labNameText?.parentElement || form || document.body;
  if (!host) return;

  let panel = document.getElementById("labBookingDebug");
  if (!panel) {
    panel = document.createElement("pre");
    panel.id = "labBookingDebug";
    panel.style.whiteSpace = "pre-wrap";
    panel.style.background = "#fff7cc";
    panel.style.border = "1px solid #e5d28a";
    panel.style.padding = "10px";
    panel.style.borderRadius = "8px";
    panel.style.fontSize = "12px";
    panel.style.marginTop = "10px";
    host.appendChild(panel);
  }

  panel.textContent = JSON.stringify(data, null, 2);
}

function updateDebug(partial) {
  if (!debugMode) return;
  debugState = { ...debugState, ...partial };
  renderDebugPanel(debugState);
}

if (debugMode) {
  window.addEventListener("error", (event) => {
    updateDebug({
      lastError: String(event.message || "Script error"),
      errorSource: String(event.filename || ""),
      errorLine: event.lineno || null
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    updateDebug({
      lastError: String(event.reason || "Unhandled promise rejection")
    });
  });
}

function isLocalDev() {
  const host = window.location.hostname;
  return host === "127.0.0.1" || host === "localhost";
}

function hasRecordedVerification(profileData) {
  if (!profileData || typeof profileData !== "object") return false;
  if (profileData.emailVerificationRequired === false) return true;
  return Boolean(profileData.verifiedAt);
}

function getSelectedPaymentMethod() {
  const selected = document.querySelector("input[name='paymentMethod']:checked");
  return selected ? selected.value : "cash";
}

function showOnlineOrderInfo(orderId) {
  if (razorpayOrderIdEl) {
    razorpayOrderIdEl.textContent = orderId || "Not created yet";
  }
  if (onlinePaymentInfo) {
    onlinePaymentInfo.style.display = "block";
  }
}

function updatePaymentUI() {
  const method = getSelectedPaymentMethod();
  if (onlinePaymentInfo) {
    onlinePaymentInfo.style.display = method === "online" ? "block" : "none";
  }
  if (razorpayOrderIdEl && method !== "online") {
    razorpayOrderIdEl.textContent = "Not created yet";
  }
  if (submitBtn) {
    submitBtn.textContent = method === "online" ? "Proceed to Payment" : "Book Lab Test";
  }
}

function isRazorpayCheckoutReady() {
  return typeof window !== "undefined" && typeof window.Razorpay === "function";
}

function formatTimeTo12Hour(hours, minutes) {
  const ampm = hours >= 12 ? "PM" : "AM";
  let h = hours % 12;
  if (h === 0) h = 12;
  return `${h.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

function timeStringToMinutes(value) {
  if (!value && value !== 0) return null;
  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const minutes = Number(text);
    if (Number.isFinite(minutes) && minutes >= 0 && minutes < 24 * 60) return minutes;
  }

  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  const ampm = match[3] ? match[3].toUpperCase() : "";

  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) return null;

  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12;
    if (ampm === "PM") hour += 12;
  } else {
    if (hour < 0 || hour > 23) return null;
  }

  return hour * 60 + minute;
}

function formatMinutesToLabel(minutes) {
  if (minutes === null || Number.isNaN(minutes)) return "";
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return formatTimeTo12Hour(hour, minute);
}

const dayNameToIndex = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

function normalizeWorkingDays(days) {
  if (!Array.isArray(days)) return [];
  const normalized = days
    .map((value) => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      const text = String(value || "").trim();
      if (!text) return null;
      const asNumber = Number(text);
      if (Number.isFinite(asNumber)) return asNumber;
      const mapped = dayNameToIndex[text.toLowerCase()];
      return Number.isFinite(mapped) ? mapped : null;
    })
    .filter((value) => value !== null);

  return Array.from(new Set(normalized));
}

function loadBlockedSlots(profile) {
  const source = profile?.blockedSlots || {};
  const result = {};

  Object.entries(source).forEach(([dateKey, slots]) => {
    if (!slots || typeof slots !== "object") return;
    const active = {};
    Object.entries(slots).forEach(([timeKey, value]) => {
      if (value) {
        active[timeKey] = value;
      }
    });
    if (Object.keys(active).length > 0) {
      result[dateKey] = active;
    }
  });

  return result;
}

function getAvailableSlots(dateStr) {
  const availability = labProfile?.availability;
  if (!availability) return { isWorkingDay: false, slots: [] };

  const workingDays = normalizeWorkingDays(availability.days);
  const day = new Date(dateStr).getDay();
  if (!workingDays.includes(day)) return { isWorkingDay: false, slots: [] };

  const startRaw = availability.start || availability.startTime || availability.from || availability.open;
  const endRaw = availability.end || availability.endTime || availability.to || availability.close;
  const startMinutes = timeStringToMinutes(startRaw);
  const endMinutes = timeStringToMinutes(endRaw);
  const slotDuration = Number(availability.slotDuration || availability.slotMinutes || availability.slotLength || 15);
  const maxPerSlot = Number(availability.maxPerSlot || availability.capacity || 1);

  if (
    startMinutes === null ||
    endMinutes === null ||
    slotDuration <= 0 ||
    startMinutes >= endMinutes
  ) {
    return { isWorkingDay: false, slots: [] };
  }

  const lunchStartMinutes = timeStringToMinutes(availability.lunchBreak?.start || availability.lunchStart);
  const lunchEndMinutes = timeStringToMinutes(availability.lunchBreak?.end || availability.lunchEnd);
  const bookedSlots = bookingsByDate[dateStr] || {};
  const blockedSlots = blockedByDate[dateStr] || {};
  const slots = [];
  let currentMinutes = startMinutes;
  const now = new Date();

  while (currentMinutes < endMinutes) {
    if (
      lunchStartMinutes !== null &&
      lunchEndMinutes !== null &&
      currentMinutes >= lunchStartMinutes &&
      currentMinutes < lunchEndMinutes
    ) {
      if (!slots.some((slot) => slot.type === "break")) {
        const lunchLabel = `Lunch Break (${formatMinutesToLabel(lunchStartMinutes)} - ${formatMinutesToLabel(
          lunchEndMinutes
        )})`;
        slots.push({ type: "break", label12: lunchLabel });
      }
      currentMinutes = lunchEndMinutes;
      continue;
    }

    const hh = Math.floor(currentMinutes / 60);
    const mm = currentMinutes % 60;
    const time24 = `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
    const slotDateTime = new Date(`${dateStr}T${time24}:00`);
    const isPast = slotDateTime <= now;
    const count = Number(bookedSlots[time24] || 0);
    const isFull = count >= maxPerSlot;
    const isBlocked = Boolean(blockedSlots[time24]);

    slots.push({
      type: "slot",
      value24: time24,
      label12: formatTimeTo12Hour(hh, mm),
      disabled: isPast || isFull || isBlocked,
      isPast,
      isFull,
      isBlocked,
      bookedCount: count,
      capacity: maxPerSlot
    });

    currentMinutes += slotDuration;
  }

  return { isWorkingDay: true, slots };
}

function createSlotButton(slot) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "slot-btn";
  if (slot.type === "break") {
    btn.textContent = slot.label12;
    btn.disabled = true;
    btn.classList.add("slot-break");
    return btn;
  }

  btn.textContent = slot.label12;
  if (slot.disabled) {
    const reason = slot.isBlocked ? "Blocked" : slot.isFull ? "Full" : slot.isPast ? "Past" : "Unavailable";
    btn.textContent = `${btn.textContent} (${reason})`;
    btn.disabled = true;
    if (slot.isFull) {
      btn.classList.add("slot-full");
    }
    if (slot.isBlocked) {
      btn.classList.add("slot-blocked");
    }
    return btn;
  }

  btn.addEventListener("click", () => {
    document.querySelectorAll(".slot-btn").forEach((node) => node.classList.remove("selected"));
    btn.classList.add("selected");
    timeInput.value = slot.value24;
  });

  return btn;
}

function updateTestRequirement(requirements = "") {
  if (!testRequirementText) return;
  if (!requirements) {
    testRequirementText.textContent = "No special requirements noted.";
    testRequirementText.classList.remove("has-requirement");
    return;
  }
  testRequirementText.textContent = `Requirements: ${requirements}`;
  testRequirementText.classList.add("has-requirement");
}

function updateFeeDisplay(amount = 0) {
  const normalizedAmount = Number(amount || 0);
  if (!feeDisplay || !feeAmount) return;
  feeAmount.textContent = normalizedAmount > 0 ? String(normalizedAmount) : "0";
  feeDisplay.style.display = normalizedAmount > 0 ? "block" : "none";
}

function handleTestChange() {
  const option = testSelect.options[testSelect.selectedIndex];
  if (!option || !option.value) {
    selectedTest = null;
    updateTestRequirement("");
    updateFeeDisplay(0);
    return;
  }

  selectedTest = {
    key: option.dataset.testKey || "",
    name: option.value,
    price: Number(option.dataset.price || 0),
    requirements: option.dataset.requirements || ""
  };

  updateTestRequirement(selectedTest.requirements);
  updateFeeDisplay(selectedTest.price);
}

function renderSlots(dateStr) {
  if (!timeSlots) {
    updateDebug({ timeSlotsFound: false, renderDate: dateStr });
    return;
  }

  timeSlots.innerHTML = "";
  if (timeInput) timeInput.value = "";

  const { isWorkingDay, slots } = getAvailableSlots(dateStr);
  updateDebug({
    timeSlotsFound: true,
    timeInputFound: Boolean(timeInput),
    renderDate: dateStr,
    isWorkingDay,
    slotCount: slots.length,
    enabledSlots: slots.filter((slot) => slot.type === "slot" && !slot.disabled).length
  });

  if (!isWorkingDay) {
    timeSlots.innerHTML = "<p>Lab is closed on this day.</p>";
    return;
  }

  if (slots.length === 0) {
    timeSlots.innerHTML = "<p>No available slots for this date.</p>";
    return;
  }

  slots.forEach((slot) => timeSlots.appendChild(createSlotButton(slot)));
  updateDebug({ renderedSlotButtons: timeSlots.querySelectorAll(".slot-btn").length });
}

function generateDisabledDates(daysToCheck = 90) {
  const disabled = [];
  const startDate = new Date(today);

  for (let i = 0; i < daysToCheck; i += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const dateStr = date.toISOString().split("T")[0];
    const meta = getAvailableSlots(dateStr);
    const hasActiveSlot = meta.slots.some((slot) => slot.type === "slot" && !slot.disabled);
    if (!meta.isWorkingDay || !hasActiveSlot) disabled.push(dateStr);
  }

  return disabled;
}

function initDatePicker() {
  const disabledDates = generateDisabledDates();

  updateDebug({ dateInputFound: Boolean(dateInput), flatpickrAvailable: Boolean(window.flatpickr) });
  if (!dateInput) return;

  if (window.flatpickr) {
    flatpickrInstance = window.flatpickr(dateInput, {
      minDate: today,
      dateFormat: "Y-m-d",
      disable: disabledDates,
      defaultDate: today,
      onChange: (_selectedDates, dateStr) => {
        if (dateStr) renderSlots(dateStr);
      }
    });
  } else {
    dateInput.value = today;
    dateInput.addEventListener("change", () => renderSlots(dateInput.value));
  }

  dateInput.value = today;
  renderSlots(today);
}

async function ensureVerifiedPatient() {
  const user = auth.currentUser;
  if (!user) {
    alert("Please login first.");
    return null;
  }

  const userSnap = await get(ref(db, "users/" + user.uid));
  const profileData = userSnap.exists() ? userSnap.val() : null;
  if (!userSnap.exists() || String(userSnap.val().role || "").toLowerCase() !== "patient") {
    alert("Only patients can book lab tests.");
    return null;
  }

  return { user, profile: profileData };
}

function normalizeTests(testMap) {
  const entries = Array.isArray(testMap)
    ? testMap.map((value, index) => [String(index), value])
    : Object.entries(testMap || {});

  return entries
    .map(([key, test]) => {
      let name = "";
      let price = 0;
      let requirements = "";

      if (test && typeof test === "object") {
        name = String(test.name || test.testName || test.title || "").trim();
        price = Number(test.price ?? test.cost ?? test.amount ?? test.fee ?? 0);
        requirements = String(test.requirements || test.requirement || test.notes || "").trim();
      } else if (test !== null && test !== undefined) {
        name = String(test).trim();
      }

      if (!name && key) {
        name = String(key).trim();
      }

      return { key, name, price: Number(price || 0), requirements };
    })
    .filter((test) => test.name);
}

function getRawTests(profile) {
  if (!profile || typeof profile !== "object") return null;
  return (
    profile.tests ||
    profile.testList ||
    profile.testNames ||
    profile.availableTests ||
    profile.testsOffered ||
    profile.test
  );
}

function renderTests() {
  if (!testSelect) {
    updateDebug({ testSelectFound: false });
    return;
  }

  updateDebug({ testSelectFound: true });

  const rawTests = getRawTests(labProfile);
  const tests = normalizeTests(rawTests);
  testSelect.innerHTML = "";
  selectedTest = null;
  updateTestRequirement("");
  updateFeeDisplay(0);

  updateDebug({
    testsRawType: Array.isArray(rawTests) ? "array" : typeof rawTests,
    testsRawCount: Array.isArray(rawTests) ? rawTests.length : rawTests ? Object.keys(rawTests).length : 0,
    normalizedTestsCount: tests.length,
    testsSample: tests.slice(0, 3).map((test) => test.name)
  });

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a test";
  placeholder.disabled = true;
  placeholder.selected = true;
  testSelect.appendChild(placeholder);

  tests.forEach((test) => {
    const option = document.createElement("option");
    option.value = test.name;
    option.textContent = `${test.name} - Rs. ${test.price}`;
    option.dataset.price = String(test.price);
    option.dataset.requirements = test.requirements || "";
    option.dataset.testKey = test.key || "";
    testSelect.appendChild(option);
  });

  testSelect.onchange = handleTestChange;
}

function isSlotAvailable(date, time) {
  const availability = labProfile?.availability || {};
  const maxPerSlot = Number(availability.maxPerSlot || availability.capacity || 1);
  const bookedCount = Number(bookingsByDate[date]?.[time] || 0);
  return bookedCount < maxPerSlot && !blockedByDate[date]?.[time];
}

async function loadLabAndBookings() {
  const labSnap = await get(ref(db, "labs/" + labUID));
  if (!labSnap.exists()) {
    alert("Lab profile not found.");
    window.location.href = "labs.html";
    return false;
  }

  labProfile = labSnap.val();
  blockedByDate = loadBlockedSlots(labProfile);
  labNameText.innerHTML = `<strong>Lab:</strong> ${labProfile.labName || "Pathology Lab"}`;
  if (labProfile.profileComplete !== true) {
    alert("This lab profile is incomplete. Please choose another lab.");
    window.location.href = "labs.html";
    return false;
  }

  const labStatus = String(labProfile.status || "approved").toLowerCase();
  if (labStatus !== "approved") {
    alert("This lab is awaiting approval. Please choose another lab.");
    window.location.href = "labs.html";
    return false;
  }

  if (debugMode) {
    const availability = labProfile?.availability || {};
    const todayMeta = getAvailableSlots(today);
    updateDebug({
      labUID,
      labName: labProfile.labName || "",
      labProfileKeys: Object.keys(labProfile || {}),
      availabilityRaw: availability,
      normalizedWorkingDays: normalizeWorkingDays(availability.days),
      startRaw: availability.start || availability.startTime || availability.from || availability.open || null,
      endRaw: availability.end || availability.endTime || availability.to || availability.close || null,
      slotDuration: availability.slotDuration || availability.slotMinutes || availability.slotLength || null,
      maxPerSlot: availability.maxPerSlot || availability.capacity || null,
      lunchBreak: availability.lunchBreak || null,
      blockedSlots: blockedByDate,
      today,
      todayMeta
    });
  }

  const tests = normalizeTests(getRawTests(labProfile));
  if (tests.length === 0) {
    alert("This lab has no tests configured right now.");
    window.location.href = "labs.html";
    return false;
  }

  bookingsByDate = {};
  try {
    const bookingsQuery = query(ref(db, "labBookings"), orderByChild("labUID"), equalTo(labUID));
    const bookingsSnap = await get(bookingsQuery);
    if (bookingsSnap.exists()) {
      bookingsSnap.forEach((child) => {
        const data = child.val();
        if (String(data.status || "").toLowerCase() === "cancelled") return;

        if (!bookingsByDate[data.date]) bookingsByDate[data.date] = {};
        if (!bookingsByDate[data.date][data.time]) bookingsByDate[data.date][data.time] = 0;
        bookingsByDate[data.date][data.time] += 1;
      });
    }
  } catch (error) {
    console.error("Unable to read labBookings", error);
    updateDebug({
      bookingsReadError: String(error?.message || error),
      bookingsReadCode: String(error?.code || "")
    });
  }

  renderTests();
  return true;
}

function buildBookingPayload(verified, date, time, notes, payment) {
  return {
    patientUID: verified.user.uid,
    patientName: String(verified.profile.name || "").trim(),
    patientPhone: String(verified.profile.phone || "").trim(),
    labUID,
    labName: String(labProfile.labName || "").trim(),
    testName: selectedTest.name,
    testKey: selectedTest.key || "",
    testPrice: Number(selectedTest.price || 0),
    testRequirements: selectedTest.requirements || "",
    date,
    time,
    notes,
    status: "approved",
    approvedAt: Date.now(),
    resultSummary: "",
    resultUrl: "",
    resultUploadedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    payment
  };
}

async function cancelDraftBooking(bookingId, reason = "cancelled") {
  if (!bookingId) return;
  try {
    await update(ref(db, `labBookings/${bookingId}`), {
      status: "cancelled",
      cancelledAt: Date.now(),
      cancelledBy: "patient",
      updatedAt: Date.now(),
      payment: {
        preference: "online",
        method: "online",
        status: reason,
        amount: Number(selectedTest?.price || 0),
        currency: "INR"
      }
    });
  } catch (error) {
    console.error("Unable to cancel draft lab booking", error);
  }
}

function isCheckoutFailure(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("payment cancelled") || message.includes("payment failed");
}

function makePaymentAttemptId(prefix = "attempt") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildLabPaymentRecord({
  paymentId,
  bookingId,
  user,
  status,
  provider,
  amount,
  date,
  time,
  failureReason = ""
}) {
  return {
    orderId: paymentId,
    bookingId: bookingId || "",
    uid: user.uid,
    labUID,
    labName: String(labProfile?.labName || "").trim(),
    testName: selectedTest?.name || "",
    entityType: "lab",
    amount,
    currency: "INR",
    createdAt: Date.now(),
    status,
    provider: provider || "razorpay",
    date: date || "",
    time: time || "",
    failureReason
  };
}

async function writeLabPaymentRecord(paymentId, payload) {
  if (!paymentId) return;
  await set(ref(db, `payments/${paymentId}`), payload);
}

async function doOnlinePayment() {
  const amount = Number(selectedTest?.price || 0);
  if (amount <= 0) {
    throw new Error("This test price is not configured yet.");
  }

  if (DEMO_PAYMENT_MODE) {
    const paymentId = `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    showOnlineOrderInfo(paymentId);
    return {
      demo: true,
      paymentId,
      orderId: `demo_${paymentId}`,
      amount
    };
  }

  if (!isRazorpayCheckoutReady()) {
    throw new Error("Razorpay checkout failed to load. Refresh the page and try again.");
  }

  const checkoutRef = `front_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  showOnlineOrderInfo("Frontend checkout");

  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay({
      key: RAZORPAY_KEY,
      amount: Math.round(amount * 100),
      currency: "INR",
      name: "HealthPilot",
      description: `${selectedTest?.name || "Lab Test"} Lab Test`,
      handler(response) {
        resolve({
          demo: false,
          paymentId: response?.razorpay_payment_id || `pay_${Date.now()}`,
          orderId: response?.razorpay_order_id || checkoutRef,
          signature: response?.razorpay_signature || "",
          amount
        });
      },
      modal: {
        ondismiss: () => reject(new Error("Payment cancelled"))
      },
      theme: {
        color: "#2563eb"
      }
    });

    if (typeof checkout.on === "function") {
      checkout.on("payment.failed", () => reject(new Error("Payment failed")));
    }

    checkout.open();
  });
}

function getBookingErrorMessage(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();

  if (code.includes("permission-denied") || code.includes("permission_denied") || message.includes("permission_denied")) {
    return "Lab booking is blocked by the current Realtime Database rules. Publish the latest database rules, then try again.";
  }

  if (message.includes("payment cancelled")) {
    return "Payment was cancelled before booking could be completed.";
  }

  if (message.includes("payment failed")) {
    return "Payment failed. Please try again.";
  }

  if (message.includes("razorpay")) {
    return error.message;
  }

  if (code.includes("unauthenticated")) {
    return "Please log in again before booking this test.";
  }

  return error?.message || "Unable to book lab test right now.";
}

async function refreshUI() {
  const ready = await loadLabAndBookings();
  if (!ready) return;

  if (flatpickrInstance) {
    flatpickrInstance.destroy();
    flatpickrInstance = null;
  }

  initDatePicker();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (isPaying) return;

  const verified = await ensureVerifiedPatient();
  if (!verified) return;

  const paymentMethod = getSelectedPaymentMethod();
  const date = dateInput.value;
  const time = timeInput.value;
  const notes = String(notesInput.value || "").trim();

  if (!selectedTest || !selectedTest.name) {
    alert("Please select a test.");
    return;
  }

  if (!date || !time) {
    alert("Please select a valid date and time slot.");
    return;
  }

  if (!isSlotAvailable(date, time)) {
    alert("This slot is no longer available. Please choose another time.");
    await refreshUI();
    return;
  }

  if (Number(selectedTest.price || 0) <= 0) {
    alert("This test price is not configured yet.");
    return;
  }

  let bookingRef = null;
  try {
    isPaying = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = paymentMethod === "online" ? "Preparing payment..." : "Booking...";
    }

    if (paymentMethod === "cash") {
      bookingRef = push(ref(db, "labBookings"));
      await set(
        bookingRef,
        buildBookingPayload(verified, date, time, notes, {
          preference: "cash",
          method: "cash",
          status: "unpaid",
          amount: Number(selectedTest.price || 0),
          currency: "INR"
        })
      );

      alert("Lab test booked successfully. Pay at the lab on your visit.");
      window.location.href = "patient-dashboard.html";
      return;
    }

    bookingRef = push(ref(db, "labBookings"));
    await set(
      bookingRef,
        buildBookingPayload(verified, date, time, notes, {
          preference: "online",
          method: "online",
          status: "pending",
        amount: Number(selectedTest.price || 0),
        currency: "INR"
      })
    );

    const paymentResult = await doOnlinePayment();
    const provider = paymentResult.demo ? "demo" : "razorpay";

    await update(ref(db, `labBookings/${bookingRef.key}`), {
      updatedAt: Date.now(),
      payment: {
        preference: "online",
        method: "online",
        provider,
        payment_id: paymentResult.paymentId,
        razorpay_order_id: paymentResult.orderId,
        razorpay_signature: paymentResult.signature || "",
        amount: Number(selectedTest.price || 0),
        currency: "INR",
        status: "paid"
      }
    });

    await writeLabPaymentRecord(paymentResult.paymentId, {
      ...buildLabPaymentRecord({
        paymentId: paymentResult.orderId || paymentResult.paymentId,
        bookingId: bookingRef.key,
        user: verified.user,
        status: "paid",
        provider,
        amount: Number(selectedTest.price || 0),
        date,
        time
      }),
      orderId: paymentResult.orderId || paymentResult.paymentId
    });

    alert(paymentResult.demo ? "Demo payment successful. Lab test booked." : "Payment successful. Lab test booked.");
    window.location.href = "patient-dashboard.html";
    return;
  } catch (error) {
    console.error(error);
    updateDebug({
      bookingWriteError: String(error?.message || error),
      bookingWriteCode: String(error?.code || "")
    });
    if (paymentMethod === "online") {
      const bookingId = typeof bookingRef?.key === "string" ? bookingRef.key : "";
      if (bookingId && isCheckoutFailure(error)) {
        const failedPaymentId = makePaymentAttemptId("failed");
        try {
          await writeLabPaymentRecord(failedPaymentId, buildLabPaymentRecord({
            paymentId: failedPaymentId,
            bookingId,
            user: verified.user,
            status: String(error?.message || "").toLowerCase().includes("cancelled") ? "cancelled" : "failed",
            provider: "razorpay",
            amount: Number(selectedTest.price || 0),
            date,
            time,
            failureReason: error.message || "Payment failed"
          }));
        } catch (paymentRecordError) {
          console.error("Unable to save failed lab payment attempt", paymentRecordError);
        }
      }
      if (bookingId) {
        await cancelDraftBooking(bookingId, String(error?.message || "").toLowerCase().includes("failed") ? "failed" : "cancelled");
      }
    }
    alert(getBookingErrorMessage(error));
    isPaying = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      updatePaymentUI();
    }
  }
});

paymentMethodInputs.forEach((input) => {
  input.addEventListener("change", updatePaymentUI);
});
updatePaymentUI();

if (demoPaymentNote) {
  demoPaymentNote.classList.toggle("is-hidden", !DEMO_PAYMENT_MODE);
}

refreshUI();
