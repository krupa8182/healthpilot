import { auth, db } from "./firebase-client.js";
import { reload, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, push, set, remove, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import Notifications from "./utils/notifications.js";
import { hideInjectedTestModeBadge } from "./utils/hide-test-mode-badge.js";

const params = new URLSearchParams(window.location.search);
const doctorUID = params.get("uid");
const prefillDate = params.get("date") || "";
const prefillTime = params.get("time") || "";
const appointmentId = params.get("appointmentId");
const isConfirmMode = Boolean(appointmentId);
const DEMO = params.get("demoPayment") === "1";

hideInjectedTestModeBadge();

if (!doctorUID && !isConfirmMode) {
  Notifications.error("Doctor not selected. Please choose a doctor first.");
  window.location.href = "doctors.html";
}

const form = document.getElementById("appointmentForm");
const submitBtn = form?.querySelector("button[type='submit']");
const bookingHeading = document.getElementById("bookingHeading");
const paymentMethodTitle = document.getElementById("paymentMethodTitle");
const bookingConfirmationTitle = document.getElementById("bookingConfirmationTitle");
const bookingConfirmationHelp = document.getElementById("bookingConfirmationHelp");
const paymentMethodInputs = document.querySelectorAll("input[name='paymentMethod']");
const onlinePaymentInfo = document.getElementById("onlinePaymentInfo");
const razorpayOrderIdEl = document.getElementById("razorpayOrderId");
const demoPaymentNote = document.getElementById("demoPaymentNote");
const dateInput = document.getElementById("date");
const timeInput = document.getElementById("time");
const timeSlots = document.getElementById("timeSlots");
const problemInput = document.getElementById("problem");
const feeDisplay = document.getElementById("feeDisplay");
const feeAmount = document.getElementById("feeAmount");
const today = new Date().toISOString().split("T")[0];
dateInput.min = today;

let doctorProfile = null;
let bookedByDate = {};
let blockedByDate = {};
let flatpickrInstance = null;
let isPaying = false;
let confirmAppointment = null;
const RAZORPAY_KEY = "rzp_test_STR3klzZtBgwGO";

const dayNameToIndex = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const payMethod = () => document.querySelector("input[name='paymentMethod']:checked")?.value || "cash";
const feeFor = (profile = doctorProfile) => Number(profile?.consultationFee || profile?.fee || 0) || 0;
const isLocalDev = () => ["127.0.0.1", "localhost"].includes(window.location.hostname);
const checkoutReady = () => typeof window !== "undefined" && typeof window.Razorpay === "function";
const timeToMin = (value) => {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!match) return null;
  let hour = Number(match[1]); const minute = Number(match[2] || "0"); const ampm = (match[3] || "").toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  if (ampm) { if (hour < 1 || hour > 12) return null; hour %= 12; if (ampm === "PM") hour += 12; }
  else if (hour < 0 || hour > 23) return null;
  return hour * 60 + minute;
};
const fmtTime = (minutes) => {
  const h24 = Math.floor(minutes / 60), m = minutes % 60, ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
};
const workingDays = (days = []) => days.map((v) => typeof v === "number" ? v : (Number.isFinite(Number(v)) ? Number(v) : dayNameToIndex[String(v || "").trim().toLowerCase()])).filter((v) => v !== undefined && v !== null);

function hasRecordedVerification(profileData) {
  if (!profileData || typeof profileData !== "object") return false;
  if (profileData.emailVerificationRequired === false) return true;
  return Boolean(profileData.verifiedAt);
}

function setModeCopy() {
  if (bookingHeading) bookingHeading.textContent = isConfirmMode ? "Confirm Your Appointment" : "Book Your Appointment";
  if (paymentMethodTitle) paymentMethodTitle.textContent = "Choose Payment Method";
  if (bookingConfirmationTitle) bookingConfirmationTitle.textContent = isConfirmMode ? "Complete Confirmation" : "Booking Rules";
  if (bookingConfirmationHelp) bookingConfirmationHelp.textContent = isConfirmMode
    ? "Complete payment or choose cash-on-visit to finalize this booking."
    : "Doctors can block unavailable timings, so only live open slots are shown here.";
}

