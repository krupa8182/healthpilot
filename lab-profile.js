import { auth, db, storage } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, set, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

let form = document.getElementById("labForm");
const userAvatarBtn = document.getElementById("userAvatarBtn");
const userMenu = document.getElementById("userMenu");
const userInitial = document.getElementById("userInitial");
let testsList = document.getElementById("testsList");
let addTestBtn = document.getElementById("addTestBtn");
let startHourSelect = document.getElementById("startHour");
let startMinuteSelect = document.getElementById("startMinute");
let startAmPmSelect = document.getElementById("startAmPm");
let endHourSelect = document.getElementById("endHour");
let endMinuteSelect = document.getElementById("endMinute");
let endAmPmSelect = document.getElementById("endAmPm");
let lunchStartHourSelect = document.getElementById("lunchStartHour");
let lunchStartMinuteSelect = document.getElementById("lunchStartMinute");
let lunchStartAmPmSelect = document.getElementById("lunchStartAmPm");
let lunchEndHourSelect = document.getElementById("lunchEndHour");
let lunchEndMinuteSelect = document.getElementById("lunchEndMinute");
let lunchEndAmPmSelect = document.getElementById("lunchEndAmPm");
const labLicenseInput = document.getElementById("labLicense");
const nablCertInput = document.getElementById("nablCert");
const idProofInput = document.getElementById("idProof");
const labLicenseUrlInput = document.getElementById("labLicenseUrl");
const nablCertUrlInput = document.getElementById("nablCertUrl");
const idProofUrlInput = document.getElementById("idProofUrl");
const TIME_MINUTE_STEPS = ["00", "15", "30", "45"];
const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";
let existingStatus = "pending";
let existingLabData = null;

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
  if (!userMenu.contains(event.target) && !userAvatarBtn.contains(event.target)) {
    closeUserMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeUserMenu();
  }
});

async function uploadFile(file, path) {
  if (!file) return null;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file);
  return await getDownloadURL(fileRef);
}

function refreshDomRefs() {
  if (!form) form = document.getElementById("labForm");
  if (!testsList) testsList = document.getElementById("testsList");
  if (!addTestBtn) addTestBtn = document.getElementById("addTestBtn");
  if (!startHourSelect) startHourSelect = document.getElementById("startHour");
  if (!startMinuteSelect) startMinuteSelect = document.getElementById("startMinute");
  if (!startAmPmSelect) startAmPmSelect = document.getElementById("startAmPm");
  if (!endHourSelect) endHourSelect = document.getElementById("endHour");
  if (!endMinuteSelect) endMinuteSelect = document.getElementById("endMinute");
  if (!endAmPmSelect) endAmPmSelect = document.getElementById("endAmPm");
  if (!lunchStartHourSelect) lunchStartHourSelect = document.getElementById("lunchStartHour");
  if (!lunchStartMinuteSelect) lunchStartMinuteSelect = document.getElementById("lunchStartMinute");
  if (!lunchStartAmPmSelect) lunchStartAmPmSelect = document.getElementById("lunchStartAmPm");
  if (!lunchEndHourSelect) lunchEndHourSelect = document.getElementById("lunchEndHour");
  if (!lunchEndMinuteSelect) lunchEndMinuteSelect = document.getElementById("lunchEndMinute");
  if (!lunchEndAmPmSelect) lunchEndAmPmSelect = document.getElementById("lunchEndAmPm");
}

function addPlaceholder(select, text) {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = text;
  placeholder.selected = true;
  placeholder.disabled = true;
  placeholder.hidden = true;
  select.appendChild(placeholder);
}

