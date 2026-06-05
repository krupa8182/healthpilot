import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, update, get, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const clinicNameEl = document.getElementById("clinicName");
const staffNameEl = document.getElementById("staffName");
const todayAppointmentsEl = document.getElementById("todayAppointments");
const pendingAppointmentsEl = document.getElementById("pendingAppointments");
const totalPatientsEl = document.getElementById("totalPatients");
const appointmentsContainer = document.getElementById("appointmentsContainer");
const tabButtons = document.querySelectorAll(".tab-btn");
const pendingContainer = document.getElementById("pendingContainer");
const refreshBtn = document.getElementById("refreshBtn");
const editWorkingHoursBtn = document.getElementById("editWorkingHoursBtn");
const userAvatarBtn = document.getElementById("userAvatarBtn");
const userMenu = document.getElementById("userMenu");
const userInitial = document.getElementById("userInitial");
const startHourEl = document.getElementById("startHour");
const startMinuteEl = document.getElementById("startMinute");
const startPeriodEl = document.getElementById("startPeriod");
const endHourEl = document.getElementById("endHour");
const endMinuteEl = document.getElementById("endMinute");
const endPeriodEl = document.getElementById("endPeriod");
const lunchStartHourEl = document.getElementById("lunchStartHour");
const lunchStartMinuteEl = document.getElementById("lunchStartMinute");
const lunchStartPeriodEl = document.getElementById("lunchStartPeriod");
const lunchEndHourEl = document.getElementById("lunchEndHour");
const lunchEndMinuteEl = document.getElementById("lunchEndMinute");
const lunchEndPeriodEl = document.getElementById("lunchEndPeriod");
const slotDurationEl = document.getElementById("slotDuration");
const saveBtn = document.getElementById("saveWorkingHours");
const workingHoursSection = document.getElementById("workingHoursSection");
const backToDashboardBtn = document.getElementById("backToDashboardBtn");
const workingDayChecks = document.querySelectorAll(".working-day");
const blockedSlotDateEl = document.getElementById("blockedSlotDate");
const blockedSlotHelpEl = document.getElementById("blockedSlotHelp");
const doctorBlockedSlotList = document.getElementById("doctorBlockedSlotList");

let currentUser = null;
let linkedDoctorUID = null;
let clinicCode = null;
let currentStatus = "approved";
let allAppointments = {};
let hasCheckedStaffAccess = false; // Flag to prevent multiple access checks
let doctorAvailability = null;
let blockedSlotsByDate = {};
const today = new Date().toISOString().split("T")[0];

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
  clinicNameEl.textContent = String(doctorData?.clinic || "Clinic Dashboard").trim() || "Clinic Dashboard";
}

function statusClass(status) {
  const normalized = (status || "").toLowerCase();
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

function goToStaffProfile() {
  closeUserMenu();
  window.location.href = "clinic-staff-profile.html";
}

if (userAvatarBtn) {
  userAvatarBtn.addEventListener("click", toggleUserMenu);
}

if (userMenu) {
  userMenu.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "edit-profile") {
      goToStaffProfile();
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
    loadDashboardData();
  });
}

