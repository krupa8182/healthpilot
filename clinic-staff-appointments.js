import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, onValue, query, orderByChild, equalTo, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const clinicNameEl = document.getElementById("clinicName");
const staffNameEl = document.getElementById("staffName");
const appointmentsContainer = document.getElementById("appointmentsContainer");
const refreshBtn = document.getElementById("refreshBtn");
const editWorkingHoursBtn = document.getElementById("editWorkingHoursBtn");
const userAvatarBtn = document.getElementById("userAvatarBtn");
const userMenu = document.getElementById("userMenu");
const userInitial = document.getElementById("userInitial");

let linkedDoctorUID = null;
let clinicCode = null;
let allAppointments = {};

function formatStaffEmailName(email = "") {
  const localPart = String(email || "").trim().split("@")[0];
  return localPart.replace(/[._-]+/g, " ").trim();
}

function getStaffDisplayName(staffData = {}, authUser = null, doctorData = {}) {
  const doctorName = String(doctorData?.name || "").trim().toLowerCase();
  const candidates = [
    String(staffData?.name || "").trim(),
    String(authUser?.displayName || "").trim()
  ].filter(Boolean);

  const safeCandidate = candidates.find((candidate) => candidate.toLowerCase() !== doctorName);
  if (safeCandidate) return safeCandidate;

  const emailFallback = formatStaffEmailName(staffData?.email || authUser?.email || "");
  return emailFallback || "Staff Member";
}

function applyStaffIdentity(staffData = {}, authUser = null, doctorData = {}) {
  const displayName = getStaffDisplayName(staffData, authUser, doctorData);
  if (staffNameEl) {
    staffNameEl.textContent = `Welcome, ${displayName || "Staff Member"}`;
  }
  if (userInitial) {
    userInitial.textContent = (displayName.charAt(0) || "S").toUpperCase();
  }
}

function applyClinicTitle(doctorData = {}) {
  if (!clinicNameEl) return;
  clinicNameEl.textContent = String(doctorData?.clinic || "Clinic Appointments").trim() || "Clinic Appointments";
}

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "approved" || normalized === "completed") return "status-approved";
  if (normalized === "pending") return "status-pending";
  if (normalized === "cancelled" || normalized === "rejected") return "status-cancelled";
  return "status-default";
}

function closeUserMenu() {
  if (!userMenu || !userAvatarBtn) return;
  userMenu.classList.remove("open");
  userAvatarBtn.setAttribute("aria-expanded", "false");
  userMenu.setAttribute("aria-hidden", "true");
}

function toggleUserMenu() {
  if (!userMenu || !userAvatarBtn) return;
  const isOpen = userMenu.classList.contains("open");
  if (isOpen) {
    closeUserMenu();
  } else {
    userMenu.classList.add("open");
    userAvatarBtn.setAttribute("aria-expanded", "true");
    userMenu.setAttribute("aria-hidden", "false");
  }
}

function parseDateString(dateString) {
  if (!dateString) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(dateString);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTimeToMinutes(timeString) {
  if (!timeString) return null;
  const match = String(timeString).trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3] ? match[3].toUpperCase() : "";

  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour %= 12;
    if (meridiem === "PM") hour += 12;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return (hour * 60) + minute;
}

function getAppointmentDateTime(appointment) {
  const appointmentDate = parseDateString(appointment?.date);
  if (!appointmentDate) return null;

  const timeInMinutes = parseTimeToMinutes(appointment?.time);
  if (timeInMinutes === null) {
    appointmentDate.setHours(23, 59, 59, 999);
    return appointmentDate;
  }

  appointmentDate.setHours(Math.floor(timeInMinutes / 60), timeInMinutes % 60, 0, 0);
  return appointmentDate;
}

function isHiddenAppointment(appointment) {
  const status = String(appointment?.status || "").toLowerCase();
  return status === "cancelled" || status === "canceled" || status === "rejected";
}

function isUpcomingScheduledAppointment(appointment) {
  if (isHiddenAppointment(appointment)) return false;
  if (String(appointment?.status || "").toLowerCase() !== "approved") return false;

  const appointmentDateTime = getAppointmentDateTime(appointment);
  if (!appointmentDateTime) return false;
  return appointmentDateTime >= new Date();
}

async function findDoctorByClinicCode(code) {
  try {
    const doctorsSnap = await get(ref(db, "doctors"));
    if (doctorsSnap.exists()) {
      const doctors = doctorsSnap.val();
      for (const [doctorUID, doctorData] of Object.entries(doctors)) {
        if (doctorData.clinicCode === code) {
          return doctorUID;
        }
      }
    }
    return null;
  } catch (error) {
    console.error("Error finding doctor by clinic code:", error);
    return null;
  }
}

