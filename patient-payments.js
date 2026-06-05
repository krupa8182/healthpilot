import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, onValue, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const paymentsContainer = document.getElementById("paymentsContainer");
const paymentCount = document.getElementById("paymentCount");
const paymentTotal = document.getElementById("paymentTotal");
const paymentFilterTabs = document.querySelectorAll("[data-filter]");

let activeFilter = "successful";
let allPayments = [];
const state = {
  paymentEntries: [],
  appointments: [],
  labBookings: []
};

const doctorCache = new Map();

function isSuccessfulPayment(status) {
  const normalized = String(status || "").toLowerCase();
  return normalized === "paid" || normalized === "success" || normalized === "refunded";
}

function isFailedPayment(status) {
  const normalized = String(status || "").toLowerCase();
  return normalized === "failed" || normalized === "cancelled" || normalized === "pending";
}

function isOnlinePayment(payment = {}) {
  const method = String(payment.method || payment.preference || "").toLowerCase();
  return method === "online" || Boolean(payment.payment_id) || Boolean(payment.provider);
}

function paymentStatusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "paid" || normalized === "success") return "status-approved";
  if (normalized === "refunded") return "status-cancelled";
  if (normalized === "failed" || normalized === "cancelled") return "status-cancelled";
  if (normalized === "pending") return "status-pending";
  return "status-default";
}

