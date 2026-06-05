import { auth, db } from "./firebase-client.js";
import Notifications from "./utils/notifications.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, get, update, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const welcomeName = document.getElementById("welcomeName");
const appointmentsContainer = document.getElementById("appointmentsContainer");
const paymentsContainer = document.getElementById("paymentsContainer");
const doctorList = document.getElementById("doctorList");
const dashboardHeroSection = document.getElementById("dashboardHeroSection");
const appointmentsSection = document.getElementById("appointments");
const paymentsSection = document.getElementById("payments");
const availableDoctorsSection = document.getElementById("availableDoctorsSection");
const navDashboard = document.getElementById("navDashboard");
const navPayments = document.getElementById("navPayments");
const navDoctors = document.getElementById("navDoctors");
const navLabs = document.getElementById("navLabs");
const email = document.getElementById("email");
const doctorCount = document.getElementById("doctorCount");
const labCount = document.getElementById("labCount");
const confirmBanner = document.getElementById("confirmBanner");
const confirmCountEl = document.getElementById("confirmCount");
const confirmBannerBtn = document.getElementById("confirmBannerBtn");
const userAvatarBtn = document.getElementById("userAvatarBtn");
const userMenu = document.getElementById("userMenu");
const userInitial = document.getElementById("userInitial");

let patientAppointments = [];
let patientLabBookings = [];
let patientPayments = [];
let currentUser = null;
let currentStatus = "approved";
const APPROVAL_NOTIFY_KEY = "hp_appointment_approved_notified";

function isTruthy(value) {
  if (value === true || value === 1) return true;
  return String(value || "").toLowerCase() === "true";
}

function getDashboardForRole(role) {
  switch (String(role || "").toLowerCase()) {
    case "patient":
      return "patient-dashboard.html";
    case "doctor":
      return "doctor-dashboard.html";
    case "lab":
      return "lab-dashboard.html";
    case "clinic_staff":
      return "clinic-staff-dashboard.html";
    case "admin":
      return "admin-dashboard.html";
    default:
      return "login.html";
  }
}

function getApprovalNotifiedMap() {
  try {
    const raw = localStorage.getItem(APPROVAL_NOTIFY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function setApprovalNotifiedMap(map) {
  try {
    localStorage.setItem(APPROVAL_NOTIFY_KEY, JSON.stringify(map));
  } catch (error) {
    // ignore
  }
}

function statusClass(status) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "approved" || normalized === "completed") return "status-approved";
  if (normalized === "pending") return "status-pending";
  if (normalized === "cancelled" || normalized === "rejected") return "status-cancelled";
  return "status-default";
}

function paymentStatusClass(status) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "paid" || normalized === "success") return "status-approved";
  if (normalized === "refunded") return "status-cancelled";
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

function isAppointmentTimeValid(date, time) {
  if (!date || !time) return false;

  try {
    const appointmentDateTime = new Date(`${date}T${time}`);
    const now = new Date();
    const timeDiff = appointmentDateTime - now;

    // Allow joining 15 minutes before to 1 hour after appointment
    return timeDiff > -60 * 60 * 1000 && timeDiff < 15 * 60 * 1000;
  } catch (error) {
    console.error("Error validating appointment time:", error);
    return false;
  }
}

function hasDoctorProfileBasics(doctorData) {
  if (!doctorData || typeof doctorData !== "object") return false;

  const requiredFields = ["name", "specialization", "clinic", "experience", "fee", "location"];
  return requiredFields.every((field) => String(doctorData[field] || "").trim() !== "");
}

function hasLabProfileBasics(labData) {
  if (!labData || typeof labData !== "object") return false;

  const requiredFields = ["labName", "contactName", "phone", "location"];
  const hasRequiredFields = requiredFields.every((field) => String(labData[field] || "").trim() !== "");
  const hasTests = Boolean(labData.tests && Object.keys(labData.tests).length > 0);
  const hasAvailability = Boolean(labData.availability?.start && labData.availability?.end);
  return hasRequiredFields && hasTests && hasAvailability;
}

function isDoctorVisibleToPatients(doctorData) {
  const status = String(doctorData?.status || "approved").toLowerCase();
  return status === "approved" && (doctorData?.profileComplete === true || hasDoctorProfileBasics(doctorData));
}

function isLabVisibleToPatients(labData) {
  const status = String(labData?.status || "approved").toLowerCase();
  return status === "approved" && (labData?.profileComplete === true || hasLabProfileBasics(labData));
}