function showOrder(orderId) {
  if (razorpayOrderIdEl) razorpayOrderIdEl.textContent = orderId || "Not created yet";
  if (onlinePaymentInfo) onlinePaymentInfo.style.display = "block";
}

function updatePaymentUI() {
  const method = payMethod();
  if (onlinePaymentInfo) onlinePaymentInfo.style.display = method === "online" ? "block" : "none";
  if (razorpayOrderIdEl && (!isConfirmMode || method !== "online")) razorpayOrderIdEl.textContent = "Not created yet";
  if (submitBtn) submitBtn.textContent = isConfirmMode
    ? (method === "online" ? (DEMO ? "Confirm & Pay (Demo)" : "Proceed to Razorpay") : "Confirm Booking")
    : (method === "online" ? "Proceed to Payment" : "Book Appointment");
}

function updateFee() {
  const fee = feeFor(confirmAppointment ? { consultationFee: confirmAppointment.payment?.amount || feeFor() } : doctorProfile);
  if (!feeDisplay || !feeAmount) return;
  feeDisplay.style.display = fee > 0 ? "block" : "none";
  feeAmount.textContent = String(fee || 0);
}

function loadBlocked(profile) {
  const source = profile?.blockedSlots || {}, result = {};
  Object.entries(source).forEach(([dateKey, slots]) => {
    if (!slots || typeof slots !== "object") return;
    result[dateKey] = {};
    Object.entries(slots).forEach(([timeKey, value]) => { if (value) result[dateKey][timeKey] = value; });
  });
  return result;
}

function buildSlots(dateStr) {
  const availability = doctorProfile?.availability;
  if (!availability) return { isWorkingDay: false, slots: [] };
  if (!workingDays(availability.days || availability.workingDays || []).includes(new Date(dateStr).getDay())) return { isWorkingDay: false, slots: [] };
  const start = timeToMin(availability.start || availability.startTime || availability.from || "09:00");
  const end = timeToMin(availability.end || availability.endTime || availability.to || "17:00");
  const duration = Number(availability.slotDuration || availability.slotMinutes || availability.slotLength || 15);
  const maxPerSlot = Number(availability.maxPerSlot || availability.capacity || 1);
  if (start === null || end === null || duration <= 0 || start >= end) return { isWorkingDay: false, slots: [] };
  const lunch = availability.lunchBreak || null;
  const lunchStart = lunch ? timeToMin(lunch.start) : null;
  const lunchEnd = lunch ? timeToMin(lunch.end) : null;
  const rows = [], booked = bookedByDate[dateStr] || {}, blocked = blockedByDate[dateStr] || {}, now = new Date();
  for (let cur = start; cur < end; cur += duration) {
    if (lunchStart !== null && lunchEnd !== null && cur >= lunchStart && cur < lunchEnd) {
      if (!rows.some((row) => row.type === "break")) rows.push({ type: "break", label12: `Lunch Break (${fmtTime(lunchStart)} - ${fmtTime(lunchEnd)})` });
      cur = lunchEnd - duration;
      continue;
    }
    const hh = Math.floor(cur / 60), mm = cur % 60, value24 = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    const isPast = new Date(`${dateStr}T${value24}:00`) <= now;
    const isBlocked = Boolean(blocked[value24]);
    const isFull = Number(booked[value24] || 0) >= maxPerSlot;
    rows.push({ type: "slot", value24, label12: fmtTime(cur), disabled: isPast || isBlocked || isFull, isPast, isBlocked, isFull });
  }
  return { isWorkingDay: true, slots: rows };
}

function makeSlotButton(slot) {
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "slot-btn";
  if (slot.type === "break") { btn.textContent = slot.label12; btn.disabled = true; btn.classList.add("slot-break"); return btn; }
  btn.textContent = slot.disabled ? `${slot.label12} (${slot.isBlocked ? "Blocked" : slot.isFull ? "Full" : "Past"})` : slot.label12;
  if (slot.disabled) { btn.disabled = true; if (slot.isFull) btn.classList.add("slot-full"); if (slot.isBlocked) btn.classList.add("slot-blocked"); return btn; }
  btn.addEventListener("click", () => { document.querySelectorAll(".slot-btn").forEach((node) => node.classList.remove("selected")); btn.classList.add("selected"); timeInput.value = slot.value24; });
  return btn;
}