if (editWorkingHoursBtn) {
  editWorkingHoursBtn.addEventListener("click", async () => {
    if (!workingHoursSection) return;
    await loadLinkedDoctorAvailability();
    workingHoursSection.classList.remove("is-hidden");
    workingHoursSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

if (backToDashboardBtn) {
  backToDashboardBtn.addEventListener("click", () => {
    if (workingHoursSection) {
      workingHoursSection.classList.add("is-hidden");
    }
    const dashboardHeader = document.querySelector(".dashboard-header");
    if (dashboardHeader) {
      dashboardHeader.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

if (blockedSlotDateEl) {
  blockedSlotDateEl.min = today;
  blockedSlotDateEl.addEventListener("change", renderBlockedSlotEditor);
}

function isToday(dateString) {
  const appointmentDate = parseDateString(dateString);
  if (!appointmentDate) return false;
  const today = new Date();
  return appointmentDate.getFullYear() === today.getFullYear() &&
    appointmentDate.getMonth() === today.getMonth() &&
    appointmentDate.getDate() === today.getDate();
}

function parseDateString(dateString) {
  if (!dateString) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(dateString)) {
    const [day, month, year] = dateString.split(/[/-]/).map(Number);
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

function normalizeBlockedSlots(rawBlockedSlots = {}) {
  const normalized = {};
  Object.entries(rawBlockedSlots || {}).forEach(([dateKey, slots]) => {
    if (!slots || typeof slots !== "object") return;
    const nextSlots = {};
    Object.entries(slots).forEach(([timeKey, value]) => {
      if (value) {
        nextSlots[timeKey] = value;
      }
    });
    if (Object.keys(nextSlots).length > 0) {
      normalized[dateKey] = nextSlots;
    }
  });
  return normalized;
}

function parseWorkingDays(days = []) {
  return days.map((value) => Number(value)).filter((value) => Number.isFinite(value));
}

function timeStringToMinutes(value) {
  if (!value && value !== 0) return null;
  const text = String(value).trim();
  if (!text) return null;

  const numericMatch = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!numericMatch) return null;

  const hour = Number(numericMatch[1]);
  const minute = Number(numericMatch[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function formatTimeTo12Hour(hours, minutes) {
  const ampm = hours >= 12 ? "PM" : "AM";
  let h = hours % 12;
  if (h === 0) h = 12;
  return `${h.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")} ${ampm}`;
}

function formatMinutesToLabel(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return "";
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return formatTimeTo12Hour(hour, minute);
}

function buildBookedSlotsByDate() {
  const nextBooked = {};
  Object.values(allAppointments || {}).forEach((appointment) => {
    if (String(appointment?.doctorUID || "") !== String(linkedDoctorUID || "")) return;
    const status = String(appointment?.status || "").toLowerCase();
    if (status !== "approved" && status !== "pending") return;

    const date = String(appointment?.date || "").trim();
    const time = String(appointment?.time || "").trim();
    if (!date || !time) return;

    if (!nextBooked[date]) nextBooked[date] = {};
    nextBooked[date][time] = Number(nextBooked[date][time] || 0) + 1;
  });
  return nextBooked;
}

function getDoctorDateMeta(dateStr) {
  if (!doctorAvailability || !dateStr) {
    return { isWorkingDay: false, slots: [] };
  }

  const workingDays = parseWorkingDays(doctorAvailability.days || []);
  const selectedDay = new Date(dateStr).getDay();
  if (!workingDays.includes(selectedDay)) {
    return { isWorkingDay: false, slots: [] };
  }

  const startMinutes = timeStringToMinutes(doctorAvailability.start || "09:00");
  const endMinutes = timeStringToMinutes(doctorAvailability.end || "17:00");
  const duration = Number(doctorAvailability.slotDuration || 15);
  const lunchBreak = doctorAvailability.lunchBreak || null;
  const lunchStartMinutes = lunchBreak ? timeStringToMinutes(lunchBreak.start) : null;
  const lunchEndMinutes = lunchBreak ? timeStringToMinutes(lunchBreak.end) : null;
  if (startMinutes === null || endMinutes === null || duration <= 0 || startMinutes >= endMinutes) {
    return { isWorkingDay: false, slots: [] };
  }

  const bookedSlots = buildBookedSlotsByDate()[dateStr] || {};
  const blockedSlots = blockedSlotsByDate[dateStr] || {};
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
        slots.push({
          type: "break",
          label12: `Lunch Break (${formatMinutesToLabel(lunchStartMinutes)} - ${formatMinutesToLabel(lunchEndMinutes)})`
        });
      }
      currentMinutes = lunchEndMinutes;
      continue;
    }

    const hh = Math.floor(currentMinutes / 60);
    const mm = currentMinutes % 60;
    const time24 = `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
    const slotDateTime = new Date(`${dateStr}T${time24}:00`);
    const isPast = slotDateTime <= now;
    const isBooked = Number(bookedSlots[time24] || 0) > 0;
    const isBlocked = Boolean(blockedSlots[time24]);

    slots.push({
      type: "slot",
      value24: time24,
      label12: formatTimeTo12Hour(hh, mm),
      isPast,
      isBooked,
      isBlocked
    });

    currentMinutes += duration;
  }

  return { isWorkingDay: true, slots };
}

function getDefaultBlockedSlotDate() {
  const metaToday = getDoctorDateMeta(today);
  if (metaToday.isWorkingDay) return today;

  for (let offset = 1; offset <= 30; offset += 1) {
    const nextDate = new Date(today);
    nextDate.setDate(nextDate.getDate() + offset);
    const dateStr = nextDate.toISOString().split("T")[0];
    if (getDoctorDateMeta(dateStr).isWorkingDay) {
      return dateStr;
    }
  }

  return today;
}

function updateBlockedSlotHelp(text) {
  if (blockedSlotHelpEl) {
    blockedSlotHelpEl.textContent = text;
  }
}

function renderBlockedSlotEditor() {
  if (!doctorBlockedSlotList) return;

  if (!doctorAvailability) {
    doctorBlockedSlotList.innerHTML = "<p>Save working hours first to manage date-specific slot blocking.</p>";
    updateBlockedSlotHelp("Booked slots stay locked. Only open slots can be blocked or reopened.");
    return;
  }

  const selectedDate = blockedSlotDateEl?.value || "";
  if (!selectedDate) {
    doctorBlockedSlotList.innerHTML = "<p>Select a date to manage live slots.</p>";
    return;
  }

  const { isWorkingDay, slots } = getDoctorDateMeta(selectedDate);
  doctorBlockedSlotList.innerHTML = "";

  if (!isWorkingDay) {
    doctorBlockedSlotList.innerHTML = "<p>The doctor is not scheduled to work on this date.</p>";
    updateBlockedSlotHelp("Choose one of the working days to block or reopen specific timings.");
    return;
  }

  if (!slots.length) {
    doctorBlockedSlotList.innerHTML = "<p>No slots are generated for this date yet.</p>";
    return;
  }

  const activeSlots = slots.filter((slot) => slot.type === "slot");
  const bookedCount = activeSlots.filter((slot) => slot.isBooked).length;
  const blockedCount = activeSlots.filter((slot) => slot.isBlocked).length;
  const openCount = activeSlots.filter((slot) => !slot.isBooked && !slot.isBlocked && !slot.isPast).length;
  const lockedPastCount = activeSlots.filter((slot) => slot.isPast && !slot.isBooked).length;
  updateBlockedSlotHelp(`Open: ${openCount} | Blocked: ${blockedCount} | Booked/Past: ${bookedCount + lockedPastCount}`);

  slots.forEach((slot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slot-btn";

    if (slot.type === "break") {
      button.textContent = slot.label12;
      button.disabled = true;
      button.classList.add("slot-break");
      doctorBlockedSlotList.appendChild(button);
      return;
    }

    if (slot.isPast) {
      button.textContent = `${slot.label12} (Past)`;
      button.disabled = true;
      button.classList.add("slot-disabled-doctor");
    } else if (slot.isBooked) {
      button.textContent = `${slot.label12} (Booked)`;
      button.disabled = true;
      button.classList.add("slot-full");
    } else if (slot.isBlocked) {
      button.textContent = `${slot.label12} (Blocked)`;
      button.classList.add("slot-blocked-live");
      button.addEventListener("click", () => toggleBlockedSlot(selectedDate, slot.value24, true));
    } else {
      button.textContent = `${slot.label12} (Available)`;
      button.classList.add("slot-open-live");
      button.addEventListener("click", () => toggleBlockedSlot(selectedDate, slot.value24, false));
    }

    doctorBlockedSlotList.appendChild(button);
  });
}

async function toggleBlockedSlot(dateStr, time24, isCurrentlyBlocked) {
  if (!linkedDoctorUID) return;

  try {
    await update(ref(db, `doctors/${linkedDoctorUID}/blockedSlots/${dateStr}`), {
      [time24]: isCurrentlyBlocked ? null : true
    });

    if (!blockedSlotsByDate[dateStr]) {
      blockedSlotsByDate[dateStr] = {};
    }

    if (isCurrentlyBlocked) {
      delete blockedSlotsByDate[dateStr][time24];
      if (Object.keys(blockedSlotsByDate[dateStr]).length === 0) {
        delete blockedSlotsByDate[dateStr];
      }
    } else {
      blockedSlotsByDate[dateStr][time24] = true;
    }

    renderBlockedSlotEditor();
  } catch (error) {
    console.error("Error updating blocked slot:", error);
    alert("Unable to update this slot right now. Please try again.");
  }
}

function populateHours() {
  if (!startHourEl || !endHourEl) return;

  startHourEl.innerHTML = "";
  endHourEl.innerHTML = "";
  if (lunchStartHourEl) lunchStartHourEl.innerHTML = "<option value=\"\">Hour</option>";
  if (lunchEndHourEl) lunchEndHourEl.innerHTML = "<option value=\"\">Hour</option>";

  for (let i = 1; i <= 12; i += 1) {
    const startOpt = document.createElement("option");
    startOpt.value = String(i);
    startOpt.textContent = String(i);
    startHourEl.appendChild(startOpt);

    const endOpt = document.createElement("option");
    endOpt.value = String(i);
    endOpt.textContent = String(i);
    endHourEl.appendChild(endOpt);

    if (lunchStartHourEl) {
      const lunchStartOpt = document.createElement("option");
      lunchStartOpt.value = String(i);
      lunchStartOpt.textContent = String(i);
      lunchStartHourEl.appendChild(lunchStartOpt);
    }

    if (lunchEndHourEl) {
      const lunchEndOpt = document.createElement("option");
      lunchEndOpt.value = String(i);
      lunchEndOpt.textContent = String(i);
      lunchEndHourEl.appendChild(lunchEndOpt);
    }
  }
}

function convertTo24Hour(hour, minute, period) {
  let h = parseInt(hour, 10);
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${minute}`;
}

function convertFrom24Hour(time24) {
  if (!time24 || !time24.includes(":")) {
    return { hour: "9", minute: "00", period: "AM" };
  }

  const [hourStr, minute] = time24.split(":");
  let hour = parseInt(hourStr, 10);
  const period = hour >= 12 ? "PM" : "AM";
  if (hour === 0) hour = 12;
  if (hour > 12) hour -= 12;

  return { hour: String(hour), minute, period };
}

async function loadLinkedDoctorAvailability() {
  if (!linkedDoctorUID) return;

  const doctorSnap = await get(ref(db, "doctors/" + linkedDoctorUID));
  const doctorData = doctorSnap.exists() ? (doctorSnap.val() || {}) : {};
  const availability = doctorData.availability || null;
  blockedSlotsByDate = normalizeBlockedSlots(doctorData.blockedSlots || {});

  if (!availability) {
    doctorAvailability = null;
    workingDayChecks.forEach((checkbox) => {
      checkbox.checked = false;
    });
    if (startHourEl) startHourEl.value = "9";
    if (startMinuteEl) startMinuteEl.value = "00";
    if (startPeriodEl) startPeriodEl.value = "AM";
    if (endHourEl) endHourEl.value = "5";
    if (endMinuteEl) endMinuteEl.value = "00";
    if (endPeriodEl) endPeriodEl.value = "PM";
    if (slotDurationEl) slotDurationEl.value = "15";
    if (lunchStartHourEl) lunchStartHourEl.value = "";
    if (lunchStartMinuteEl) lunchStartMinuteEl.value = "";
    if (lunchStartPeriodEl) lunchStartPeriodEl.value = "AM";
    if (lunchEndHourEl) lunchEndHourEl.value = "";
    if (lunchEndMinuteEl) lunchEndMinuteEl.value = "";
    if (lunchEndPeriodEl) lunchEndPeriodEl.value = "AM";
    renderBlockedSlotEditor();
    return;
  }

  doctorAvailability = {
    days: availability.days || [1, 2, 3, 4, 5],
    start: availability.start,
    end: availability.end,
    slotDuration: availability.slotDuration || 15,
    lunchBreak: availability.lunchBreak || null
  };

  const start = convertFrom24Hour(doctorAvailability.start);
  const end = convertFrom24Hour(doctorAvailability.end);

  if (startHourEl) startHourEl.value = start.hour;
  if (startMinuteEl) startMinuteEl.value = start.minute;
  if (startPeriodEl) startPeriodEl.value = start.period;
  if (endHourEl) endHourEl.value = end.hour;
  if (endMinuteEl) endMinuteEl.value = end.minute;
  if (endPeriodEl) endPeriodEl.value = end.period;
  if (slotDurationEl) slotDurationEl.value = String(doctorAvailability.slotDuration || 15);

  const daySet = new Set((doctorAvailability.days || []).map((day) => Number(day)));
  workingDayChecks.forEach((checkbox) => {
    checkbox.checked = daySet.has(Number(checkbox.value));
  });

  if (doctorAvailability.lunchBreak?.start && lunchStartHourEl) {
    const lunchStart = convertFrom24Hour(doctorAvailability.lunchBreak.start);
    lunchStartHourEl.value = lunchStart.hour;
    if (lunchStartMinuteEl) lunchStartMinuteEl.value = lunchStart.minute;
    if (lunchStartPeriodEl) lunchStartPeriodEl.value = lunchStart.period;
  } else {
    if (lunchStartHourEl) lunchStartHourEl.value = "";
    if (lunchStartMinuteEl) lunchStartMinuteEl.value = "";
    if (lunchStartPeriodEl) lunchStartPeriodEl.value = "AM";
  }

  if (doctorAvailability.lunchBreak?.end && lunchEndHourEl) {
    const lunchEnd = convertFrom24Hour(doctorAvailability.lunchBreak.end);
    lunchEndHourEl.value = lunchEnd.hour;
    if (lunchEndMinuteEl) lunchEndMinuteEl.value = lunchEnd.minute;
    if (lunchEndPeriodEl) lunchEndPeriodEl.value = lunchEnd.period;
  } else {
    if (lunchEndHourEl) lunchEndHourEl.value = "";
    if (lunchEndMinuteEl) lunchEndMinuteEl.value = "";
    if (lunchEndPeriodEl) lunchEndPeriodEl.value = "AM";
  }

  if (blockedSlotDateEl) {
    blockedSlotDateEl.min = today;
    if (!blockedSlotDateEl.value) {
      blockedSlotDateEl.value = getDefaultBlockedSlotDate();
    }
  }

  renderBlockedSlotEditor();
}

function isHiddenAppointment(appointment) {
  const status = String(appointment?.status || "").toLowerCase();
  if (status === "cancelled" || status === "canceled" || status === "rejected") {
    return true;
  }
  return shouldHideAppointmentFromClinicStaffDashboard(appointment);
}

function shouldHideAppointmentFromClinicStaffDashboard(appointment) {
  const paymentStatus = String(appointment?.payment?.status || "").toLowerCase();
  const paymentMethod = String(appointment?.payment?.method || appointment?.payment?.preference || "").toLowerCase();
  const isOnline = paymentMethod === "online" || Boolean(appointment?.payment?.payment_id) || Boolean(appointment?.payment?.provider);
  return isOnline && (paymentStatus === "failed" || paymentStatus === "cancelled" || paymentStatus === "pending");
}

function isRemainingTodayAppointment(appointment) {
  if (!isToday(appointment?.date) || isHiddenAppointment(appointment)) return false;

  const status = String(appointment?.status || "").toLowerCase();
  if (status === "completed") return false;

  const appointmentDate = parseDateString(appointment.date);
  const timeInMinutes = parseTimeToMinutes(appointment.time);
  if (!appointmentDate || timeInMinutes === null) return false;

  const appointmentDateTime = new Date(appointmentDate);
  appointmentDateTime.setHours(Math.floor(timeInMinutes / 60), timeInMinutes % 60, 0, 0);
  return appointmentDateTime >= new Date();
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

function isUpcomingScheduledAppointment(appointment) {
  if (isHiddenAppointment(appointment)) return false;

  const status = String(appointment?.status || "").toLowerCase();
  if (status !== "approved") return false;

  const appointmentDateTime = getAppointmentDateTime(appointment);
  if (!appointmentDateTime) return false;
  return appointmentDateTime >= new Date();
}

async function loadDashboardData() {
  if (!linkedDoctorUID) return;

  // Load appointments
  const appointmentsQuery = query(ref(db, "appointments"), orderByChild("doctorUID"), equalTo(linkedDoctorUID));
  onValue(appointmentsQuery, (snapshot) => {
    allAppointments = {};

    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        const appointment = child.val();
        allAppointments[child.key] = appointment;
      });
    }

    updateStats();
    renderAppointments();
    renderPendingActions();
  });
}

function updateStats() {
  const visibleAppointments = Object.values(allAppointments || {}).filter((appointment) => !isHiddenAppointment(appointment));
  let todayCount = 0;
  let pendingCount = 0;
  const uniquePatients = new Set();

  visibleAppointments.forEach((appointment) => {
    if (appointment?.patientUID) {
      uniquePatients.add(String(appointment.patientUID));
    }

    if (isToday(appointment?.date)) {
      todayCount += 1;
    }

    if (isRemainingTodayAppointment(appointment)) {
      pendingCount += 1;
    }
  });

  todayAppointmentsEl.textContent = todayCount;
  pendingAppointmentsEl.textContent = pendingCount;
  totalPatientsEl.textContent = uniquePatients.size;
}

function renderAppointments() {
  appointmentsContainer.innerHTML = "";

  const appointmentsToRender = Object.entries(allAppointments).filter(([, appointment]) => {
    if (String(appointment?.doctorUID || "") !== String(linkedDoctorUID || "")) return false;
    if (shouldHideAppointmentFromClinicStaffDashboard(appointment)) return false;

    const status = String(appointment?.status || "").toLowerCase();
    if (currentStatus === "cancelled") {
      return status === "cancelled" || status === "canceled";
    }

    return status === currentStatus;
  }).sort(([, left], [, right]) => {
    const leftDateTime = getAppointmentDateTime(left)?.getTime() || 0;
    const rightDateTime = getAppointmentDateTime(right)?.getTime() || 0;
    return leftDateTime - rightDateTime;
  });

  if (appointmentsToRender.length === 0) {
    const emptyLabel = currentStatus === "approved" ? "upcoming" : currentStatus;
    appointmentsContainer.innerHTML = `<p class='empty-state'>No ${emptyLabel} appointments.</p>`;
    return;
  }

  appointmentsToRender.forEach(async ([appointmentId, appointment]) => {
    const card = document.createElement("div");
    card.className = "appointment-card";

    // Get patient details
    let patientName = "Patient";
    try {
      const patientSnap = await get(ref(db, "users/" + appointment.patientUID));
      if (patientSnap.exists()) {
        patientName = patientSnap.val().name || "Patient";
      }
    } catch (error) {
      console.error("Error fetching patient:", error);
    }

    card.innerHTML = `
      <p><strong>Patient:</strong> ${patientName}</p>
      <p><strong>Date:</strong> ${appointment.date || "N/A"}</p>
      <p><strong>Time:</strong> ${appointment.time || "N/A"}</p>
      <p><strong>Problem:</strong> ${appointment.problem || "Not specified"}</p>
      <p><strong>Status:</strong> <span class="status-pill ${statusClass(appointment.status)}">${appointment.status}</span></p>
      <div class="appointment-actions">
        <button class="view-btn" onclick="viewAppointment('${appointmentId}')">View Details</button>
        <button class="ghost-btn" onclick="contactPatient('${appointment.patientUID}')">Contact Patient</button>
      </div>
    `;

    appointmentsContainer.appendChild(card);
  });
}

function renderPendingActions() {
  if (!pendingContainer) return;
  pendingContainer.innerHTML = "";

  const pendingAppointments = Object.entries(allAppointments).filter(([, appointment]) => {
    if (isHiddenAppointment(appointment)) return false;
    return String(appointment?.status || "").toLowerCase() === "pending";
  });

  if (pendingAppointments.length === 0) {
    pendingContainer.innerHTML = "<p class='empty-state'>No pending actions.</p>";
    return;
  }

  pendingAppointments.forEach(async ([appointmentId, appointment]) => {
    const card = document.createElement("div");
    card.className = "appointment-card";

    // Get patient details
    let patientName = "Patient";
    try {
      const patientSnap = await get(ref(db, "users/" + appointment.patientUID));
      if (patientSnap.exists()) {
        patientName = patientSnap.val().name || "Patient";
      }
    } catch (error) {
      console.error("Error fetching patient:", error);
    }

    card.innerHTML = `
      <p><strong>Patient:</strong> ${patientName}</p>
      <p><strong>Date:</strong> ${appointment.date || "N/A"}</p>
      <p><strong>Time:</strong> ${appointment.time || "N/A"}</p>
      <p><strong>Problem:</strong> ${appointment.problem || "Not specified"}</p>
      <div class="appointment-actions">
        <button class="approve-btn" onclick="approveAppointment('${appointmentId}')">Approve</button>
        <button class="reject-btn" onclick="rejectAppointment('${appointmentId}')">Reject</button>
        <button class="ghost-btn" onclick="rescheduleAppointment('${appointmentId}')">Reschedule</button>
      </div>
    `;

    pendingContainer.appendChild(card);
  });
}

// Global functions for button clicks
window.viewAppointment = function(appointmentId) {
  // Open appointment details modal or page
  alert("Appointment details for: " + appointmentId);
};

window.contactPatient = function(patientUID) {
  // Open patient contact modal
  alert("Contact patient: " + patientUID);
};

window.approveAppointment = async function(appointmentId) {
  try {
    await update(ref(db, "appointments/" + appointmentId), { status: "approved" });
    alert("Appointment approved!");
    loadDashboardData();
  } catch (error) {
    console.error(error);
    alert("Error approving appointment.");
  }
};

window.rejectAppointment = async function(appointmentId) {
  const reason = prompt("Reason for rejection (optional):");
  try {
    await update(ref(db, "appointments/" + appointmentId), {
      status: "rejected",
      rejectionReason: reason || ""
    });
    alert("Appointment rejected.");
    loadDashboardData();
  } catch (error) {
    console.error(error);
    alert("Error rejecting appointment.");
  }
};

window.rescheduleAppointment = function(appointmentId) {
  // Open reschedule modal
  alert("Reschedule appointment: " + appointmentId);
};

if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    if (!linkedDoctorUID) return;

    const selectedDays = [...workingDayChecks]
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => Number(checkbox.value));

    if (selectedDays.length === 0) {
      alert("Please select at least one working day.");
      return;
    }

    const start = convertTo24Hour(startHourEl.value, startMinuteEl.value, startPeriodEl.value);
    const end = convertTo24Hour(endHourEl.value, endMinuteEl.value, endPeriodEl.value);
    const slotDuration = parseInt(slotDurationEl.value, 10);

    if (start >= end) {
      alert("End time must be after start time.");
      return;
    }

    const hasLunchStart = Boolean(lunchStartHourEl?.value || lunchStartMinuteEl?.value);
    const hasLunchEnd = Boolean(lunchEndHourEl?.value || lunchEndMinuteEl?.value);
    let lunchBreak = null;

    if (hasLunchStart || hasLunchEnd) {
      if (
        !lunchStartHourEl?.value ||
        !lunchStartMinuteEl?.value ||
        !lunchStartPeriodEl?.value ||
        !lunchEndHourEl?.value ||
        !lunchEndMinuteEl?.value ||
        !lunchEndPeriodEl?.value
      ) {
        alert("Please provide both lunch start and end times, or leave them blank.");
        return;
      }

      const lunchStart = convertTo24Hour(lunchStartHourEl.value, lunchStartMinuteEl.value, lunchStartPeriodEl.value);
      const lunchEnd = convertTo24Hour(lunchEndHourEl.value, lunchEndMinuteEl.value, lunchEndPeriodEl.value);
      if (lunchStart >= lunchEnd) {
        alert("Lunch start must be earlier than lunch end.");
        return;
      }
      lunchBreak = { start: lunchStart, end: lunchEnd };
    }

    const availability = {
      days: selectedDays,
      start,
      end,
      slotDuration,
      maxPerSlot: 1
    };

    if (lunchBreak) {
      availability.lunchBreak = lunchBreak;
    }

    try {
      await update(ref(db, "doctors/" + linkedDoctorUID + "/availability"), availability);

      doctorAvailability = { ...availability };
      if (blockedSlotDateEl && !blockedSlotDateEl.value) {
        blockedSlotDateEl.value = getDefaultBlockedSlotDate();
      }
      renderBlockedSlotEditor();
      alert("Working hours saved successfully.");
    } catch (error) {
      console.error(error);
      alert("Error saving working hours.");
    }
  });
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentStatus = btn.dataset.status || "approved";
    tabButtons.forEach((tabBtn) => tabBtn.classList.toggle("active", tabBtn === btn));
    renderAppointments();
  });
});

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

