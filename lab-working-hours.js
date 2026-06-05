import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, onValue, update, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

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
const maxPerSlotEl = document.getElementById("maxPerSlot");
const saveBtn = document.getElementById("saveWorkingHours");
const workingDayChecks = document.querySelectorAll(".working-day");
const blockedSlotDateEl = document.getElementById("blockedSlotDate");
const blockedSlotHelpEl = document.getElementById("blockedSlotHelp");
const labBlockedSlotList = document.getElementById("labBlockedSlotList");

const today = new Date().toISOString().split("T")[0];

let currentUser = null;
let labProfile = null;
let blockedSlotsByDate = {};
let allBookings = {};

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

function normalizeBlockedSlots(rawBlockedSlots = {}) {
  const normalized = {};
  Object.entries(rawBlockedSlots || {}).forEach(([dateKey, slots]) => {
    if (!slots || typeof slots !== "object") return;
    const active = {};
    Object.entries(slots).forEach(([timeKey, value]) => {
      if (value) active[timeKey] = value;
    });
    if (Object.keys(active).length > 0) normalized[dateKey] = active;
  });
  return normalized;
}

function parseWorkingDays(days = []) {
  return days.map((value) => Number(value)).filter((value) => Number.isFinite(value));
}

function timeStringToMinutes(value) {
  if (!value && value !== 0) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return (hour * 60) + minute;
}