function renderSlots(dateStr) {
  if (!timeSlots) return;
  timeSlots.innerHTML = ""; timeInput.value = "";
  const { isWorkingDay, slots } = buildSlots(dateStr);
  if (!isWorkingDay) { timeSlots.innerHTML = "<p>Doctor is not available on this day.</p>"; return; }
  if (!slots.length) { timeSlots.innerHTML = "<p>No available slots for this date.</p>"; return; }
  slots.forEach((slot) => timeSlots.appendChild(makeSlotButton(slot)));
  if (prefillTime) {
    const match = slots.find((slot) => slot.type === "slot" && !slot.disabled && slot.value24 === prefillTime);
    if (match) { timeInput.value = match.value24; [...timeSlots.querySelectorAll(".slot-btn")].forEach((btn) => { if (btn.textContent === match.label12) btn.classList.add("selected"); }); }
  }
}

function disabledDates(daysToCheck = 90) {
  const list = [], start = new Date(today);
  for (let i = 0; i < daysToCheck; i += 1) {
    const date = new Date(start); date.setDate(start.getDate() + i);
    const dateStr = date.toISOString().split("T")[0];
    const meta = buildSlots(dateStr);
    if (!meta.isWorkingDay || !meta.slots.some((slot) => slot.type === "slot" && !slot.disabled)) list.push(dateStr);
  }
  return list;
}

function initPicker() {
  if (window.flatpickr) {
    flatpickrInstance = window.flatpickr(dateInput, {
      minDate: today, dateFormat: "Y-m-d", disable: disabledDates(), defaultDate: prefillDate || today,
      onChange: (_dates, dateStr) => { if (dateStr) renderSlots(dateStr); }
    });
  } else {
    dateInput.value = prefillDate || today;
    dateInput.addEventListener("change", () => renderSlots(dateInput.value));
  }
  dateInput.value = prefillDate || today;
  renderSlots(dateInput.value);
}

async function loadDoctorProfile() {
  const snap = await get(ref(db, `doctors/${doctorUID}`));
  if (!snap.exists()) { Notifications.error("Doctor profile not found."); window.location.href = "doctors.html"; return false; }
  doctorProfile = snap.val() || {};
  const status = String(doctorProfile.status || "approved").toLowerCase();
  if (status !== "approved" || doctorProfile.profileComplete !== true) {
    Notifications.error("This doctor is not available for booking right now.");
    window.location.href = "doctors.html"; return false;
  }
  blockedByDate = loadBlocked(doctorProfile);
  updateFee();
  return true;
}

async function loadBookedSlots() {
  bookedByDate = {};
  const snap = await get(query(ref(db, "appointments"), orderByChild("doctorUID"), equalTo(doctorUID)));
  if (!snap.exists()) return;
  snap.forEach((child) => {
    const appt = child.val() || {}, status = String(appt.status || "").toLowerCase();
    if (status !== "approved" && status !== "pending") return;
    if (!bookedByDate[appt.date]) bookedByDate[appt.date] = {};
    if (!bookedByDate[appt.date][appt.time]) bookedByDate[appt.date][appt.time] = 0;
    bookedByDate[appt.date][appt.time] += 1;
  });
}

async function refreshBookingUI() {
  const ok = await loadDoctorProfile();
  if (!ok) return;
  await loadBookedSlots();
  if (flatpickrInstance) { flatpickrInstance.destroy(); flatpickrInstance = null; }
  initPicker();
}

async function ensureVerified() {
  const user = auth.currentUser;
  if (!user) { alert("Please login first."); return null; }
  return user;
}

function slotAvailable(date, time) {
  const maxPerSlot = Number(doctorProfile?.availability?.maxPerSlot || doctorProfile?.availability?.capacity || 1);
  return !blockedByDate[date]?.[time] && Number(bookedByDate[date]?.[time] || 0) < maxPerSlot;
}

function directPayload(user, date, time, problem, payment) {
  return {
    patientUID: user.uid, doctorUID, date, time, problem,
    status: "approved", patientConfirmed: payment.status !== "pending",
    approvedAt: Date.now(), confirmedAt: payment.status !== "pending" ? Date.now() : null,
    updatedAt: Date.now(), updatedBy: "patient", createdAt: Date.now(),
    verificationMethod: payment.method === "online" ? "direct_online_booking" : "direct_cash_booking",
    payment: { amount: feeFor(), currency: "INR", ...payment }
  };
}