function renderAvailableDoctors(doctors = []) {
  if (!doctorList) return;

  doctorList.innerHTML = "";

  if (!doctors.length) {
    doctorList.innerHTML = "<p class='empty-state'>No doctors available right now.</p>";
    return;
  }

  doctors.forEach((doctor) => {
    const doctorDiv = document.createElement("div");
    doctorDiv.classList.add("doctor-card");

    const doctorUID = doctor.uid || "";
    const doctorName = doctor.name || "Doctor";
    const specialization = doctor.specialization || "General Physician";
    const clinic = doctor.clinic || "Clinic details coming soon";
    const location = doctor.location || "Location not added";
    const fee = doctor.fee || doctor.consultationFee || "N/A";

    doctorDiv.innerHTML = `
      <h3>Dr. ${doctorName}</h3>
      <p><strong>Specialization:</strong> ${specialization}</p>
      <p><strong>Clinic:</strong> ${clinic}</p>
      <p><strong>Location:</strong> ${location}</p>
      <p><strong>Fee:</strong> Rs. ${fee}</p>
      <button class="view-btn" type="button">View Profile</button>
    `;

    doctorDiv.querySelector(".view-btn")?.addEventListener("click", () => {
      if (doctorUID) {
        window.location.href = `doctor-details.html?uid=${doctorUID}`;
      } else {
        window.location.href = "doctors.html";
      }
    });

    doctorList.appendChild(doctorDiv);
  });
}

function setUserMenuVisible(visible) {
  if (!userMenu || !userAvatarBtn) return;
  userMenu.classList.toggle("is-visible", Boolean(visible));
  userAvatarBtn.setAttribute("aria-expanded", visible ? "true" : "false");
}

function toggleUserMenu(event) {
  event.stopPropagation();
  if (!userMenu) return;
  const isVisible = userMenu.classList.contains("is-visible");
  setUserMenuVisible(!isVisible);
}

function getCancelledStatusLabel(entry) {
  const cancelledBy = String(entry?.cancelledBy || entry?.updatedBy || "").toLowerCase();
  if (cancelledBy === "patient") return "cancelled by you";
  if (cancelledBy === "doctor") return "cancelled by doctor";
  if (cancelledBy === "lab") return "cancelled by lab";
  return "cancelled";
}

function isFailedCancellation(paymentStatus) {
  const normalized = String(paymentStatus || "").toLowerCase();
  return normalized === "failed" || normalized === "cancelled" || normalized === "pending";
}

