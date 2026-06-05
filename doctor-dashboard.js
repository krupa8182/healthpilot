import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, update, get, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const logoutBtn = document.getElementById("logoutBtn");
const editProfileBtn = document.getElementById("editProfileBtn");
const editWorkingHoursBtn = document.getElementById("editWorkingHoursBtn");
const doctorMenuBtn = document.getElementById("doctorMenuBtn");
const doctorMenu = document.getElementById("doctorMenu");
const doctorMenuWrapper = document.getElementById("doctorMenuWrapper");
const dashboardOverview = document.querySelector(".doctor-dashboard-overview");
const clinicNameEl = document.getElementById("clinicName");
const doctorNameEl = document.getElementById("doctorName");
const doctorEmailEl = document.getElementById("doctorEmail");
const todayAppointmentsEl = document.getElementById("todayAppointments");
const pendingAppointmentsEl = document.getElementById("pendingAppointments");
const totalPatientsEl = document.getElementById("totalPatients");
const totalRevenueEl = document.getElementById("totalRevenue");
const appointmentsContainer = document.getElementById("appointmentsContainer");
const tabButtons = document.querySelectorAll(".tab-btn");
const doctorRejectedBanner = document.getElementById("doctorRejectedBanner");
const doctorRejectedTitle = document.getElementById("doctorRejectedTitle");
const doctorRejectedMessage = document.getElementById("doctorRejectedMessage");
const doctorRejectedEditBtn = document.getElementById("doctorRejectedEditBtn");

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
const clinicStaffSection = document.getElementById("clinicStaffSection");
const backToDashboardBtn = document.getElementById("backToDashboardBtn");
const backFromStaffBtn = document.getElementById("backFromStaffBtn");
const clinicStaffBtn = document.getElementById("clinicStaffBtn");
const workingDayChecks = document.querySelectorAll(".working-day");
const clinicCodeDisplay = document.getElementById("clinicCodeDisplay");
const generateClinicCodeBtn = document.getElementById("generateClinicCodeBtn");
const staffListContainer = document.getElementById("staffListContainer");
const blockedSlotDateEl = document.getElementById("blockedSlotDate");
const blockedSlotHelpEl = document.getElementById("blockedSlotHelp");
const doctorBlockedSlotList = document.getElementById("doctorBlockedSlotList");

const today = new Date().toISOString().split("T")[0];

let currentStatus = "approved";
let currentUser = null;
let allAppointments = {};
let allPatients = new Set();
let doctorAvailability = null;
let blockedSlotsByDate = {};
let hasCheckedProfile = false; // Flag to prevent multiple profile checks
const DEFAULT_REJECTION_MESSAGE = "Your profile is hidden until the requested corrections are made and submitted again.";

function renderRejectedBanner(profile = null) {
  if (!doctorRejectedBanner || !doctorRejectedTitle || !doctorRejectedMessage) return;

  const status = String(profile?.status || "").toLowerCase();
  if (status !== "rejected") {
    doctorRejectedBanner.classList.add("is-hidden");
    doctorRejectedMessage.textContent = "";
    return;
  }

  doctorRejectedTitle.textContent = "Your profile needs updates before it can go live.";
  doctorRejectedMessage.textContent = profile?.rejectionMessage || DEFAULT_REJECTION_MESSAGE;
  doctorRejectedBanner.classList.remove("is-hidden");
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

function isToday(dateString) {
  const appointmentDate = parseDateString(dateString);
  if (!appointmentDate) return false;
  const now = new Date();
  return appointmentDate.getFullYear() === now.getFullYear() &&
    appointmentDate.getMonth() === now.getMonth() &&
    appointmentDate.getDate() === now.getDate();
}

function isHiddenAppointment(appointment) {
  const status = String(appointment?.status || "").toLowerCase();
  if (status === "cancelled" || status === "canceled" || status === "rejected") {
    return true;
  }
  return shouldHideAppointmentFromDoctorDashboard(appointment);
}

function isRemainingTodayAppointment(appointment) {
  if (!isToday(appointment?.date) || isHiddenAppointment(appointment)) return false;

  const status = String(appointment?.status || "").toLowerCase();
  if (status === "completed") return false;

  const appointmentDateTime = getAppointmentDateTime(appointment);
  if (!appointmentDateTime) return false;
  return appointmentDateTime >= new Date();
}

function hasRecordedRevenue(appointment) {
  const paymentStatus = String(appointment?.payment?.status || "").toLowerCase();
  return paymentStatus === "paid" || paymentStatus === "success";
}

function formatCurrencyValue(amount) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return "Rs. 0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value).replace("₹", "Rs. ");
}

