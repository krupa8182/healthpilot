import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, update, get, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const userAvatarBtn = document.getElementById("userAvatarBtn");
const userMenu = document.getElementById("userMenu");
const userInitial = document.getElementById("userInitial");
const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");
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
const workingDayChecks = document.querySelectorAll(".working-day");
const blockedSlotDateEl = document.getElementById("blockedSlotDate");
const blockedSlotHelpEl = document.getElementById("blockedSlotHelp");
const doctorBlockedSlotList = document.getElementById("doctorBlockedSlotList");

const today = new Date().toISOString().split("T")[0];

let currentUser = null;
let doctorAvailability = null;
let blockedSlotsByDate = {};
let allAppointments = {};

function closeUserMenu() {
  if (!userMenu || !userAvatarBtn) return;
  userMenu.classList.remove("is-visible");
  userAvatarBtn.setAttribute("aria-expanded", "false");
}

function toggleUserMenu() {
  if (!userMenu || !userAvatarBtn) return;
  const nextVisible = !userMenu.classList.contains("is-visible");
  userMenu.classList.toggle("is-visible", nextVisible);
  userAvatarBtn.setAttribute("aria-expanded", nextVisible ? "true" : "false");
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

function normalizeBlockedSlots(rawBlockedSlots = {}) {
  const normalized = {};
  Object.entries(rawBlockedSlots || {}).forEach(([dateKey, slots]) => {
    if (!slots || typeof slots !== "object") return;
    const nextSlots = {};
    Object.entries(slots).forEach(([timeKey, value]) => {
      if (value) nextSlots[timeKey] = value;
    });
    if (Object.keys(nextSlots).length > 0) normalized[dateKey] = nextSlots;
  });
  return normalized;
}

function parseWorkingDays(days = []) {
  return days.map((value) => Number(value)).filter((value) => Number.isFinite(value));
}

function timeStringToMinutes(value) {
  if (!value && value !== 0) return null;
  const text = String(value).trim();
  const numericMatch = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!numericMatch) return null;
  const hour = Number(numericMatch[1]);
  const minute = Number(numericMatch[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
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

function shouldHideAppointment(appointment) {
  const paymentStatus = String(appointment?.payment?.status || "").toLowerCase();
  const paymentMethod = String(appointment?.payment?.method || appointment?.payment?.preference || "").toLowerCase();
  const isOnline = paymentMethod === "online" || Boolean(appointment?.payment?.payment_id) || Boolean(appointment?.payment?.provider);
  return isOnline && (paymentStatus === "failed" || paymentStatus === "cancelled" || paymentStatus === "pending");
}

function buildBookedSlotsByDate() {
  const nextBooked = {};
  Object.values(allAppointments || {}).forEach((appointment) => {
    if (String(appointment?.doctorUID || "") !== String(currentUser?.uid || "")) return;
    if (shouldHideAppointment(appointment)) return;
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
  if (!doctorAvailability || !dateStr) return { isWorkingDay: false, slots: [] };

  const workingDays = parseWorkingDays(doctorAvailability.days || []);
  const selectedDay = new Date(dateStr).getDay();
  if (!workingDays.includes(selectedDay)) return { isWorkingDay: false, slots: [] };

  const startMinutes = timeStringToMinutes(doctorAvailability.start || "09:00");
  const endMinutes = timeStringToMinutes(doctorAvailability.end || "17:00");
  const duration = Number(doctorAvailability.slotDuration || 15);
  const lunchBreak = doctorAvailability.lunchBreak || null;
  const lunchStartMinutes = lunchBreak ? timeStringToMinutes(lunchBreak.start) : null;
  const lunchEndMinutes = lunchBreak ? timeStringToMinutes(lunchBreak.end) : null;
  if (startMinutes === null || endMinutes === null || duration <= 0 || startMinutes >= endMinutes) return { isWorkingDay: false, slots: [] };

  const bookedSlots = buildBookedSlotsByDate()[dateStr] || {};
  const blockedSlots = blockedSlotsByDate[dateStr] || {};
  const slots = [];
  let currentMinutes = startMinutes;
  const now = new Date();

  while (currentMinutes < endMinutes) {
    if (lunchStartMinutes !== null && lunchEndMinutes !== null && currentMinutes >= lunchStartMinutes && currentMinutes < lunchEndMinutes) {
      if (!slots.some((slot) => slot.type === "break")) {
        slots.push({ type: "break", label12: `Lunch Break (${formatMinutesToLabel(lunchStartMinutes)} - ${formatMinutesToLabel(lunchEndMinutes)})` });
      }
      currentMinutes = lunchEndMinutes;
      continue;
    }

    const hh = Math.floor(currentMinutes / 60);
    const mm = currentMinutes % 60;
    const time24 = `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
    const slotDateTime = new Date(`${dateStr}T${time24}:00`);
    slots.push({
      type: "slot",
      value24: time24,
      label12: formatTimeTo12Hour(hh, mm),
      isPast: slotDateTime <= now,
      isBooked: Number(bookedSlots[time24] || 0) > 0,
      isBlocked: Boolean(blockedSlots[time24])
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
    if (getDoctorDateMeta(dateStr).isWorkingDay) return dateStr;
  }
  return today;
}

function updateBlockedSlotHelp(text) {
  if (blockedSlotHelpEl) blockedSlotHelpEl.textContent = text;
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
    } else if (slot.isPast) {
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
    if (!blockedSlotsByDate[dateStr]) blockedSlotsByDate[dateStr] = {};
    if (isCurrentlyBlocked) {
      delete blockedSlotsByDate[dateStr][time24];
      if (Object.keys(blockedSlotsByDate[dateStr]).length === 0) delete blockedSlotsByDate[dateStr];
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
  startHourEl.innerHTML = "";
  endHourEl.innerHTML = "";
  if (lunchStartHourEl) lunchStartHourEl.innerHTML = "<option value=\"\">Hour</option>";
  if (lunchEndHourEl) lunchEndHourEl.innerHTML = "<option value=\"\">Hour</option>";
  for (let i = 1; i <= 12; i += 1) {
    [startHourEl, endHourEl].forEach((select) => {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = String(i);
      select.appendChild(option.cloneNode(true));
    });
    [lunchStartHourEl, lunchEndHourEl].forEach((select) => {
      if (!select) return;
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = String(i);
      select.appendChild(option);
    });
  }
}

function convertTo24Hour(hour, minute, period) {
  let h = parseInt(hour, 10);
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${minute}`;
}

function convertFrom24Hour(time24) {
  if (!time24 || !time24.includes(":")) return { hour: "9", minute: "00", period: "AM" };
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
  if (String(userData.role || "").toLowerCase() !== "doctor") {
    window.location.href = "login.html";
    return false;
  }

  const doctorSnap = await get(ref(db, "doctors/" + user.uid));
  const doctorData = doctorSnap.exists() ? (doctorSnap.val() || {}) : {};
  const doctorDisplayName = String(userData.name || doctorData.name || user.displayName || user.email || "Doctor").trim();
  const clinicName = String(doctorData.clinic || userData.clinic || "").trim();

  if (userInitial) userInitial.textContent = (doctorDisplayName.charAt(0) || "D").toUpperCase();
  if (pageTitle && clinicName) pageTitle.textContent = `${clinicName} Working Hours`;
  if (pageSubtitle) {
    pageSubtitle.textContent = clinicName
      ? `Manage timings and blocked slots for ${clinicName}.`
      : "Manage your available days, timings, slot duration, lunch break, and blocked slots from one place.";
  }

  const availability = doctorData.availability || null;
  blockedSlotsByDate = normalizeBlockedSlots(doctorData.blockedSlots || {});
  if (!availability) {
    doctorAvailability = null;
    workingDayChecks.forEach((checkbox) => { checkbox.checked = false; });
    startHourEl.value = "9";
    startMinuteEl.value = "00";
    startPeriodEl.value = "AM";
    endHourEl.value = "5";
    endMinuteEl.value = "00";
    endPeriodEl.value = "PM";
    slotDurationEl.value = "15";
    if (lunchStartHourEl) lunchStartHourEl.value = "";
    if (lunchStartMinuteEl) lunchStartMinuteEl.value = "";
    if (lunchStartPeriodEl) lunchStartPeriodEl.value = "AM";
    if (lunchEndHourEl) lunchEndHourEl.value = "";
    if (lunchEndMinuteEl) lunchEndMinuteEl.value = "";
    if (lunchEndPeriodEl) lunchEndPeriodEl.value = "AM";
    renderBlockedSlotEditor();
    return true;
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
  startHourEl.value = start.hour;
  startMinuteEl.value = start.minute;
  startPeriodEl.value = start.period;
  endHourEl.value = end.hour;
  endMinuteEl.value = end.minute;
  endPeriodEl.value = end.period;
  slotDurationEl.value = String(doctorAvailability.slotDuration || 15);

  const daySet = new Set((doctorAvailability.days || []).map((day) => Number(day)));
  workingDayChecks.forEach((checkbox) => {
    checkbox.checked = daySet.has(Number(checkbox.value));
  });

  if (doctorAvailability.lunchBreak?.start && lunchStartHourEl) {
    const lunchStart = convertFrom24Hour(doctorAvailability.lunchBreak.start);
    lunchStartHourEl.value = lunchStart.hour;
    if (lunchStartMinuteEl) lunchStartMinuteEl.value = lunchStart.minute;
    if (lunchStartPeriodEl) lunchStartPeriodEl.value = lunchStart.period;
  }

  if (doctorAvailability.lunchBreak?.end && lunchEndHourEl) {
    const lunchEnd = convertFrom24Hour(doctorAvailability.lunchBreak.end);
    lunchEndHourEl.value = lunchEnd.hour;
    if (lunchEndMinuteEl) lunchEndMinuteEl.value = lunchEnd.minute;
    if (lunchEndPeriodEl) lunchEndPeriodEl.value = lunchEnd.period;
  }

  if (blockedSlotDateEl) {
    blockedSlotDateEl.min = today;
    if (!blockedSlotDateEl.value) blockedSlotDateEl.value = getDefaultBlockedSlotDate();
  }

  renderBlockedSlotEditor();
  return true;
}

if (userAvatarBtn) {
  userAvatarBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleUserMenu();
  });
}

if (userMenu) {
  userMenu.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "edit-profile") {
      closeUserMenu();
      window.location.href = "doctor-profile.html";
      return;
    }
    if (action === "logout") {
      closeUserMenu();
      await signOut(auth);
      window.location.href = "login.html";
    }
  });
}

document.addEventListener("click", (event) => {
  if (!userMenu || !userAvatarBtn) return;
  if (!userMenu.contains(event.target) && !userAvatarBtn.contains(event.target)) closeUserMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeUserMenu();
});

if (blockedSlotDateEl) {
  blockedSlotDateEl.min = today;
  blockedSlotDateEl.addEventListener("change", renderBlockedSlotEditor);
}

if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    if (!currentUser) return;
    const selectedDays = [...workingDayChecks].filter((checkbox) => checkbox.checked).map((checkbox) => Number(checkbox.value));
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
      if (!lunchStartHourEl?.value || !lunchStartMinuteEl?.value || !lunchStartPeriodEl?.value || !lunchEndHourEl?.value || !lunchEndMinuteEl?.value || !lunchEndPeriodEl?.value) {
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

    const availability = { days: selectedDays, start, end, slotDuration, maxPerSlot: 1 };
    if (lunchBreak) availability.lunchBreak = lunchBreak;

    try {
      await Promise.all([
        update(ref(db, "doctors/" + currentUser.uid), { availability }),
        update(ref(db, "users/" + currentUser.uid), {
          workingHours: { days: selectedDays, start, end, slotDuration, lunchBreak }
        })
      ]);
      doctorAvailability = { ...availability };
      if (blockedSlotDateEl && !blockedSlotDateEl.value) blockedSlotDateEl.value = getDefaultBlockedSlotDate();
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
  const ok = await loadDoctorHeaderAndAvailability(user);
  if (!ok) return;
  const appointmentsQuery = query(ref(db, "appointments"), orderByChild("doctorUID"), equalTo(user.uid));
  onValue(appointmentsQuery, (snapshot) => {
    allAppointments = snapshot.exists() ? snapshot.val() : {};
    renderBlockedSlotEditor();
  });
});