function populateTimePickers() {
  refreshDomRefs();
  const hours = Array.from({ length: 12 }, (_, index) => index + 1);
  const hourSelects = [startHourSelect, endHourSelect];
  const minuteSelects = [startMinuteSelect, endMinuteSelect];
  const lunchHourSelects = [lunchStartHourSelect, lunchEndHourSelect];
  const lunchMinuteSelects = [lunchStartMinuteSelect, lunchEndMinuteSelect];

  for (const select of hourSelects) {
    if (!select) continue;
    select.innerHTML = "";
    hours.forEach((hour) => {
      const option = document.createElement("option");
      option.value = String(hour);
      option.textContent = String(hour);
      select.appendChild(option);
    });
  }

  for (const select of minuteSelects) {
    if (!select) continue;
    select.innerHTML = "";
    TIME_MINUTE_STEPS.forEach((minute) => {
      const option = document.createElement("option");
      option.value = minute;
      option.textContent = minute;
      select.appendChild(option);
    });
  }

  for (const select of lunchHourSelects) {
    if (!select) continue;
    select.innerHTML = "";
    addPlaceholder(select, "Hour");
    hours.forEach((hour) => {
      const option = document.createElement("option");
      option.value = String(hour);
      option.textContent = String(hour);
      select.appendChild(option);
    });
  }

  for (const select of lunchMinuteSelects) {
    if (!select) continue;
    select.innerHTML = "";
    addPlaceholder(select, "Minute");
    TIME_MINUTE_STEPS.forEach((minute) => {
      const option = document.createElement("option");
      option.value = minute;
      option.textContent = minute;
      select.appendChild(option);
    });
  }
}

function parse24To12(time24) {
  if (!time24) return { hour: 9, minute: "00", ampm: "AM" };
  const [hourStr, minuteStr] = String(time24).split(":");
  let hour = Number(hourStr);
  const minute = minuteStr?.padStart(2, "0") || "00";
  if (Number.isNaN(hour)) hour = 9;
  const ampm = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
  return { hour: normalizedHour, minute, ampm };
}

function setTimePicker(hourSelect, minuteSelect, ampmSelect, value) {
  if (!hourSelect || !minuteSelect || !ampmSelect) return;
  const { hour, minute, ampm } = parse24To12(value);
  hourSelect.value = String(hour);
  minuteSelect.value = minute;
  ampmSelect.value = ampm;
}

function convertPickerTo24(hourSelect, minuteSelect, ampmSelect) {
  if (!hourSelect || !minuteSelect || !ampmSelect) return null;
  const hourValue = hourSelect.value;
  const minuteValue = minuteSelect.value;
  const ampm = ampmSelect.value;
  if (!hourValue || !minuteValue || !ampm) return null;
  let hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  hour = hour % 12;
  if (ampm === "PM") hour += 12;
  const hourStr = String(hour).padStart(2, "0");
  const minuteStr = String(minute).padStart(2, "0");
  return `${hourStr}:${minuteStr}`;
}

function timeStringToMinutes(value) {
  if (!value) return null;
  const [hourStr, minuteStr] = String(value).split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
}

const dayMap = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

function addTestRow(initial = { name: "", price: "", requirements: "" }) {
  if (!testsList) return null;

  const row = document.createElement("div");
  row.className = "test-row";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "test-name";
  nameInput.placeholder = "Test Name";
  nameInput.required = true;
  nameInput.value = String(initial.name || "").trim();

  const priceInput = document.createElement("input");
  priceInput.type = "number";
  priceInput.className = "test-price";
  priceInput.placeholder = "Price";
  priceInput.required = true;
  priceInput.min = "0";
  priceInput.step = "0.01";
  if (initial.price || initial.price === 0) {
    priceInput.value = String(initial.price);
  }

  const requirementsInput = document.createElement("input");
  requirementsInput.type = "text";
  requirementsInput.className = "test-requirements";
  requirementsInput.placeholder = "Fasting, prior reports, etc.";
  requirementsInput.value = String(initial.requirements || "");

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-test-btn";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!testsList.querySelector(".test-row")) {
      addTestRow();
    }
  });

  row.appendChild(nameInput);
  row.appendChild(priceInput);
  row.appendChild(requirementsInput);
  row.appendChild(removeBtn);
  testsList.appendChild(row);
  return row;
}