function renderFilteredAppointments() {
  if (!appointmentsContainer) return;
  appointmentsContainer.innerHTML = "";

  const filteredAppointments = patientAppointments.filter((appt) => {
    const status = String(appt.status || "").toLowerCase();
    if (status !== currentStatus.toLowerCase()) return false;
    if (currentStatus === "cancelled" && isFailedCancellation(appt.paymentStatus)) return false;
    return true;
  });
  const filteredLabBookings = patientLabBookings.filter((booking) => {
    const status = String(booking.status || "").toLowerCase();
    if (currentStatus === "approved") {
      return status === "approved" || status === "completed";
    }
    if (currentStatus === "cancelled" && isFailedCancellation(booking.paymentStatus || booking.payment?.status)) {
      return false;
    }
    return status === currentStatus.toLowerCase();
  });
  const hasDoctorAppointments = filteredAppointments.length > 0;
  const hasLabBookings = filteredLabBookings.length > 0;

  if (!hasDoctorAppointments && !hasLabBookings) {
    appointmentsContainer.innerHTML = `<p class='empty-state'>No ${currentStatus.toLowerCase()} appointments or lab tests found.</p>`;
    return;
  }

  if (hasDoctorAppointments) {
    filteredAppointments.forEach((appointment) => {
      const status = appointment.status || "pending";
      const statusLabel = status === "cancelled" ? getCancelledStatusLabel(appointment) : status;
      const paymentStatus = appointment.paymentStatus || "unpaid";
      const paymentMethod = appointment.paymentMethod || appointment.paymentPreference || "";
      const paymentSummary = `${paymentStatus}${paymentMethod ? ` (${paymentMethod})` : ""}`;
      const card = document.createElement("div");
      card.classList.add("appointment-card", "doctor-appointment");
      card.dataset.id = appointment.id;

      card.innerHTML = `
        <p><strong>Doctor:</strong> Dr. ${appointment.doctorName}</p>
        <p><strong>Date:</strong> ${appointment.date || "N/A"}</p>
        <p><strong>Time:</strong> ${appointment.time || "N/A"}</p>
        <p><strong>Status:</strong> <span class="status-pill ${statusClass(status)}">${statusLabel}</span></p>
        <p><strong>Payment:</strong> ${paymentSummary}</p>
        ${
          status === "approved"
            ? `<button class="cancel-btn" data-id="${appointment.id}">Cancel</button>`
            : ""
        }

      `;

      appointmentsContainer.appendChild(card);
    });
  }

  if (hasLabBookings) {
    const labHeading = document.createElement("div");
    labHeading.classList.add("section-subheading");
    labHeading.innerHTML = `
      <div>
        <h3>Lab Test Bookings</h3>
      </div>
      <a href="labs.html" class="section-link">Book New Test</a>
    `;
    appointmentsContainer.appendChild(labHeading);

    filteredLabBookings.forEach((booking) => {
      const statusLabel = String(booking.status || "").toLowerCase() === "cancelled"
        ? getCancelledStatusLabel(booking)
        : (booking.status || "N/A");
      const card = document.createElement("div");
      card.classList.add("appointment-card", "lab-appointment");
      card.dataset.id = booking.id;

      card.innerHTML = `
        <p><strong>Lab:</strong> ${booking.labName || "Lab"}</p>
        <p><strong>Test:</strong> ${booking.testName || "N/A"}</p>
        <p><strong>Date:</strong> ${booking.date || "N/A"}</p>
        <p><strong>Time:</strong> ${booking.time || "N/A"}</p>
        <p><strong>Status:</strong> <span class="status-pill ${statusClass(booking.status)}">${statusLabel}</span></p>
        ${booking.resultSummary ? `<p><strong>Result Summary:</strong> ${booking.resultSummary}</p>` : ""}
        ${booking.resultUrl ? `<p><a href="${booking.resultUrl}" target="_blank" rel="noopener noreferrer">View Online Report</a></p>` : ""}
        ${booking.resultUploadedAt ? `<p><strong>Result Updated:</strong> ${new Date(Number(booking.resultUploadedAt)).toLocaleString()}</p>` : ""}
        ${booking.status === "approved" ? `<button class="cancel-lab-btn" data-id="${booking.id}">Cancel Lab Booking</button>` : ""}
      `;

      appointmentsContainer.appendChild(card);
    });
  }

  // Attach event listeners (same as before)
  appointmentsContainer.querySelectorAll(".cancel-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const appointmentId = btn.dataset.id;
      const appointment = patientAppointments.find((item) => item.id === appointmentId);
      try {
        btn.disabled = true;
        await cancelMatchingAppointments(appointmentId, appointment);
        Notifications.success("Appointment cancelled and slot released");
      } catch (err) {
        console.error(err);
        Notifications.error("Error cancelling appointment");
      } finally {
        btn.disabled = false;
      }
    });
  });
  appointmentsContainer.querySelectorAll(".cancel-lab-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const bookingId = btn.dataset.id;
      try {
        await update(ref(db, "labBookings/" + bookingId), { status: "cancelled" });
        Notifications.success("Lab booking cancelled");
      } catch (error) {
        console.error(error);
        Notifications.error("Unable to cancel lab booking");
      }
    });
  });
}

async function cancelMatchingAppointments(primaryAppointmentId, appointment) {
  if (!currentUser?.uid) {
    throw new Error("User is not signed in.");
  }

  const primary = appointment || patientAppointments.find((item) => item.id === primaryAppointmentId);
  if (!primary) {
    throw new Error("Appointment not found.");
  }

  const activeStatuses = new Set(["pending", "approved"]);
  const matchingAppointments = patientAppointments.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return (
      activeStatuses.has(status) &&
      String(item.doctorUID || "") === String(primary.doctorUID || "") &&
      String(item.date || "") === String(primary.date || "") &&
      String(item.time || "") === String(primary.time || "")
    );
  });

  const idsToCancel = new Set([primaryAppointmentId, ...matchingAppointments.map((item) => item.id)]);
  const cancelPayload = {
    status: "cancelled",
    cancelledAt: Date.now(),
    cancelledBy: "patient",
    updatedAt: Date.now(),
    updatedBy: "patient",
  };

  await Promise.all(
    [...idsToCancel].map((id) => update(ref(db, "appointments/" + id), cancelPayload))
  );
}