function formatCurrency(amount, currency = "INR") {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return `${currency} 0`;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(value);
  } catch (error) {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function filterPayments(payments = []) {
  if (activeFilter === "failed") {
    return payments.filter((payment) => isFailedPayment(payment.status));
  }

  return payments.filter((payment) => isSuccessfulPayment(payment.status));
}

function normalizePaymentEntry(paymentId, data = {}) {
  return {
    id: paymentId,
    orderId: data.orderId || paymentId,
    uid: data.uid || "",
    entityType: data.entityType || (data.labUID ? "lab" : "doctor"),
    appointmentId: data.appointmentId || "",
    bookingId: data.bookingId || "",
    doctorUID: data.doctorUID || "",
    labUID: data.labUID || "",
    doctorName: data.doctorName || "",
    clinicName: data.clinicName || data.clinic || "",
    labName: data.labName || "",
    testName: data.testName || "",
    date: data.date || "",
    time: data.time || "",
    amount: Number(data.amount || 0),
    currency: data.currency || "INR",
    createdAt: Number(data.createdAt || 0),
    status: String(data.status || "paid").toLowerCase(),
    provider: data.provider || "",
    failureReason: data.failureReason || "",
    source: "payments"
  };
}

function normalizeAppointmentEntry(appointmentId, data = {}) {
  return {
    id: appointmentId,
    appointmentId,
    doctorUID: data.doctorUID || "",
    date: data.date || "",
    time: data.time || "",
    createdAt: Number(data.updatedAt || data.confirmedAt || data.createdAt || 0),
    amount: Number(data.payment?.amount || 0),
    currency: data.payment?.currency || "INR",
    status: String(data.payment?.status || "").toLowerCase(),
    paymentId: String(data.payment?.payment_id || "").trim(),
    provider: data.payment?.provider || data.payment?.method || data.payment?.preference || "",
    clinicName: data.clinicName || data.clinic || "",
    online: isOnlinePayment(data.payment || {}),
    source: "appointments"
  };
}

function normalizeLabBookingEntry(bookingId, data = {}) {
  return {
    id: bookingId,
    bookingId,
    labUID: data.labUID || "",
    labName: data.labName || "",
    testName: data.testName || "",
    date: data.date || "",
    time: data.time || "",
    createdAt: Number(data.updatedAt || data.createdAt || 0),
    amount: Number(data.payment?.amount || data.testPrice || 0),
    currency: data.payment?.currency || "INR",
    status: String(data.payment?.status || "").toLowerCase(),
    paymentId: String(data.payment?.payment_id || "").trim(),
    provider: data.payment?.provider || data.payment?.method || data.payment?.preference || "",
    online: isOnlinePayment(data.payment || {}),
    source: "labBookings"
  };
}

function renderPayments(payments = []) {
  if (!paymentsContainer) return;
  paymentsContainer.innerHTML = "";

  const filteredPayments = filterPayments(payments);

  if (paymentCount) {
    paymentCount.textContent = String(filteredPayments.length);
  }

  const paidTotal = filteredPayments.reduce((sum, payment) => {
    return isSuccessfulPayment(payment.status) ? sum + Number(payment.amount || 0) : sum;
  }, 0);

  if (paymentTotal) {
    paymentTotal.textContent = formatCurrency(paidTotal, "INR");
  }

  if (!filteredPayments.length) {
    paymentsContainer.innerHTML = `<p class='empty-state'>No ${activeFilter} payments found yet.</p>`;
    return;
  }

  filteredPayments.forEach((payment) => {
    const card = document.createElement("div");
    card.className = "appointment-card";

    const createdAt = payment.createdAt ? new Date(Number(payment.createdAt)).toLocaleString() : "N/A";
    const amountText = formatCurrency(payment.amount, payment.currency || "INR");
    const status = payment.status || "paid";
    const isLabPayment = String(payment.entityType || "").toLowerCase() === "lab" || Boolean(payment.labUID);
    const entityLabel = isLabPayment ? "Lab" : "Doctor";
    const entityName = isLabPayment ? payment.labName || "Lab" : payment.doctorName || "Doctor";
    const dateLabel = payment.date || "N/A";
    const timeLabel = payment.time || "N/A";
    const clinicLabel = payment.clinicName || "N/A";
    const failureInfo = payment.failureReason
      ? `<p><strong>Failure Reason:</strong> ${payment.failureReason}</p>`
      : "";

    card.innerHTML = `
      <p><strong>${entityLabel}:</strong> ${entityName}</p>
      ${!isLabPayment ? `<p><strong>Clinic:</strong> ${clinicLabel}</p>` : ""}
      <p><strong>Date:</strong> ${dateLabel}</p>
      <p><strong>Time:</strong> ${timeLabel}</p>
      <p><strong>Amount:</strong> ${amountText}</p>
      <p><strong>Status:</strong> <span class="status-pill ${paymentStatusClass(status)}">${status}</span></p>
      <p><strong>${isSuccessfulPayment(status) ? "Paid On" : "Attempted On"}:</strong> ${createdAt}</p>
      ${payment.testName ? `<p><strong>Test:</strong> ${payment.testName}</p>` : ""}
      ${failureInfo}
    `;

    paymentsContainer.appendChild(card);
  });
}

async function getDoctorDetails(doctorUID) {
  if (!doctorUID) return {};
  if (doctorCache.has(doctorUID)) return doctorCache.get(doctorUID);

  let details = {};
  try {
    const doctorSnap = await get(ref(db, `doctors/${doctorUID}`));
    if (doctorSnap.exists()) {
      const data = doctorSnap.val() || {};
      details = {
        doctorName: data.name || "",
        clinicName: data.clinic || ""
      };
    } else {
      const userSnap = await get(ref(db, `users/${doctorUID}`));
      if (userSnap.exists()) {
        const data = userSnap.val() || {};
        details = {
          doctorName: data.name || "",
          clinicName: data.clinic || ""
        };
      }
    }
  } catch (error) {
    console.error("Unable to load doctor details for payment history", error);
  }

  doctorCache.set(doctorUID, details);
  return details;
}

async function rebuildPaymentHistory() {
  const merged = new Map();

  state.paymentEntries.forEach((payment) => {
    merged.set(payment.id, { ...payment });
  });

  state.appointments.forEach((appointment) => {
    if (!appointment.online) return;

    const paymentKey = appointment.paymentId || `appointment_${appointment.appointmentId}`;
    const existing = merged.get(paymentKey);
    merged.set(paymentKey, {
      id: paymentKey,
      orderId: existing?.orderId || paymentKey,
      uid: existing?.uid || "",
      entityType: "doctor",
      appointmentId: appointment.appointmentId,
      bookingId: existing?.bookingId || "",
      doctorUID: existing?.doctorUID || appointment.doctorUID,
      labUID: existing?.labUID || "",
      doctorName: existing?.doctorName || "",
      clinicName: existing?.clinicName || appointment.clinicName || "",
      labName: existing?.labName || "",
      testName: existing?.testName || "",
      date: existing?.date || appointment.date,
      time: existing?.time || appointment.time,
      amount: Number(existing?.amount || appointment.amount || 0),
      currency: existing?.currency || appointment.currency || "INR",
      createdAt: Number(existing?.createdAt || appointment.createdAt || 0),
      status: String(existing?.status || appointment.status || "pending").toLowerCase(),
      provider: existing?.provider || appointment.provider || "",
      failureReason: existing?.failureReason || "",
      source: existing?.source || "appointments"
    });
  });

  state.labBookings.forEach((booking) => {
    if (!booking.online) return;

    const paymentKey = booking.paymentId || `lab_${booking.bookingId}`;
    const existing = merged.get(paymentKey);
    merged.set(paymentKey, {
      id: paymentKey,
      orderId: existing?.orderId || paymentKey,
      uid: existing?.uid || "",
      entityType: "lab",
      appointmentId: existing?.appointmentId || "",
      bookingId: booking.bookingId,
      doctorUID: existing?.doctorUID || "",
      labUID: existing?.labUID || booking.labUID,
      doctorName: existing?.doctorName || "",
      clinicName: existing?.clinicName || "",
      labName: existing?.labName || booking.labName,
      testName: existing?.testName || booking.testName,
      date: existing?.date || booking.date,
      time: existing?.time || booking.time,
      amount: Number(existing?.amount || booking.amount || 0),
      currency: existing?.currency || booking.currency || "INR",
      createdAt: Number(existing?.createdAt || booking.createdAt || 0),
      status: String(existing?.status || booking.status || "pending").toLowerCase(),
      provider: existing?.provider || booking.provider || "",
      failureReason: existing?.failureReason || "",
      source: existing?.source || "labBookings"
    });
  });

  const resolved = await Promise.all(
    [...merged.values()].map(async (entry) => {
      if (entry.entityType === "doctor" && entry.doctorUID) {
        const doctorDetails = await getDoctorDetails(entry.doctorUID);
        return {
          ...entry,
          doctorName: entry.doctorName || doctorDetails.doctorName || "Doctor",
          clinicName: entry.clinicName || doctorDetails.clinicName || ""
        };
      }

      return entry;
    })
  );

  resolved.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  allPayments = resolved;
  renderPayments(allPayments);
}

function handlePaymentsSnapshot(snapshot) {
  state.paymentEntries = snapshot.exists()
    ? Object.entries(snapshot.val() || {}).map(([paymentId, data]) => normalizePaymentEntry(paymentId, data))
    : [];
  void rebuildPaymentHistory();
}

function handleAppointmentsSnapshot(snapshot) {
  state.appointments = snapshot.exists()
    ? Object.entries(snapshot.val() || {}).map(([appointmentId, data]) => normalizeAppointmentEntry(appointmentId, data))
    : [];
  void rebuildPaymentHistory();
}

function handleLabBookingsSnapshot(snapshot) {
  state.labBookings = snapshot.exists()
    ? Object.entries(snapshot.val() || {}).map(([bookingId, data]) => normalizeLabBookingEntry(bookingId, data))
    : [];
  void rebuildPaymentHistory();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const userSnapshot = await get(ref(db, `users/${user.uid}`));
  const role = userSnapshot.exists() ? String(userSnapshot.val().role || "").toLowerCase() : "";
  if (role && role !== "patient") {
    window.location.href = "login.html";
    return;
  }

  const paymentsRef = query(ref(db, "payments"), orderByChild("uid"), equalTo(user.uid));
  const appointmentsRef = query(ref(db, "appointments"), orderByChild("patientUID"), equalTo(user.uid));
  const labBookingsRef = query(ref(db, "labBookings"), orderByChild("patientUID"), equalTo(user.uid));

  onValue(paymentsRef, handlePaymentsSnapshot, (error) => {
    console.error("Unable to load payments for payments page", error);
    state.paymentEntries = [];
    void rebuildPaymentHistory();
  });

  onValue(appointmentsRef, handleAppointmentsSnapshot, (error) => {
    console.error("Unable to load appointments for payments page", error);
    state.appointments = [];
    void rebuildPaymentHistory();
  });

  onValue(labBookingsRef, handleLabBookingsSnapshot, (error) => {
    console.error("Unable to load lab bookings for payments page", error);
    state.labBookings = [];
    void rebuildPaymentHistory();
  });
});

paymentFilterTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    paymentFilterTabs.forEach((button) => button.classList.remove("active"));
    tab.classList.add("active");
    activeFilter = tab.dataset.filter || "successful";
    renderPayments(allPayments);
  });
});