function populateTestRows(testMap) {
  if (!testsList) return;
  testsList.innerHTML = "";
  const entries = Object.values(testMap || {});
  if (entries.length === 0) {
    addTestRow();
    return;
  }

  entries.forEach((test) => {
    addTestRow({
      name: test.name || "",
      price: Number.isFinite(test.price) ? test.price : "",
      requirements: String(test.requirements || "")
    });
  });
}

function sanitizeTestKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100) || "";
}

function collectTestsFromRows() {
  if (!testsList) return { ok: false, tests: {}, error: "Tests list is missing." };
  const rows = Array.from(testsList.querySelectorAll(".test-row"));
  const tests = {};

  for (const row of rows) {
    const name = String(row.querySelector(".test-name")?.value || "").trim();
    const priceValue = String(row.querySelector(".test-price")?.value || "").trim();
    const price = Number(priceValue);
    const requirements = String(row.querySelector(".test-requirements")?.value || "").trim();

    if (!name) {
      return { ok: false, tests: {}, error: "Each test must have a name." };
    }

    if (!priceValue || Number.isNaN(price) || price < 0) {
      return { ok: false, tests: {}, error: `Invalid price for "${name}".` };
    }

    const key = sanitizeTestKey(name);
    if (!key) {
      return { ok: false, tests: {}, error: `Invalid test name "${name}".` };
    }
    tests[key] = { name, price, requirements };
  }

  if (Object.keys(tests).length === 0) {
    return { ok: false, tests, error: "Please add at least one test." };
  }

  return { ok: true, tests, error: "" };
}

document.addEventListener("DOMContentLoaded", () => {
  refreshDomRefs();
  populateTimePickers();
  populateTestRows();
  setTimePicker(startHourSelect, startMinuteSelect, startAmPmSelect, DEFAULT_START);
  setTimePicker(endHourSelect, endMinuteSelect, endAmPmSelect, DEFAULT_END);

  if (addTestBtn) {
    addTestBtn.addEventListener("click", () => addTestRow());
  }
});