function updateDoctorStats() {
  let todayCount = 0;
  let pendingCount = 0;
  let revenueTotal = 0;
  allPatients = new Set();

  Object.values(allAppointments || {}).forEach((appointment) => {
    if (isHiddenAppointment(appointment)) return;

    if (appointment?.patientUID) {
      allPatients.add(String(appointment.patientUID));
    }

    if (isToday(appointment?.date)) {
      todayCount += 1;
    }

    if (isRemainingTodayAppointment(appointment)) {
      pendingCount += 1;
    }

    if (hasRecordedRevenue(appointment)) {
      revenueTotal += Number(appointment?.payment?.amount || 0) || 0;
    }
  });

  if (todayAppointmentsEl) todayAppointmentsEl.textContent = String(todayCount);
  if (pendingAppointmentsEl) pendingAppointmentsEl.textContent = String(pendingCount);
  if (totalPatientsEl) totalPatientsEl.textContent = String(allPatients.size);
  if (totalRevenueEl) totalRevenueEl.textContent = formatCurrencyValue(revenueTotal);
}

async function updateAppointmentStatus(appointmentId, currentData, nextStatus) {
  const payload = {
    status: nextStatus,
    updatedAt: Date.now(),
    updatedBy: "doctor",
  };

  if (nextStatus === "approved") {
    payload.patientConfirmed = currentData?.patientConfirmed === true;
    payload.approvedAt = Date.now();
  }

  if (nextStatus === "rejected") {
    payload.rejectedAt = Date.now();
    payload.rejectedBy = "doctor";
  }

  if (nextStatus === "cancelled") {
    payload.cancelledAt = Date.now();
    payload.cancelledBy = "doctor";
  }

  await update(ref(db, "appointments/" + appointmentId), payload);
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
  return days
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
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
    if (String(appointment?.doctorUID || "") !== String(currentUser?.uid || "")) return;
    if (shouldHideAppointmentFromDoctorDashboard(appointment)) return;

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

function shouldHideAppointmentFromDoctorDashboard(appointment) {
  const paymentStatus = String(appointment?.payment?.status || "").toLowerCase();
  const paymentMethod = String(appointment?.payment?.method || appointment?.payment?.preference || "").toLowerCase();
  const isOnline = paymentMethod === "online" || Boolean(appointment?.payment?.payment_id) || Boolean(appointment?.payment?.provider);
  return isOnline && (paymentStatus === "failed" || paymentStatus === "cancelled" || paymentStatus === "pending");
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
    doctorBlockedSlotList.innerHTML = "<p>Save your working hours first to manage date-specific slot blocking.</p>";
    updateBlockedSlotHelp("Booked slots stay locked. Only open slots can be blocked or reopened.");
    return;
  }

  const selectedDate = blockedSlotDateEl?.value || "";
  if (!selectedDate) {
    doctorBlockedSlotList.innerHTML = "<p>Select a date to manage your live slots.</p>";
    return;
  }

  const { isWorkingDay, slots } = getDoctorDateMeta(selectedDate);
  doctorBlockedSlotList.innerHTML = "";

  if (!isWorkingDay) {
    doctorBlockedSlotList.innerHTML = "<p>You are not scheduled to work on this date.</p>";
    updateBlockedSlotHelp("Choose one of your working days to block or reopen specific timings.");
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
  if (!currentUser?.uid) return;

  const patch = {};
  patch[`doctors/${currentUser.uid}/blockedSlots/${dateStr}/${time24}`] = isCurrentlyBlocked ? null : true;

  try {
    await update(ref(db), patch);

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

function hasDoctorProfileBasics(doctorData) {
  if (!doctorData) return false;
  const requiredFields = ["name", "specialization", "clinic", "experience", "fee", "location"];
  return requiredFields.every((field) => String(doctorData[field] || "").trim() !== "");
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

function closeDoctorMenu() {
  if (!doctorMenu || !doctorMenuBtn) return;
  doctorMenu.classList.remove("open");
  doctorMenuBtn.setAttribute("aria-expanded", "false");
  doctorMenu.setAttribute("aria-hidden", "true");
}

function toggleDoctorMenu() {
  if (!doctorMenu || !doctorMenuBtn) return;
  const isOpen = doctorMenu.classList.contains("open");
  if (isOpen) {
    closeDoctorMenu();
  } else {
    doctorMenu.classList.add("open");
    doctorMenuBtn.setAttribute("aria-expanded", "true");
    doctorMenu.setAttribute("aria-hidden", "false");
  }
}

function scrollToDashboardTop() {
  if (dashboardOverview) {
    dashboardOverview.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function hideDoctorPanels() {
  if (workingHoursSection) {
    workingHoursSection.classList.add("is-hidden");
  }
  if (clinicStaffSection) {
    clinicStaffSection.classList.add("is-hidden");
  }
}

function openDoctorPanel(section) {
  hideDoctorPanels();
  if (!section) return;
  section.classList.remove("is-hidden");
  section.scrollIntoView({ behavior: "smooth", block: "start" });
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

async function loadDoctorHeaderAndAvailability(user) {
  const userSnap = await get(ref(db, "users/" + user.uid));
  const userData = userSnap.exists() ? (userSnap.val() || {}) : {};

  const doctorSnap = await get(ref(db, "doctors/" + user.uid));
  let doctorData = {};
  let availability = null;
  if (doctorSnap.exists()) {
    doctorData = doctorSnap.val() || {};
    availability = doctorData.availability || null;
    blockedSlotsByDate = normalizeBlockedSlots(doctorData.blockedSlots || {});
  }

  const doctorDisplayName = String(userData.name || doctorData.name || user.displayName || "Doctor").trim();
  const doctorEmail = String(userData.email || doctorData.email || user.email || "").trim().toLowerCase();
  if (doctorNameEl) {
    doctorNameEl.innerText = `Welcome, Dr. ${doctorDisplayName || "Doctor"}`;
  }
  if (doctorEmailEl) {
    doctorEmailEl.textContent = doctorEmail || "";
  }
  if (doctorMenuBtn) {
    doctorMenuBtn.textContent = doctorDisplayName.charAt(0).toUpperCase() || "D";
  }
  if (clinicNameEl) {
    clinicNameEl.textContent = String(doctorData.clinic || userData.clinic || "Clinic Dashboard").trim() || "Clinic Dashboard";
  }

  if (!availability && userSnap.exists()) {
    const oldHours = userSnap.val().workingHours || null;
    if (oldHours) {
      availability = {
        days: oldHours.days || [1, 2, 3, 4, 5],
        start: oldHours.start,
        end: oldHours.end,
        slotDuration: oldHours.slotDuration || 15,
        lunchBreak: oldHours.lunchBreak || null
      };
    }
  }

  if (!availability) return;

  doctorAvailability = {
    days: availability.days || [1, 2, 3, 4, 5],
    start: availability.start,
    end: availability.end,
    slotDuration: availability.slotDuration || 15,
    lunchBreak: availability.lunchBreak || null
  };

  const start = convertFrom24Hour(doctorAvailability.start);
  const end = convertFrom24Hour(doctorAvailability.end);

  startHourEl.value = start.hour;
  startMinuteEl.value = start.minute;
  startPeriodEl.value = start.period;

  endHourEl.value = end.hour;
  endMinuteEl.value = end.minute;
  endPeriodEl.value = end.period;

  slotDurationEl.value = String(doctorAvailability.slotDuration || 15);

  const daySet = new Set((doctorAvailability.days || []).map((d) => Number(d)));
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

function renderAppointments() {
  if (!appointmentsContainer || !currentUser) return;

  appointmentsContainer.innerHTML = "";
  const entries = Object.entries(allAppointments)
    .filter(([, data]) => {
      if (data.doctorUID !== currentUser.uid) return false;
      if (shouldHideAppointmentFromDoctorDashboard(data)) return false;
      return String(data.status || "").toLowerCase() === currentStatus;
    })
    .sort(([, left], [, right]) => {
      const leftKey = `${left.date || ""} ${left.time || ""}`;
      const rightKey = `${right.date || ""} ${right.time || ""}`;
      return leftKey.localeCompare(rightKey);
    });

  if (entries.length === 0) {
    const emptyLabel = currentStatus === "approved" ? "upcoming" : currentStatus;
    appointmentsContainer.innerHTML = `<p>No ${emptyLabel} appointments.</p>`;
    return;
  }

  entries.forEach(async ([appointmentId, data]) => {
    const card = document.createElement("div");
    card.className = "appointment-card";

    let patientName = "Unknown";
    const patientSnap = await get(ref(db, "users/" + data.patientUID));
    if (patientSnap.exists()) {
      patientName = patientSnap.val().name || "No Name";
    }

    card.innerHTML = `
      <p><strong>Patient:</strong> ${patientName}</p>
      <p><strong>Date:</strong> ${data.date || "N/A"}</p>
      <p><strong>Time:</strong> ${data.time || "N/A"}</p>
      <p><strong>Problem:</strong> ${data.problem || "Not specified"}</p>
      <p><strong>Status:</strong> ${data.status}</p>
      <p><strong>Payment:</strong> ${data.payment?.status || "unpaid"}${data.payment?.method ? ` (${data.payment.method})` : ""}</p>
    `;

    if (data.status === "approved") {
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel Appointment";
      cancelBtn.className = "reject-btn";
      cancelBtn.addEventListener("click", async () => {
        try {
          await updateAppointmentStatus(appointmentId, data, "cancelled");
          alert("Appointment cancelled. Patient notification and refund handling will run automatically.");
        } catch (error) {
          console.error("Error cancelling appointment:", error);
          alert("Unable to cancel appointment. Please try again.");
        }
      });
      card.appendChild(cancelBtn);
    }

    appointmentsContainer.appendChild(card);
  });
}


if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    closeDoctorMenu();
    await signOut(auth);
    window.location.href = "login.html";
  });
}

if (editProfileBtn) {
  editProfileBtn.addEventListener("click", () => {
    closeDoctorMenu();
    window.location.href = "doctor-profile.html";
  });
}

if (doctorRejectedEditBtn) {
  doctorRejectedEditBtn.addEventListener("click", () => {
    window.location.href = "doctor-profile.html";
  });
}

if (editWorkingHoursBtn) {
  editWorkingHoursBtn.addEventListener("click", () => {
    closeDoctorMenu();
    openDoctorPanel(workingHoursSection);
  });
}

if (backToDashboardBtn) {
  backToDashboardBtn.addEventListener("click", () => {
    hideDoctorPanels();
    scrollToDashboardTop();
  });
}

if (clinicStaffBtn) {
  clinicStaffBtn.addEventListener("click", () => {
    closeDoctorMenu();
    openDoctorPanel(clinicStaffSection);
  });
}

if (backFromStaffBtn) {
  backFromStaffBtn.addEventListener("click", () => {
    hideDoctorPanels();
    scrollToDashboardTop();
  });
}

if (doctorMenuBtn) {
  doctorMenuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleDoctorMenu();
  });
}

document.addEventListener("click", (event) => {
  if (!doctorMenuWrapper) return;
  if (!doctorMenuWrapper.contains(event.target)) {
    closeDoctorMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeDoctorMenu();
  }
});

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentStatus = btn.dataset.status;
    renderAppointments();
  });
});