function renderPaymentsSection() {
  if (!paymentsContainer) return;
  paymentsContainer.innerHTML = "";

  if (!patientPayments.length) {
    paymentsContainer.innerHTML = "<p class='empty-state'>No payments found yet.</p>";
    return;
  }

  patientPayments.forEach((payment) => {
    const card = document.createElement("div");
    card.classList.add("appointment-card");

    const createdAt = payment.createdAt ? new Date(Number(payment.createdAt)).toLocaleString() : "N/A";
    const amountText = formatCurrency(payment.amount, payment.currency || "INR");
    const status = payment.status || "paid";
    const isLabPayment = String(payment.entityType || "").toLowerCase() === "lab" || Boolean(payment.labUID);
    const entityLabel = isLabPayment ? "Lab" : "Doctor";
    const entityName = isLabPayment
      ? payment.labName || "Lab"
      : payment.doctorName || "Doctor";
    const refundId = payment.refundId || payment.refund?.id;
    const refundStatus = payment.refundStatus || payment.refund?.status || "processed";
    const refundReason = payment.refundReason || payment.refund?.reason || "";
    const refundBadge = refundReason
      ? `<span class="refund-badge refund-${refundReason}">${refundReason}</span>`
      : "";
    const refundInfo = refundId
      ? `<p><strong>Refund:</strong> ${refundId} (${refundStatus}) ${refundBadge}</p>`
      : "";

    card.innerHTML = `
      <p><strong>${entityLabel}:</strong> ${entityName}</p>
      <p><strong>Amount:</strong> ${amountText}</p>
      <p><strong>Status:</strong> <span class="status-pill ${paymentStatusClass(status)}">${status}</span></p>
      <p><strong>Paid On:</strong> ${createdAt}</p>
      ${payment.testName ? `<p><strong>Test:</strong> ${payment.testName}</p>` : ""}
      ${payment.appointmentId ? `<p><strong>Appointment ID:</strong> ${payment.appointmentId}</p>` : ""}
      ${payment.bookingId ? `<p><strong>Booking ID:</strong> ${payment.bookingId}</p>` : ""}
      ${refundInfo}
    `;

    paymentsContainer.appendChild(card);
  });
}

function setSectionVisibility() {
  const showingPayments = window.location.hash === "#payments";

  dashboardHeroSection?.classList.toggle("is-hidden", showingPayments);
  appointmentsSection?.classList.toggle("is-hidden", showingPayments);
  availableDoctorsSection?.classList.toggle("is-hidden", showingPayments);
  paymentsSection?.classList.toggle("is-hidden", !showingPayments);
}

function setActiveNav() {
  if (!navDashboard || !navDoctors || !navLabs) return;
  navDashboard.classList.remove("active");
  navDoctors.classList.remove("active");
  navLabs.classList.remove("active");
  if (navPayments) navPayments.classList.remove("active");

  if (window.location.hash === "#payments") {
    navPayments?.classList.add("active");
  } else {
    navDashboard.classList.add("active");
  }

  setSectionVisibility();
}

async function logoutUser() {
  try {
    await signOut(auth);
    window.location.href = "login.html";
  } catch (error) {
    console.error("Logout failed", error);
    alert("Unable to log out. Please try again.");
  }
}

function handleUserMenuAction(action) {
  if (action === "edit-profile") {
    window.location.href = "patient-profile.html";
    return;
  }
  if (action === "logout") {
    logoutUser();
  }
}

setActiveNav();
window.addEventListener("hashchange", setActiveNav);

if (userAvatarBtn) {
  userAvatarBtn.addEventListener("click", toggleUserMenu);
}

if (userMenu) {
  userMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    setUserMenuVisible(false);
    handleUserMenuAction(action);
  });
}

if (confirmBannerBtn) {
  confirmBannerBtn.addEventListener("click", () => {
    window.location.hash = "#appointments";
    confirmBannerBtn.blur();
  });
}

const tabButtons = document.querySelectorAll(".tab-btn");
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentStatus = btn.dataset.status;
    renderFilteredAppointments();
  });
});