function normalizeIndianPhone(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]\d{9}$/.test(digits.slice(2))) {
    return `+91${digits.slice(2)}`;
  }
  return null;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  if (userInitial) {
    userInitial.textContent = (user.displayName || user.email || "Lab").charAt(0).toUpperCase();
  }

  refreshDomRefs();
  if (!form) return;

  const userSnap = await get(ref(db, "users/" + user.uid));
  if (!userSnap.exists() || String(userSnap.val().role || "").toLowerCase() !== "lab") {
    window.location.href = "login.html";
    return;
  }

  const existingSnap = await get(ref(db, "labs/" + user.uid));
  if (existingSnap.exists()) {
    const existing = existingSnap.val();
    existingLabData = existing;
    existingStatus = String(existing.status || "pending").toLowerCase();

    if (userInitial) {
      userInitial.textContent = (existing.labName || user.displayName || user.email || "Lab").charAt(0).toUpperCase();
    }

    document.getElementById("labName").value = existing.labName || "";
    document.getElementById("contactName").value = existing.contactName || "";
    document.getElementById("phone").value = existing.phone || "";
    document.getElementById("location").value = existing.location || "";
    populateTestRows(existing.tests);
    setTimePicker(startHourSelect, startMinuteSelect, startAmPmSelect, existing.availability?.start || DEFAULT_START);
    setTimePicker(endHourSelect, endMinuteSelect, endAmPmSelect, existing.availability?.end || DEFAULT_END);
    document.getElementById("slotDuration").value = String(existing.availability?.slotDuration || "15");
    document.getElementById("maxPerSlot").value = String(existing.availability?.maxPerSlot || "2");

    const days = existing.availability?.days || [];
    document.querySelectorAll(".day").forEach((checkbox) => {
      const mapped = dayMap[checkbox.value];
      checkbox.checked = days.includes(mapped);
    });
    if (existing.availability?.lunchBreak?.start) {
      setTimePicker(
        lunchStartHourSelect,
        lunchStartMinuteSelect,
        lunchStartAmPmSelect,
        existing.availability.lunchBreak.start
      );
    }
    if (existing.availability?.lunchBreak?.end) {
      setTimePicker(
        lunchEndHourSelect,
        lunchEndMinuteSelect,
        lunchEndAmPmSelect,
        existing.availability.lunchBreak.end
      );
    }

    if (labLicenseInput && existing.labLicenseUrl) {
      labLicenseInput.required = false;
    }
    if (idProofInput && existing.idProofUrl) {
      idProofInput.required = false;
    }
    if (labLicenseUrlInput) {
      labLicenseUrlInput.value = existing.labLicenseUrl || "";
    }
    if (nablCertUrlInput) {
      nablCertUrlInput.value = existing.nablCertUrl || "";
    }
    if (idProofUrlInput) {
      idProofUrlInput.value = existing.idProofUrl || "";
    }
  } else {
    existingStatus = "pending";
    setTimePicker(startHourSelect, startMinuteSelect, startAmPmSelect, DEFAULT_START);
    setTimePicker(endHourSelect, endMinuteSelect, endAmPmSelect, DEFAULT_END);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const labName = String(document.getElementById("labName").value || "").trim();
    const contactName = String(document.getElementById("contactName").value || "").trim();
    const rawPhone = String(document.getElementById("phone").value || "").trim();
    const location = String(document.getElementById("location").value || "").trim();
    const parsedTests = collectTestsFromRows();

    if (!parsedTests.ok) {
      alert(parsedTests.error);
      return;
    }
    const start = convertPickerTo24(startHourSelect, startMinuteSelect, startAmPmSelect);
    const end = convertPickerTo24(endHourSelect, endMinuteSelect, endAmPmSelect);
    const slotDuration = Number(document.getElementById("slotDuration").value || 15);
    const maxPerSlot = Number(document.getElementById("maxPerSlot").value || 2);

    const selectedDays = [...document.querySelectorAll(".day:checked")]
      .map((checkbox) => dayMap[checkbox.value])
      .filter((value) => value !== undefined);

    if (!labName || !contactName || !rawPhone || !location) {
      alert("Please fill all required fields.");
      return;
    }

    const phone = normalizeIndianPhone(rawPhone);
    if (!phone) {
      alert("Please enter a valid Indian phone number.");
      return;
    }

    if (selectedDays.length === 0) {
      alert("Please select at least one working day.");
      return;
    }

    if (!start || !end) {
      alert("Please set valid working hours.");
      return;
    }

    const startMinutes = timeStringToMinutes(start);
    const endMinutes = timeStringToMinutes(end);
    if (
      startMinutes === null ||
      endMinutes === null ||
      startMinutes >= endMinutes
    ) {
      alert("Please set valid working hours.");
      return;
    }

    if (!Number.isFinite(slotDuration) || slotDuration <= 0 || !Number.isFinite(maxPerSlot) || maxPerSlot <= 0) {
      alert("Invalid slot settings.");
      return;
    }

    const lunchStart = convertPickerTo24(lunchStartHourSelect, lunchStartMinuteSelect, lunchStartAmPmSelect);
    const lunchEnd = convertPickerTo24(lunchEndHourSelect, lunchEndMinuteSelect, lunchEndAmPmSelect);
    let lunchBreak = null;
    if (lunchStart && lunchEnd) {
      const lunchStartMinutes = timeStringToMinutes(lunchStart);
      const lunchEndMinutes = timeStringToMinutes(lunchEnd);
      if (lunchStartMinutes === null || lunchEndMinutes === null || lunchStartMinutes >= lunchEndMinutes) {
        alert("Please set a valid lunch break interval.");
        return;
      }
      lunchBreak = { start: lunchStart, end: lunchEnd };
    }

    const availabilityPayload = {
      days: selectedDays,
      start,
      end,
      slotDuration,
      maxPerSlot
    };
    if (lunchBreak) {
      availabilityPayload.lunchBreak = lunchBreak;
    }

    const nextStatus = existingStatus === "rejected" ? "pending" : (existingStatus || "pending");

    const payload = {
      uid: user.uid,
      labName,
      contactName,
      phone,
      location,
      tests: parsedTests.tests,
      availability: availabilityPayload,
      status: nextStatus,
      updatedAt: Date.now(),
      labLicenseUrl: String(labLicenseUrlInput?.value || "").trim() || existingLabData?.labLicenseUrl || "",
      nablCertUrl: String(nablCertUrlInput?.value || "").trim() || existingLabData?.nablCertUrl || "",
      idProofUrl: String(idProofUrlInput?.value || "").trim() || existingLabData?.idProofUrl || ""
    };

    const labLicenseFile = labLicenseInput ? labLicenseInput.files[0] : null;
    const nablCertFile = nablCertInput ? nablCertInput.files[0] : null;
    const idProofFile = idProofInput ? idProofInput.files[0] : null;

    const hasLabLicense = Boolean(labLicenseFile || payload.labLicenseUrl);
    const hasIdProof = Boolean(idProofFile || payload.idProofUrl);

    if (!hasLabLicense) {
      alert("Please add a Lab License URL or upload the certificate.");
      return;
    }

    if (!hasIdProof) {
      alert("Please add an ID Proof URL or upload the document.");
      return;
    }

    if (labLicenseFile) {
      try {
        payload.labLicenseUrl = await uploadFile(labLicenseFile, `labs/${user.uid}/lab-license-${Date.now()}`);
      } catch (error) {
        if (!payload.labLicenseUrl) throw error;
      }
    }
    if (nablCertFile) {
      try {
        payload.nablCertUrl = await uploadFile(nablCertFile, `labs/${user.uid}/nabl-cert-${Date.now()}`);
      } catch (error) {
        if (!payload.nablCertUrl) throw error;
      }
    }
    if (idProofFile) {
      try {
        payload.idProofUrl = await uploadFile(idProofFile, `labs/${user.uid}/id-proof-${Date.now()}`);
      } catch (error) {
        if (!payload.idProofUrl) throw error;
      }
    }

    const hasBasics =
      Boolean(labName && contactName && phone && location) &&
      parsedTests.ok &&
      Object.keys(parsedTests.tests).length > 0;
    const hasAvailability =
      Array.isArray(availabilityPayload.days) &&
      availabilityPayload.days.length > 0 &&
      Boolean(availabilityPayload.start && availabilityPayload.end);
    const hasRequiredDocs = Boolean(payload.labLicenseUrl && payload.idProofUrl);
    payload.profileComplete = Boolean(hasBasics && hasAvailability && hasRequiredDocs);
    payload.rejectionMessage = nextStatus === "rejected" ? (existingLabData?.rejectionMessage || "") : null;
    payload.rejectedAt = nextStatus === "rejected" ? (existingLabData?.rejectedAt || null) : null;
    payload.reviewedBy = nextStatus === "rejected" ? (existingLabData?.reviewedBy || null) : null;
    if (existingStatus === "rejected") {
      payload.rejectionMessage = null;
      payload.rejectedAt = null;
      payload.reviewedBy = null;
      payload.resubmittedAt = payload.updatedAt;
    }

    try {
      await Promise.all([
        set(ref(db, "labs/" + user.uid), payload),
        update(ref(db, "users/" + user.uid), {
          status: payload.status,
          rejectionMessage: payload.rejectionMessage,
          rejectedAt: payload.rejectedAt,
          updatedAt: payload.updatedAt
        })
      ]);
      alert("Lab profile saved.");
      window.location.href = "lab-dashboard.html";
    } catch (error) {
      console.error(error);
      alert("Unable to save lab profile.");
    }
  });
});