function confirmPayload(appointment, payment) {
  return {
    ...appointment,
    patientConfirmed: true,
    confirmedAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: "patient",
    payment: { ...(appointment.payment || {}), amount: payment.amount ?? appointment.payment?.amount ?? feeFor(), currency: payment.currency || appointment.payment?.currency || "INR", ...payment }
  };
}

function isCheckoutFailure(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("payment cancelled") || message.includes("payment failed");
}

function makePaymentAttemptId(prefix = "attempt") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildDoctorPaymentRecord({
  paymentId,
  appointmentId: targetAppointmentId,
  user,
  status,
  amount,
  provider,
  date,
  time,
  doctorUID: targetDoctorUID,
  failureReason = ""
}) {
  return {
    orderId: paymentId,
    appointmentId: targetAppointmentId || "",
    uid: user.uid,
    doctorUID: targetDoctorUID || doctorUID || "",
    doctorName: doctorProfile?.name || "",
    clinicName: doctorProfile?.clinic || "",
    date: date || "",
    time: time || "",
    amount,
    currency: "INR",
    createdAt: Date.now(),
    status,
    provider: provider || "razorpay",
    entityType: "doctor",
    failureReason
  };
}

async function writeDoctorPaymentRecord(paymentId, payload) {
  if (!paymentId) return;
  await set(ref(db, `payments/${paymentId}`), payload);
}

async function loadConfirmMode(user) {
  const snap = await get(ref(db, `appointments/${appointmentId}`));
  if (!snap.exists()) { alert("Appointment not found."); window.location.href = "patient-dashboard.html"; return false; }
  confirmAppointment = snap.val() || {};
  if (confirmAppointment.patientUID !== user.uid) { alert("This appointment does not belong to your account."); window.location.href = "patient-dashboard.html"; return false; }
  const resolvedDoctorUID = confirmAppointment.doctorUID || doctorUID;
  if (resolvedDoctorUID) {
    const doctorSnap = await get(ref(db, `doctors/${resolvedDoctorUID}`));
    if (doctorSnap.exists()) doctorProfile = doctorSnap.val() || {};
  }
  dateInput.value = confirmAppointment.date || ""; dateInput.disabled = true;
  timeInput.value = confirmAppointment.time || "";
  timeSlots.innerHTML = `<p><strong>Selected slot:</strong> ${confirmAppointment.time || "N/A"}</p>`;
  problemInput.value = confirmAppointment.problem || ""; problemInput.readOnly = true;
  const preferred = String(confirmAppointment.payment?.preference || confirmAppointment.payment?.method || "").toLowerCase();
  if (preferred) document.querySelector(`input[name='paymentMethod'][value='${preferred}']`)?.click();
  updateFee(); updatePaymentUI();
  return true;
}

function bookingError(error) {
  const code = String(error?.code || "").toLowerCase(), msg = String(error?.message || "").toLowerCase();
  if (code.includes("permission-denied") || msg.includes("permission_denied")) return "Booking is blocked by database rules. Deploy the latest rules, then try again.";
  return error?.message || "Unable to book appointment. Please try again.";
}