populateHours();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;

  // Update user avatar
  const initial = (user.email || "S").charAt(0).toUpperCase();
  userInitial.textContent = initial;

  // Only check staff access on first load, not on every auth state change
  if (!hasCheckedStaffAccess) {
    hasCheckedStaffAccess = true;
    
    // Get staff profile
    const userSnap = await get(ref(db, "users/" + user.uid));
    if (userSnap.exists()) {
      const userData = userSnap.val();
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

      // Find doctor by clinic code
      linkedDoctorUID = userData.linkedDoctorUID || await findDoctorByClinicCode(clinicCode);
      if (!linkedDoctorUID) {
        alert("Invalid clinic code. Please contact your doctor for the correct clinic code.");
        window.location.href = "login.html";
        return;
      }

      // Get doctor/clinic info
      const doctorSnap = await get(ref(db, "doctors/" + linkedDoctorUID));
      if (doctorSnap.exists()) {
        const doctorData = doctorSnap.val() || {};
        applyClinicTitle(doctorData);
        applyStaffIdentity(userData, user, doctorData);
      } else {
        applyClinicTitle({});
        applyStaffIdentity(userData, user, {});
      }

      await loadLinkedDoctorAvailability();

      if (new URLSearchParams(window.location.search).get("openWorkingHours") === "1" && workingHoursSection) {
        workingHoursSection.classList.remove("is-hidden");
      }

      // Load dashboard data
      loadDashboardData();
    } else {
      alert("Staff profile not found.");
      window.location.href = "login.html";
    }
  } else {
    const userSnap = await get(ref(db, "users/" + user.uid));
    const userData = userSnap.exists() ? (userSnap.val() || {}) : {};
    if (String(userData.role || "").toLowerCase() !== "clinic_staff") {
      window.location.href = "login.html";
      return;
    }
    if (!linkedDoctorUID) {
      clinicCode = userData.clinicCode || clinicCode;
      linkedDoctorUID = userData.linkedDoctorUID || (clinicCode ? await findDoctorByClinicCode(clinicCode) : null);
    }
    if (linkedDoctorUID) {
      const doctorSnap = await get(ref(db, "doctors/" + linkedDoctorUID));
      const doctorData = doctorSnap.exists() ? (doctorSnap.val() || {}) : {};
      applyClinicTitle(doctorData);
      applyStaffIdentity(userData, user, doctorData);
    } else {
      applyStaffIdentity(userData, user, {});
    }
    // If we've already checked access, just reload dashboard data
    await loadLinkedDoctorAvailability();
    if (new URLSearchParams(window.location.search).get("openWorkingHours") === "1" && workingHoursSection) {
      workingHoursSection.classList.remove("is-hidden");
    }
    loadDashboardData();
  }
});