window.addEventListener("click", () => setUserMenuVisible(false));
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    window.location.reload();
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;
  const userSnapshot = await get(ref(db, "users/" + user.uid));
  const role = userSnapshot.exists() ? String(userSnapshot.val().role || "").toLowerCase() : "";
  if (role && role !== "patient") {
    window.location.href = getDashboardForRole(role);
    return;
  }
  const patientName = userSnapshot.exists() ? userSnapshot.val().name : "";
  const displayName = patientName || user.displayName || "Patient";
  welcomeName.innerText = "Welcome, " + displayName;
  if (userInitial) {
    const initial = (displayName.trim().charAt(0) || "P").toUpperCase();
    userInitial.innerText = initial;
  }
  if (email) {
    email.innerText = "Email: " + (user.email || "N/A");
  }
  const doctorsRef = ref(db, "doctors");
  onValue(doctorsRef, (snapshot) => {
    if (!doctorList || !doctorCount) return;
    doctorList.innerHTML = "";

    if (!snapshot.exists()) {
      doctorList.innerHTML = "<p class='empty-state'>No doctors available.</p>";
      doctorCount.innerText = "0";
      return;
    }

    const visibleDoctors = [];
    snapshot.forEach((child) => {
      const doctorData = child.val() || {};
      if (!isDoctorVisibleToPatients(doctorData)) return;
      visibleDoctors.push({
        uid: child.key,
        ...doctorData
      });
    });

    doctorCount.innerText = String(visibleDoctors.length);
    renderAvailableDoctors(visibleDoctors);
  }, (error) => {
    console.error("Unable to load doctors for dashboard", error);
    if (doctorList) {
      doctorList.innerHTML = "<p class='empty-state'>Unable to load doctors right now.</p>";
    }
    if (doctorCount) {
      doctorCount.innerText = "0";
    }
  });

  onValue(ref(db, "labs"), (snapshot) => {
    if (!labCount) return;
    if (!snapshot.exists()) {
      labCount.innerText = "0";
      return;
    }

    let totalLabs = 0;
    snapshot.forEach((child) => {
      const lab = child.val() || {};
      if (isLabVisibleToPatients(lab)) {
        totalLabs += 1;
      }
    });

    labCount.innerText = String(totalLabs);
  }, (error) => {
    console.error("Unable to load labs for dashboard", error);
    labCount.innerText = "0";
  });

  const appointmentsQuery = query(ref(db, "appointments"), orderByChild("patientUID"), equalTo(user.uid));
  onValue(appointmentsQuery, async (snapshot) => {
    if (!snapshot.exists()) {
      patientAppointments = [];
      renderFilteredAppointments();
      return;
    }

    const nextAppointments = [];
    const appointments = snapshot.val() || {};
    for (const [appointmentId, data] of Object.entries(appointments)) {
      if (data.patientUID !== user.uid) continue;

      const doctorSnap = await get(ref(db, "users/" + data.doctorUID));
      const doctorName = doctorSnap.exists() ? doctorSnap.val().name : "Doctor";

      nextAppointments.push({
        id: appointmentId,
        doctorUID: data.doctorUID,
        doctorName,
        date: data.date || "N/A",
        time: data.time || "N/A",
        status: data.status || "pending",
        createdAt: Number(data.createdAt || 0),
        cancelledBy: data.cancelledBy || "",
        updatedBy: data.updatedBy || "",
        patientConfirmed:
          isTruthy(data.patientConfirmed) ||
          String(data.payment?.status || "").toLowerCase() === "paid",
        paymentStatus: data.payment?.status || "unpaid",
        paymentMethod: data.payment?.method || "",
        paymentPreference: data.payment?.preference || ""
      });
    }

    nextAppointments.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    patientAppointments = nextAppointments;
    renderFilteredAppointments();
  });

  const labBookingsRef = query(ref(db, "labBookings"), orderByChild("patientUID"), equalTo(user.uid));
  onValue(labBookingsRef, (snapshot) => {
    if (!snapshot.exists()) {
      patientLabBookings = [];
      renderFilteredAppointments();
      return;
    }

    const rows = [];
    snapshot.forEach((child) => {
      const data = child.val();
      rows.push({
        id: child.key,
        ...data,
        paymentStatus: data?.payment?.status || ""
      });
    });

    if (rows.length === 0) {
      patientLabBookings = [];
      renderFilteredAppointments();
      return;
    }

    rows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    patientLabBookings = rows;
    renderFilteredAppointments();
  });

  const paymentsRef = query(ref(db, "payments"), orderByChild("uid"), equalTo(user.uid));
  onValue(paymentsRef, async (snapshot) => {
    if (!snapshot.exists()) {
      patientPayments = [];
      renderPaymentsSection();
      return;
    }

    const payments = snapshot.val() || {};
    const entries = Object.entries(payments);
    const resolved = await Promise.all(
      entries.map(async ([paymentId, data]) => {
        let doctorName = "Doctor";
        if (data?.doctorUID) {
          const doctorSnap = await get(ref(db, "users/" + data.doctorUID));
          if (doctorSnap.exists()) {
            doctorName = doctorSnap.val().name || doctorName;
          }
        }

        return {
          id: paymentId,
          doctorName,
          ...data
        };
      })
    );

    resolved.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    patientPayments = resolved;
    renderPaymentsSection();
  }, (error) => {
    console.error("Unable to load payments for dashboard", error);
    patientPayments = [];
    if (paymentsContainer) {
      paymentsContainer.innerHTML = "<p class='empty-state'>Unable to load payments right now.</p>";
    }
  });
});