setModeCopy();
paymentMethodInputs.forEach((input) => input.addEventListener("change", updatePaymentUI));
updatePaymentUI();
if (demoPaymentNote) demoPaymentNote.classList.toggle("is-hidden", !DEMO);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isPaying) return;
  const user = await ensureVerified();
  if (!user) return;
  const method = payMethod();

  const doOnlinePayment = async () => {
    const fee = confirmAppointment?.payment?.amount || feeFor();
    if (DEMO) {
      const paymentId = `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      showOrder(paymentId);
      return { demo: true, paymentId, fee };
    }
    showOrder("Frontend checkout");
    if (!checkoutReady()) throw new Error("Razorpay checkout failed to load. Refresh the page and try again.");
    return await new Promise((resolve, reject) => {
      const options = {
        key: RAZORPAY_KEY,
        amount: Math.round(fee * 100),
        currency: "INR",
        name: "HealthPilot",
        description: "Doctor Consultation Fee",
        handler: async (response) => resolve({
          demo: false,
          fee,
          paymentId: response.razorpay_payment_id,
          orderId: response.razorpay_order_id || "",
          signature: response.razorpay_signature || ""
        }),
        prefill: { name: user.displayName || "", email: user.email || "" },
        theme: { color: "#2563eb" },
        modal: { ondismiss: () => reject(new Error("Payment cancelled.")) }
      };
      const rzp = new window.Razorpay(options);
      if (typeof rzp.on === "function") rzp.on("payment.failed", () => reject(new Error("Payment failed. Please try again.")));
      rzp.open();
    });
  };

  try {
    isPaying = true;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = method === "online" ? "Preparing payment..." : "Booking..."; }

    if (isConfirmMode) {
      if (!confirmAppointment) throw new Error("Appointment details are not loaded yet.");
      const paymentStatus = String(confirmAppointment.payment?.status || "").toLowerCase();
      if (confirmAppointment.patientConfirmed || paymentStatus === "paid") { alert("This booking is already confirmed."); window.location.href = "patient-dashboard.html"; return; }
      if (method === "cash") {
        await set(ref(db, `appointments/${appointmentId}`), confirmPayload(confirmAppointment, { preference: "cash", method: "cash", status: "unpaid" }));
        alert("Booking confirmed. Pay at visit."); window.location.href = "patient-dashboard.html"; return;
      }
      const paymentResult = await doOnlinePayment();
      if (paymentResult.demo) {
        await set(ref(db, `appointments/${appointmentId}`), confirmPayload(confirmAppointment, { preference: "online", method: "online", provider: "demo", payment_id: paymentResult.paymentId, status: "paid" }));
        await writeDoctorPaymentRecord(paymentResult.paymentId, {
          ...buildDoctorPaymentRecord({
            paymentId: `demo_${paymentResult.paymentId}`,
            appointmentId,
            user,
            status: "paid",
            amount: paymentResult.fee,
            provider: "demo",
            date: confirmAppointment.date,
            time: confirmAppointment.time,
            doctorUID: confirmAppointment.doctorUID || doctorUID
          }),
          orderId: `demo_${paymentResult.paymentId}`
        });
      } else {
        await set(ref(db, `appointments/${appointmentId}`), confirmPayload(confirmAppointment, {
          preference: "online",
          method: "online",
          provider: "razorpay",
          payment_id: paymentResult.paymentId,
          razorpay_order_id: paymentResult.orderId,
          razorpay_signature: paymentResult.signature,
          status: "paid",
          amount: paymentResult.fee,
          currency: "INR"
        }));
        await writeDoctorPaymentRecord(paymentResult.paymentId, {
          ...buildDoctorPaymentRecord({
            paymentId: paymentResult.orderId || `frontend_${paymentResult.paymentId}`,
            appointmentId,
            user,
            status: "paid",
            amount: paymentResult.fee,
            provider: "razorpay",
            date: confirmAppointment.date,
            time: confirmAppointment.time,
            doctorUID: confirmAppointment.doctorUID || doctorUID
          }),
          orderId: paymentResult.orderId || `frontend_${paymentResult.paymentId}`
        });
      }
      alert("Payment confirmed. Booking finalized."); window.location.href = "patient-dashboard.html"; return;
    }

    const date = dateInput.value, time = timeInput.value, problem = String(problemInput.value || "").trim();
    if (!date || !time) throw new Error("Please select a valid date and available time slot.");
    if (!slotAvailable(date, time)) { await refreshBookingUI(); throw new Error("This slot is no longer available. Please choose another time."); }
    if (feeFor() <= 0) throw new Error("Consultation fee is not set for this doctor.");

    if (method === "cash") {
      const appointmentRef = push(ref(db, "appointments"));
      await set(appointmentRef, directPayload(user, date, time, problem, { preference: "cash", method: "cash", status: "unpaid" }));
      alert("Appointment booked successfully. Pay at the clinic on your visit."); window.location.href = "patient-dashboard.html"; return;
    }

    const appointmentRef = push(ref(db, "appointments"));
    const pendingPayload = directPayload(user, date, time, problem, { preference: "online", method: "online", status: "pending" });
    await set(appointmentRef, pendingPayload);
    const cleanup = async () => { try { const snap = await get(ref(db, `appointments/${appointmentRef.key}`)); if (snap.exists() && String(snap.val()?.payment?.status || "").toLowerCase() !== "paid") await remove(ref(db, `appointments/${appointmentRef.key}`)); } catch {} };
    try {
      const paymentResult = await doOnlinePayment();
      if (paymentResult.demo) {
        await set(ref(db, `appointments/${appointmentRef.key}`), {
          ...pendingPayload,
          patientConfirmed: true,
          confirmedAt: Date.now(),
          updatedAt: Date.now(),
          updatedBy: "patient",
          payment: {
            ...(pendingPayload.payment || {}),
            preference: "online",
            method: "online",
            provider: "demo",
            payment_id: paymentResult.paymentId,
            status: "paid"
          }
        });
        await writeDoctorPaymentRecord(paymentResult.paymentId, {
          ...buildDoctorPaymentRecord({
            paymentId: `demo_${paymentResult.paymentId}`,
            appointmentId: appointmentRef.key,
            user,
            status: "paid",
            amount: paymentResult.fee,
            provider: "demo",
            date,
            time,
            doctorUID
          }),
          orderId: `demo_${paymentResult.paymentId}`
        });
      } else {
        await set(ref(db, `appointments/${appointmentRef.key}`), {
          ...pendingPayload,
          patientConfirmed: true,
          confirmedAt: Date.now(),
          updatedAt: Date.now(),
          updatedBy: "patient",
          payment: {
            ...(pendingPayload.payment || {}),
            preference: "online",
            method: "online",
            provider: "razorpay",
            payment_id: paymentResult.paymentId,
            razorpay_order_id: paymentResult.orderId,
            razorpay_signature: paymentResult.signature,
            status: "paid"
          }
        });
        await writeDoctorPaymentRecord(paymentResult.paymentId, {
          ...buildDoctorPaymentRecord({
            paymentId: paymentResult.orderId || `frontend_${paymentResult.paymentId}`,
            appointmentId: appointmentRef.key,
            user,
            status: "paid",
            amount: paymentResult.fee,
            provider: "razorpay",
            date,
            time,
            doctorUID
          }),
          orderId: paymentResult.orderId || `frontend_${paymentResult.paymentId}`
        });
      }
      alert("Payment confirmed. Appointment booked."); window.location.href = "patient-dashboard.html"; return;
    } catch (error) {
      if (isCheckoutFailure(error)) {
        const failedPaymentId = makePaymentAttemptId("failed");
        try {
          await writeDoctorPaymentRecord(failedPaymentId, buildDoctorPaymentRecord({
            paymentId: failedPaymentId,
            appointmentId: appointmentRef.key,
            user,
            status: String(error?.message || "").toLowerCase().includes("cancelled") ? "cancelled" : "failed",
            amount: feeFor(),
            provider: "razorpay",
            date,
            time,
            doctorUID,
            failureReason: error.message || "Payment failed"
          }));
        } catch (paymentRecordError) {
          console.error("Unable to save failed payment attempt", paymentRecordError);
        }
      }
      await cleanup(); throw error;
    }
  } catch (error) {
    if (isConfirmMode && method === "online" && isCheckoutFailure(error) && user) {
      const failedPaymentId = makePaymentAttemptId("failed");
      try {
        await writeDoctorPaymentRecord(failedPaymentId, buildDoctorPaymentRecord({
          paymentId: failedPaymentId,
          appointmentId,
          user,
          status: String(error?.message || "").toLowerCase().includes("cancelled") ? "cancelled" : "failed",
          amount: Number(confirmAppointment?.payment?.amount || feeFor()),
          provider: "razorpay",
          date: confirmAppointment?.date,
          time: confirmAppointment?.time,
          doctorUID: confirmAppointment?.doctorUID || doctorUID,
          failureReason: error.message || "Payment failed"
        }));
      } catch (paymentRecordError) {
        console.error("Unable to save failed payment attempt", paymentRecordError);
      }
    }
    console.error(error);
    alert(bookingError(error));
  } finally {
    isPaying = false;
    if (submitBtn) { submitBtn.disabled = false; updatePaymentUI(); }
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) { alert(isConfirmMode ? "Please login to confirm your appointment." : "Please login to book an appointment."); window.location.href = "login.html"; return; }
  if (isConfirmMode) { await loadConfirmMode(user); return; }
  await refreshBookingUI();
});