if (blockedSlotDateEl) {
  blockedSlotDateEl.min = today;
  blockedSlotDateEl.addEventListener("change", renderBlockedSlotEditor);
}

if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    if (!currentUser) return;

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
      await Promise.all([
        update(ref(db, "doctors/" + currentUser.uid), { availability }),
        update(ref(db, "users/" + currentUser.uid), {
          workingHours: {
            days: selectedDays,
            start,
            end,
            slotDuration,
            lunchBreak
          }
        })
      ]);

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

populateHours();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;
  const doctorRef = ref(db, "doctors/" + user.uid);
  
  // Only check profile completeness on first load, not on every auth state change
  if (!hasCheckedProfile) {
    hasCheckedProfile = true;
    const doctorSnap = await get(doctorRef);
    const doctorData = doctorSnap.exists() ? doctorSnap.val() : null;
    if (!hasDoctorProfileBasics(doctorData)) {
      window.location.href = "doctor-profile.html";
      return;
    }
    renderRejectedBanner(doctorData);
  }

  await loadDoctorHeaderAndAvailability(user);

  onValue(doctorRef, (snapshot) => {
    const doctorData = snapshot.exists() ? snapshot.val() : null;
    renderRejectedBanner(doctorData);
  });

  // Load and display clinic code
  loadClinicCode(user);

  // Load and display staff list
  loadStaffList(user);

  const appointmentsQuery = query(ref(db, "appointments"), orderByChild("doctorUID"), equalTo(user.uid));
  onValue(appointmentsQuery, (snapshot) => {
    allAppointments = snapshot.exists() ? snapshot.val() : {};
    updateDoctorStats();
    renderAppointments();
    renderBlockedSlotEditor();
  });
});