function renderAppointments() {
  if (!appointmentsContainer) return;
  appointmentsContainer.innerHTML = "";

  const entries = Object.entries(allAppointments)
    .filter(([, appointment]) => isUpcomingScheduledAppointment(appointment))
    .sort(([, left], [, right]) => {
      const leftDateTime = getAppointmentDateTime(left)?.getTime() || 0;
      const rightDateTime = getAppointmentDateTime(right)?.getTime() || 0;
      return leftDateTime - rightDateTime;
    });

  if (!entries.length) {
    appointmentsContainer.innerHTML = "<p class='empty-state'>No future appointments scheduled.</p>";
    return;
  }

  entries.forEach(async ([appointmentId, appointment]) => {
    const card = document.createElement("div");
    card.className = "appointment-card";

    let patientName = "Patient";
    let patientPhone = "";
    try {
      const patientSnap = await get(ref(db, "users/" + appointment.patientUID));
      if (patientSnap.exists()) {
        const patientData = patientSnap.val() || {};
        patientName = patientData.name || "Patient";
        patientPhone = patientData.phone || "";
      }
    } catch (error) {
      console.error("Error fetching patient:", error);
    }

    const contactLabel = patientPhone ? `Contact Patient: ${patientPhone}` : "Contact Patient";

    card.innerHTML = `
      <p><strong>Patient:</strong> ${patientName}</p>
      <p><strong>Date:</strong> ${appointment.date || "N/A"}</p>
      <p><strong>Time:</strong> ${appointment.time || "N/A"}</p>
      <p><strong>Problem:</strong> ${appointment.problem || "Not specified"}</p>
      <p><strong>Status:</strong> <span class="status-pill ${statusClass(appointment.status)}">${appointment.status}</span></p>
      <div class="appointment-actions">
        <button class="reject-btn" type="button" onclick="cancelAppointment('${appointmentId}')">Cancel Appointment</button>
        <button class="ghost-btn" type="button" onclick="contactPatient('${patientPhone}')">${contactLabel}</button>
      </div>
    `;

    appointmentsContainer.appendChild(card);
  });
}

function loadAppointments() {
  if (!linkedDoctorUID) return;

  const appointmentsQuery = query(ref(db, "appointments"), orderByChild("doctorUID"), equalTo(linkedDoctorUID));
  onValue(appointmentsQuery, (snapshot) => {
    allAppointments = {};

    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        allAppointments[child.key] = child.val();
      });
    }

    renderAppointments();
  });
}

window.cancelAppointment = async function(appointmentId) {
  const appointment = allAppointments[appointmentId];
  if (!appointment) {
    alert("Appointment not found.");
    return;
  }

  const confirmed = window.confirm("Cancel this appointment?");
  if (!confirmed) return;

  try {
    await update(ref(db, "appointments/" + appointmentId), {
      status: "cancelled",
      cancelledAt: Date.now(),
      cancelledBy: "doctor",
      updatedAt: Date.now(),
      updatedBy: "doctor"
    });
    alert("Appointment cancelled successfully.");
  } catch (error) {
    console.error("Error cancelling appointment:", error);
    alert("Unable to cancel this appointment right now. Please try again.");
  }
};

window.contactPatient = function(patientPhone) {
  const phone = String(patientPhone || "").trim();
  if (!phone) {
    alert("Patient phone number is not available.");
    return;
  }

  window.location.href = `tel:${phone}`;
};

if (userAvatarBtn) {
  userAvatarBtn.addEventListener("click", toggleUserMenu);
}

if (userMenu) {
  userMenu.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "edit-profile") {
      closeUserMenu();
      window.location.href = "clinic-staff-profile.html";
      return;
    }
    if (action === "logout") {
      closeUserMenu();
      signOut(auth);
      window.location.href = "login.html";
    }
  });
}

document.addEventListener("click", (event) => {
  if (!userMenu || !userAvatarBtn) return;
  if (!userMenu.contains(event.target) && !userAvatarBtn.contains(event.target)) {
    closeUserMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeUserMenu();
  }
});

if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    loadAppointments();
  });
}

if (editWorkingHoursBtn) {
  editWorkingHoursBtn.addEventListener("click", () => {
    window.location.href = "clinic-staff-dashboard.html?openWorkingHours=1";
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const userSnap = await get(ref(db, "users/" + user.uid));
  if (!userSnap.exists()) {
    alert("Staff profile not found.");
    window.location.href = "login.html";
    return;
  }

  const userData = userSnap.val() || {};
  if (String(userData.role || "").toLowerCase() !== "clinic_staff") {
    window.location.href = "login.html";
    return;
  }
  clinicCode = userData.clinicCode;

  if (String(userData.status || "").toLowerCase() !== "active") {
    alert("Your clinic staff request is still pending doctor approval.");
    await signOut(auth);
    window.location.href = "login.html";
    return;
  }

  if (!clinicCode) {
    alert("You are not linked to any clinic. Please contact your doctor for the clinic code.");
    window.location.href = "login.html";
    return;
  }

  linkedDoctorUID = userData.linkedDoctorUID || await findDoctorByClinicCode(clinicCode);
  if (!linkedDoctorUID) {
    alert("Invalid clinic code. Please contact your doctor for the correct clinic code.");
    window.location.href = "login.html";
    return;
  }

  const doctorSnap = await get(ref(db, "doctors/" + linkedDoctorUID));
  const doctorData = doctorSnap.exists() ? (doctorSnap.val() || {}) : {};
  applyClinicTitle(doctorData);
  applyStaffIdentity(userData, user, doctorData);

  loadAppointments();
});