function formatTimeTo12Hour(hours, minutes) {
  const period = hours >= 12 ? "PM" : "AM";
  let hour = hours % 12;
  if (hour === 0) hour = 12;
  return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatMinutesToLabel(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return "";
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return formatTimeTo12Hour(hour, minute);
}

function convertTo24Hour(hour, minute, period) {
  let normalizedHour = parseInt(hour, 10);
  if (period === "PM" && normalizedHour !== 12) normalizedHour += 12;
  if (period === "AM" && normalizedHour === 12) normalizedHour = 0;
  return `${String(normalizedHour).padStart(2, "0")}:${minute}`;
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

function populateHours() {
  startHourEl.innerHTML = "";
  endHourEl.innerHTML = "";
  if (lunchStartHourEl) lunchStartHourEl.innerHTML = "<option value=\"\">Hour</option>";
  if (lunchEndHourEl) lunchEndHourEl.innerHTML = "<option value=\"\">Hour</option>";

  for (let hour = 1; hour <= 12; hour += 1) {
    [startHourEl, endHourEl].forEach((select) => {
      const option = document.createElement("option");
      option.value = String(hour);
      option.textContent = String(hour);
      select.appendChild(option.cloneNode(true));
    });

    [lunchStartHourEl, lunchEndHourEl].forEach((select) => {
      if (!select) return;
      const option = document.createElement("option");
      option.value = String(hour);
      option.textContent = String(hour);
      select.appendChild(option);
    });
  }
}

function shouldCountBooking(booking) {
  const status = String(booking?.status || "").toLowerCase();
  if (status !== "approved" && status !== "pending") return false;

  const paymentStatus = String(booking?.payment?.status || "").toLowerCase();
  const paymentMethod = String(booking?.payment?.method || booking?.payment?.preference || "").toLowerCase();
  const isOnline = paymentMethod === "online" || Boolean(booking?.payment?.payment_id) || Boolean(booking?.payment?.provider);
  if (isOnline && (paymentStatus === "failed" || paymentStatus === "cancelled")) {
    return false;
  }

  return true;
}

function buildBookedSlotsByDate() {
  const nextBooked = {};
  Object.values(allBookings || {}).forEach((booking) => {
    if (String(booking?.labUID || "") !== String(currentUser?.uid || "")) return;
    if (!shouldCountBooking(booking)) return;

    const date = String(booking?.date || "").trim();
    const time = String(booking?.time || "").trim();
    if (!date || !time) return;

    if (!nextBooked[date]) nextBooked[date] = {};
    nextBooked[date][time] = Number(nextBooked[date][time] || 0) + 1;
  });
  return nextBooked;
}

function getLabDateMeta(dateStr) {
  const availability = labProfile?.availability;
  if (!availability || !dateStr) return { isWorkingDay: false, slots: [] };

  const workingDays = parseWorkingDays(availability.days || []);
  const selectedDay = new Date(dateStr).getDay();
  if (!workingDays.includes(selectedDay)) return { isWorkingDay: false, slots: [] };

  const startMinutes = timeStringToMinutes(availability.start || "09:00");
  const endMinutes = timeStringToMinutes(availability.end || "17:00");
  const duration = Number(availability.slotDuration || 15);
  const capacity = Number(availability.maxPerSlot || 1);
  const lunchBreak = availability.lunchBreak || null;
  const lunchStartMinutes = lunchBreak ? timeStringToMinutes(lunchBreak.start) : null;
  const lunchEndMinutes = lunchBreak ? timeStringToMinutes(lunchBreak.end) : null;

  if (
    startMinutes === null ||
    endMinutes === null ||
    duration <= 0 ||
    capacity <= 0 ||
    startMinutes >= endMinutes
  ) {
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

    const hour = Math.floor(currentMinutes / 60);
    const minute = currentMinutes % 60;
    const time24 = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const slotDateTime = new Date(`${dateStr}T${time24}:00`);
    const bookingCount = Number(bookedSlots[time24] || 0);

    slots.push({
      type: "slot",
      value24: time24,
      label12: formatTimeTo12Hour(hour, minute),
      isPast: slotDateTime <= now,
      bookingCount,
      capacity,
      isFull: bookingCount >= capacity,
      isBlocked: Boolean(blockedSlots[time24])
    });
    currentMinutes += duration;
  }

  return { isWorkingDay: true, slots };
}

function getDefaultBlockedSlotDate() {
  const todayMeta = getLabDateMeta(today);
  if (todayMeta.isWorkingDay) return today;
  for (let offset = 1; offset <= 30; offset += 1) {
    const nextDate = new Date(today);
    nextDate.setDate(nextDate.getDate() + offset);
    const nextDateStr = nextDate.toISOString().split("T")[0];
    if (getLabDateMeta(nextDateStr).isWorkingDay) return nextDateStr;
  }
  return today;
}

function updateBlockedSlotHelp(text) {
  if (blockedSlotHelpEl) blockedSlotHelpEl.textContent = text;
}

function renderBlockedSlotEditor() {
  if (!labBlockedSlotList) return;

  if (!labProfile?.availability) {
    labBlockedSlotList.innerHTML = "<p>Save your working hours first to manage blocked slots.</p>";
    updateBlockedSlotHelp("Booked or full slots stay locked. Open slots can be blocked or reopened anytime.");
    return;
  }

  const selectedDate = blockedSlotDateEl?.value || "";
  if (!selectedDate) {
    labBlockedSlotList.innerHTML = "<p>Select a date to manage your live slots.</p>";
    return;
  }

  const { isWorkingDay, slots } = getLabDateMeta(selectedDate);
  labBlockedSlotList.innerHTML = "";

  if (!isWorkingDay) {
    labBlockedSlotList.innerHTML = "<p>Your lab is not scheduled to operate on this date.</p>";
    updateBlockedSlotHelp("Choose a configured working day to block or reopen specific slots.");
    return;
  }

  const activeSlots = slots.filter((slot) => slot.type === "slot");
  const blockedCount = activeSlots.filter((slot) => slot.isBlocked).length;
  const fullCount = activeSlots.filter((slot) => slot.isFull).length;
  const openCount = activeSlots.filter((slot) => !slot.isPast && !slot.isFull && !slot.isBlocked).length;
  const pastCount = activeSlots.filter((slot) => slot.isPast).length;
  updateBlockedSlotHelp(`Open: ${openCount} | Blocked: ${blockedCount} | Full: ${fullCount} | Past: ${pastCount}`);

  slots.forEach((slot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slot-btn";

    if (slot.type === "break") {
      button.textContent = slot.label12;
      button.disabled = true;
      button.classList.add("slot-break");
      labBlockedSlotList.appendChild(button);
      return;
    }

    const bookedText = slot.bookingCount > 0 ? ` ${slot.bookingCount}/${slot.capacity} booked` : "";
    if (slot.isPast) {
      button.textContent = `${slot.label12} (Past)`;
      button.disabled = true;
      button.classList.add("slot-disabled-doctor");
    } else if (slot.isFull) {
      button.textContent = `${slot.label12} (Full ${slot.bookingCount}/${slot.capacity})`;
      button.disabled = true;
      button.classList.add("slot-full");
    } else if (slot.isBlocked) {
      button.textContent = `${slot.label12} (Blocked${bookedText})`;
      button.classList.add("slot-blocked-live");
      button.addEventListener("click", () => toggleBlockedSlot(selectedDate, slot.value24, true));
    } else {
      button.textContent = `${slot.label12} (${slot.bookingCount > 0 ? `Booked ${slot.bookingCount}/${slot.capacity}` : "Available"})`;
      button.classList.add("slot-open-live");
      button.addEventListener("click", () => toggleBlockedSlot(selectedDate, slot.value24, false));
    }

    labBlockedSlotList.appendChild(button);
  });
}

async function toggleBlockedSlot(dateStr, time24, isCurrentlyBlocked) {
  if (!currentUser?.uid) return;
  const patch = {};
  patch[`labs/${currentUser.uid}/blockedSlots/${dateStr}/${time24}`] = isCurrentlyBlocked ? null : true;

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

function hasBasicDetails(profile) {
  return Boolean(
    String(profile?.labName || "").trim() &&
    String(profile?.contactName || "").trim() &&
    String(profile?.phone || "").trim() &&
    String(profile?.location || "").trim()
  );
}

function hasRequiredDocs(profile) {
  return Boolean(String(profile?.labLicenseUrl || "").trim() && String(profile?.idProofUrl || "").trim());
}

function hasTests(profile) {
  return Boolean(profile?.tests && Object.keys(profile.tests).length > 0);
}

function computeProfileComplete(profile, nextAvailability) {
  return Boolean(
    hasBasicDetails(profile) &&
    hasRequiredDocs(profile) &&
    hasTests(profile) &&
    Array.isArray(nextAvailability?.days) &&
    nextAvailability.days.length > 0 &&
    nextAvailability.start &&
    nextAvailability.end
  );
}

async function loadLabHeaderAndAvailability(user) {
  const userSnap = await get(ref(db, `users/${user.uid}`));
  const userData = userSnap.exists() ? (userSnap.val() || {}) : {};
  if (String(userData.role || "").toLowerCase() !== "lab") {
    window.location.href = "login.html";
    return false;
  }

  const labSnap = await get(ref(db, `labs/${user.uid}`));
  labProfile = labSnap.exists() ? (labSnap.val() || {}) : {};
  const labName = String(labProfile.labName || userData.name || user.displayName || user.email || "Lab").trim();

  if (userInitial) userInitial.textContent = (labName.charAt(0) || "L").toUpperCase();
  if (pageTitle) pageTitle.textContent = labProfile.labName ? `${labProfile.labName} Working Hours` : "Edit Working Hours";
  if (pageSubtitle && labProfile.labName) {
    pageSubtitle.textContent = `Manage timings, slot capacity, and blocked lab slots for ${labProfile.labName}.`;
  }

  blockedSlotsByDate = normalizeBlockedSlots(labProfile.blockedSlots || {});
  const availability = labProfile.availability || null;

  if (!availability) {
    workingDayChecks.forEach((checkbox) => { checkbox.checked = false; });
    startHourEl.value = "9";
    startMinuteEl.value = "00";
    startPeriodEl.value = "AM";
    endHourEl.value = "6";
    endMinuteEl.value = "00";
    endPeriodEl.value = "PM";
    slotDurationEl.value = "15";
    if (maxPerSlotEl) maxPerSlotEl.value = "2";
    if (lunchStartHourEl) lunchStartHourEl.value = "";
    if (lunchStartMinuteEl) lunchStartMinuteEl.value = "";
    if (lunchStartPeriodEl) lunchStartPeriodEl.value = "AM";
    if (lunchEndHourEl) lunchEndHourEl.value = "";
    if (lunchEndMinuteEl) lunchEndMinuteEl.value = "";
    if (lunchEndPeriodEl) lunchEndPeriodEl.value = "AM";
    renderBlockedSlotEditor();
    return true;
  }

  const start = convertFrom24Hour(availability.start);
  const end = convertFrom24Hour(availability.end);
  startHourEl.value = start.hour;
  startMinuteEl.value = start.minute;
  startPeriodEl.value = start.period;
  endHourEl.value = end.hour;
  endMinuteEl.value = end.minute;
  endPeriodEl.value = end.period;
  slotDurationEl.value = String(availability.slotDuration || 15);
  if (maxPerSlotEl) maxPerSlotEl.value = String(availability.maxPerSlot || 2);

  const daySet = new Set(parseWorkingDays(availability.days || []));
  workingDayChecks.forEach((checkbox) => {
    checkbox.checked = daySet.has(Number(checkbox.value));
  });

  if (availability.lunchBreak?.start && lunchStartHourEl) {
    const lunchStart = convertFrom24Hour(availability.lunchBreak.start);
    lunchStartHourEl.value = lunchStart.hour;
    if (lunchStartMinuteEl) lunchStartMinuteEl.value = lunchStart.minute;
    if (lunchStartPeriodEl) lunchStartPeriodEl.value = lunchStart.period;
  }

  if (availability.lunchBreak?.end && lunchEndHourEl) {
    const lunchEnd = convertFrom24Hour(availability.lunchBreak.end);
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
      window.location.href = "lab-profile.html";
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
    const maxPerSlot = parseInt(maxPerSlotEl.value, 10);

    if (start >= end) {
      alert("End time must be after start time.");
      return;
    }

    if (!Number.isFinite(slotDuration) || slotDuration <= 0 || !Number.isFinite(maxPerSlot) || maxPerSlot <= 0) {
      alert("Please enter valid slot settings.");
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
      maxPerSlot
    };
    if (lunchBreak) availability.lunchBreak = lunchBreak;

    const nextProfileComplete = computeProfileComplete(labProfile, availability);

    try {
      await update(ref(db, `labs/${currentUser.uid}`), {
        availability,
        updatedAt: Date.now(),
        profileComplete: nextProfileComplete
      });
      labProfile = {
        ...(labProfile || {}),
        availability,
        updatedAt: Date.now(),
        profileComplete: nextProfileComplete
      };
      if (blockedSlotDateEl && !blockedSlotDateEl.value) {
        blockedSlotDateEl.value = getDefaultBlockedSlotDate();
      }
      renderBlockedSlotEditor();
      alert("Working hours saved successfully.");
    } catch (error) {
      console.error(error);
      alert("Unable to save working hours.");
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
  const ok = await loadLabHeaderAndAvailability(user);
  if (!ok) return;

  const labBookingsQuery = query(ref(db, "labBookings"), orderByChild("labUID"), equalTo(user.uid));
  onValue(labBookingsQuery, (snapshot) => {
    allBookings = snapshot.exists() ? snapshot.val() : {};
    renderBlockedSlotEditor();
  });
});