// Clinic Code Functions
function generateClinicCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function loadClinicCode(user) {
  try {
    const doctorSnap = await get(ref(db, "doctors/" + user.uid));
    if (doctorSnap.exists()) {
      const doctorData = doctorSnap.val();
      const clinicCode = doctorData.clinicCode;
      if (clinicCode && clinicCodeDisplay) {
        clinicCodeDisplay.value = clinicCode;
      } else if (clinicCodeDisplay) {
        clinicCodeDisplay.value = "No clinic code generated";
      }
    }
  } catch (error) {
    console.error("Error loading clinic code:", error);
  }
}

async function saveClinicCode(user, clinicCode) {
  try {
    const doctorRef = ref(db, "doctors/" + user.uid);
    const doctorSnap = await get(doctorRef);
    const existing = doctorSnap.exists() ? doctorSnap.val() : {};
    const payload = { clinicCode };

    if (!Object.prototype.hasOwnProperty.call(existing, "status")) {
      payload.status = "pending";
    }
    if (!Object.prototype.hasOwnProperty.call(existing, "uid")) {
      payload.uid = user.uid;
    }

    await update(doctorRef, payload);
    console.log("Clinic code saved successfully");
  } catch (error) {
    console.error("Error saving clinic code:", error);
    alert("Error saving clinic code. Please try again.");
  }
}

function getStaffStatusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "active") return "staff-status staff-status--active";
  if (normalized === "rejected") return "staff-status staff-status--rejected";
  return "staff-status staff-status--pending";
}

function getStaffStatusLabel(staff) {
  const status = String(staff?.status || "").toLowerCase();
  if (status === "active") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending Approval";
}

async function updateStaffApproval(uid, nextStatus) {
  try {
    const patch = {
      status: nextStatus,
      staffApprovalUpdatedAt: Date.now(),
      approvedBy: currentUser?.uid || null,
    };
    if (nextStatus === "active") {
      patch.linkedDoctorUID = currentUser?.uid || null;
    }
    await update(ref(db, `users/${uid}`), patch);
    await loadStaffList(currentUser);
  } catch (error) {
    console.error(`Error updating staff status to ${nextStatus}:`, error);
    const code = String(error?.code || "").toLowerCase();
    if (code.includes("permission-denied") || code.includes("permission_denied")) {
      alert("Doctor approval is blocked by Realtime Database rules. Publish the latest database rules, then try again.");
      return;
    }
    alert("Unable to update the staff request right now. Please try again.");
  }
}

async function loadStaffList(user) {
  try {
    const doctorSnap = await get(ref(db, "doctors/" + user.uid));
    if (!doctorSnap.exists()) return;

    const doctorData = doctorSnap.val();
    const clinicCode = doctorData.clinicCode;

    if (!clinicCode || !staffListContainer) return;

    // Find all staff with this clinic code
    const usersSnap = await get(ref(db, "users"));
    if (!usersSnap.exists()) {
      staffListContainer.innerHTML = "<h3>Your Clinic Staff</h3><p>No staff members have joined yet.</p>";
      return;
    }

    const users = usersSnap.val();
    const staffMembers = Object.entries(users)
      .filter(([, userData]) =>
        userData.role === "clinic_staff" &&
        userData.clinicCode === clinicCode &&
        userData.verifiedAt
      )
      .map(([uid, userData]) => ({ uid, ...userData }));

    let html = "<h3>Your Clinic Staff</h3>";
    if (staffMembers.length === 0) {
      html += "<p>No staff members have joined yet.</p>";
    } else {
      html += "<div class='staff-grid'>";
      staffMembers.forEach(staff => {
        html += `
          <div class='staff-card'>
            <div class='staff-avatar'>${(staff.name || "Staff").charAt(0).toUpperCase()}</div>
            <div class='staff-info'>
              <h4>${staff.name || "Staff Member"}</h4>
              <p>${staff.email || ""}</p>
              <p class='${getStaffStatusClass(staff.status)}'>${getStaffStatusLabel(staff)}</p>
              ${
                staff.status === "pending"
                  ? `
                    <div class="staff-actions">
                      <button class="approve-btn" type="button" data-staff-action="approve" data-staff-id="${staff.uid}">Approve</button>
                      <button class="reject-btn" type="button" data-staff-action="reject" data-staff-id="${staff.uid}">Reject</button>
                    </div>
                  `
                  : ""
              }
            </div>
          </div>
        `;
      });
      html += "</div>";
    }

    staffListContainer.innerHTML = html;
  } catch (error) {
    console.error("Error loading staff list:", error);
  }
}

if (staffListContainer) {
  staffListContainer.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-staff-action]");
    if (!button) return;

    const staffId = button.dataset.staffId;
    const action = button.dataset.staffAction;
    if (!staffId || !action) return;

    if (action === "approve") {
      await updateStaffApproval(staffId, "active");
      return;
    }

    if (action === "reject") {
      await updateStaffApproval(staffId, "rejected");
    }
  });
}

// Event listener for generate clinic code button
if (generateClinicCodeBtn) {
  generateClinicCodeBtn.addEventListener("click", async () => {
    if (!currentUser) return;

    const newCode = generateClinicCode();
    if (clinicCodeDisplay) {
      clinicCodeDisplay.value = newCode;
    }

    await saveClinicCode(currentUser, newCode);
    alert("New clinic code generated and saved!");
  });
}
