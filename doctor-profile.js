import { auth, db, storage } from "./firebase-client.js";
import { onAuthStateChanged, signOut, updateEmail, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, set, get, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const form = document.getElementById("doctorForm");
const userAvatarBtn = document.getElementById("userAvatarBtn");
const userMenu = document.getElementById("userMenu");
const userInitial = document.getElementById("userInitial");
const toggleWorkingHoursBtn = document.getElementById("toggleWorkingHoursBtn");
const workingHoursSection = document.getElementById("workingHoursSection");
const emailInput = document.getElementById("email");
const specializationSelect = document.getElementById("specialization");
const specializationOtherInput = document.getElementById("specializationOther");
const imageInput = document.getElementById("image");
const photoFileInput = document.getElementById("photoFile");
const photoPreview = document.getElementById("photoPreview");
const photoPreviewWrap = document.getElementById("photoPreviewWrap");
const removePhotoBtn = document.getElementById("removePhotoBtn");
const profileStatus = document.getElementById("profileStatus");
const medicalLicenseInput = document.getElementById("medicalLicense");
const medicalLicenseName = document.getElementById("medicalLicenseName");
const medicalLicenseUrlInput = document.getElementById("medicalLicenseUrl");
const specializationCertInput = document.getElementById("specializationCert");
const specializationCertName = document.getElementById("specializationCertName");
const specializationCertUrlInput = document.getElementById("specializationCertUrl");
const idProofInput = document.getElementById("idProof");
const idProofName = document.getElementById("idProofName");
const idProofUrlInput = document.getElementById("idProofUrl");
const startHourSelect = document.getElementById("startHour");
const startMinuteSelect = document.getElementById("startMinute");
const startAmPmSelect = document.getElementById("startAmPm");
const endHourSelect = document.getElementById("endHour");
const endMinuteSelect = document.getElementById("endMinute");
const endAmPmSelect = document.getElementById("endAmPm");
const lunchStartHourSelect = document.getElementById("lunchStartHour");
const lunchStartMinuteSelect = document.getElementById("lunchStartMinute");
const lunchStartAmPmSelect = document.getElementById("lunchStartAmPm");
const lunchEndHourSelect = document.getElementById("lunchEndHour");
const lunchEndMinuteSelect = document.getElementById("lunchEndMinute");
const lunchEndAmPmSelect = document.getElementById("lunchEndAmPm");
const photoHelpText = document.getElementById("photoHelpText");

const TIME_MINUTE_STEPS = ["00", "15", "30", "45"];
const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let existingStatus = "pending";
let existingDoctorData = null;

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

function setProfileStatus(message, type = "") {
  if (!profileStatus) return;
  profileStatus.textContent = message || "";
  profileStatus.classList.remove("error", "success");
  if (type) {
    profileStatus.classList.add(type);
  }
}

const DRAFT_KEY = "doctorProfileDraft";

function collectDraft() {
  const days = [];
  document.querySelectorAll(".day:checked").forEach((checkbox) => {
    days.push(String(checkbox.value));
  });

  return {
    image: imageInput ? imageInput.value : "",
    name: document.getElementById("name")?.value || "",
    email: emailInput?.value || "",
    specialization: specializationSelect ? specializationSelect.value : "",
    specializationOther: specializationOtherInput ? specializationOtherInput.value : "",
    clinic: document.getElementById("clinic")?.value || "",
    experience: document.getElementById("experience")?.value || "",
    fee: document.getElementById("fee")?.value || "",
    location: document.getElementById("location")?.value || "",
    days,
    startHour: startHourSelect?.value || "",
    startMinute: startMinuteSelect?.value || "",
    startAmPm: startAmPmSelect?.value || "",
    endHour: endHourSelect?.value || "",
    endMinute: endMinuteSelect?.value || "",
    endAmPm: endAmPmSelect?.value || "",
    lunchStartHour: lunchStartHourSelect?.value || "",
    lunchStartMinute: lunchStartMinuteSelect?.value || "",
    lunchStartAmPm: lunchStartAmPmSelect?.value || "",
    lunchEndHour: lunchEndHourSelect?.value || "",
    lunchEndMinute: lunchEndMinuteSelect?.value || "",
    lunchEndAmPm: lunchEndAmPmSelect?.value || "",
    slotDuration: document.getElementById("slotDuration")?.value || ""
  };
}

function saveDraft() {
  try {
    const draft = collectDraft();
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // ignore storage errors
  }
}

function applyDraft() {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== "object") return false;

    if (imageInput && draft.image) {
      imageInput.value = draft.image;
      setPhotoPreview(draft.image);
    }
    const nameInput = document.getElementById("name");
    if (nameInput && draft.name) nameInput.value = draft.name;
    if (emailInput && draft.email) emailInput.value = draft.email;
    if (specializationSelect && draft.specialization) {
      specializationSelect.value = draft.specialization;
      syncSpecializationOther();
    }
    if (specializationOtherInput && draft.specializationOther) {
      specializationOtherInput.value = draft.specializationOther;
    }
    const clinicInput = document.getElementById("clinic");
    if (clinicInput && draft.clinic) clinicInput.value = draft.clinic;
    const expInput = document.getElementById("experience");
    if (expInput && draft.experience) expInput.value = draft.experience;
    const feeInput = document.getElementById("fee");
    if (feeInput && draft.fee) feeInput.value = draft.fee;
    const locationInput = document.getElementById("location");
    if (locationInput && draft.location) locationInput.value = draft.location;

    if (Array.isArray(draft.days)) {
      document.querySelectorAll(".day").forEach((checkbox) => {
        checkbox.checked = draft.days.includes(String(checkbox.value));
      });
    }

    if (startHourSelect && draft.startHour) startHourSelect.value = draft.startHour;
    if (startMinuteSelect && draft.startMinute) startMinuteSelect.value = draft.startMinute;
    if (startAmPmSelect && draft.startAmPm) startAmPmSelect.value = draft.startAmPm;
    if (endHourSelect && draft.endHour) endHourSelect.value = draft.endHour;
    if (endMinuteSelect && draft.endMinute) endMinuteSelect.value = draft.endMinute;
    if (endAmPmSelect && draft.endAmPm) endAmPmSelect.value = draft.endAmPm;

    if (lunchStartHourSelect && draft.lunchStartHour) lunchStartHourSelect.value = draft.lunchStartHour;
    if (lunchStartMinuteSelect && draft.lunchStartMinute) lunchStartMinuteSelect.value = draft.lunchStartMinute;
    if (lunchStartAmPmSelect && draft.lunchStartAmPm) lunchStartAmPmSelect.value = draft.lunchStartAmPm;
    if (lunchEndHourSelect && draft.lunchEndHour) lunchEndHourSelect.value = draft.lunchEndHour;
    if (lunchEndMinuteSelect && draft.lunchEndMinute) lunchEndMinuteSelect.value = draft.lunchEndMinute;
    if (lunchEndAmPmSelect && draft.lunchEndAmPm) lunchEndAmPmSelect.value = draft.lunchEndAmPm;

    const slotDurationSelect = document.getElementById("slotDuration");
    if (slotDurationSelect && draft.slotDuration) slotDurationSelect.value = draft.slotDuration;

    return true;
  } catch {
    return false;
  }
}

const SPECIALIZATION_OPTIONS = [
  "General Physician",
  "Cardiologist",
  "Dermatologist",
  "ENT Specialist",
  "Gynecologist",
  "Pediatrician",
  "Orthopedic",
  "Neurologist",
  "Psychiatrist",
  "Dentist",
  "Ophthalmologist",
  "Radiologist"
];

const dayMap = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out. Please try again.`)), ms)
    )
  ]);
}

async function uploadFile(file, path, label) {
  if (!file) return null;
  const fileRef = storageRef(storage, path);
  await withTimeout(uploadBytes(fileRef, file), 20000, `${label} upload`);
  return await withTimeout(getDownloadURL(fileRef), 10000, `${label} URL`);
}

function addPlaceholder(select, text) {
  if (!select) return;
  const option = document.createElement("option");
  option.value = "";
  option.textContent = text;
  option.selected = true;
  option.disabled = true;
  select.appendChild(option);
}

function populateTimePickers() {
  const hours = Array.from({ length: 12 }, (_, index) => index + 1);
  const hourSelects = [startHourSelect, endHourSelect];
  const minuteSelects = [startMinuteSelect, endMinuteSelect];
  const lunchHourSelects = [lunchStartHourSelect, lunchEndHourSelect];
  const lunchMinuteSelects = [lunchStartMinuteSelect, lunchEndMinuteSelect];

  hourSelects.forEach((select) => {
    if (!select) return;
    select.innerHTML = "";
    hours.forEach((hour) => {
      const option = document.createElement("option");
      option.value = String(hour);
      option.textContent = String(hour);
      select.appendChild(option);
    });
  });

  minuteSelects.forEach((select) => {
    if (!select) return;
    select.innerHTML = "";
    TIME_MINUTE_STEPS.forEach((minute) => {
      const option = document.createElement("option");
      option.value = minute;
      option.textContent = minute;
      select.appendChild(option);
    });
  });

  lunchHourSelects.forEach((select) => {
    if (!select) return;
    select.innerHTML = "";
    addPlaceholder(select, "Hour");
    hours.forEach((hour) => {
      const option = document.createElement("option");
      option.value = String(hour);
      option.textContent = String(hour);
      select.appendChild(option);
    });
  });

  lunchMinuteSelects.forEach((select) => {
    if (!select) return;
    select.innerHTML = "";
    addPlaceholder(select, "Minute");
    TIME_MINUTE_STEPS.forEach((minute) => {
      const option = document.createElement("option");
      option.value = minute;
      option.textContent = minute;
      select.appendChild(option);
    });
  });
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

const ensureWorkingHoursPopulated = () => {
  document.addEventListener("DOMContentLoaded", () => {
    populateTimePickers();
    setTimePicker(startHourSelect, startMinuteSelect, startAmPmSelect, DEFAULT_START);
    setTimePicker(endHourSelect, endMinuteSelect, endAmPmSelect, DEFAULT_END);
  });
};

ensureWorkingHoursPopulated();

function bindFileInput(fileInput, nameInput, fallbackText) {
  if (!fileInput || !nameInput) return;
  nameInput.value = fallbackText || "No file chosen";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    nameInput.value = file ? file.name : (fallbackText || "No file chosen");
  });
}

bindFileInput(medicalLicenseInput, medicalLicenseName, "No file chosen");
bindFileInput(specializationCertInput, specializationCertName, "No file chosen");
bindFileInput(idProofInput, idProofName, "No file chosen");

if (medicalLicenseUrlInput) {
  medicalLicenseUrlInput.addEventListener("input", saveDraft);
}
if (specializationCertUrlInput) {
  specializationCertUrlInput.addEventListener("input", saveDraft);
}
if (idProofUrlInput) {
  idProofUrlInput.addEventListener("input", saveDraft);
}

function syncSpecializationOther() {
  if (!specializationSelect || !specializationOtherInput) return;
  const value = String(specializationSelect.value || "");
  const showOther = value === "Other";
  specializationOtherInput.classList.toggle("is-hidden", !showOther);
  specializationOtherInput.required = showOther;
  if (!showOther) {
    specializationOtherInput.value = "";
  }
}

if (specializationSelect) {
  specializationSelect.addEventListener("change", syncSpecializationOther);
  syncSpecializationOther();
}

if (form) {
  form.addEventListener("input", saveDraft);
  form.addEventListener("change", saveDraft);
}

function setPhotoPreview(url) {
  if (!photoPreview) return;
  if (!url) {
    if (photoPreviewWrap) photoPreviewWrap.classList.add("is-hidden");
    photoPreview.src = "";
    if (photoHelpText) photoHelpText.classList.remove("is-hidden");
    return;
  }
  photoPreview.src = url;
  if (photoPreviewWrap) photoPreviewWrap.classList.remove("is-hidden");
  if (photoHelpText) photoHelpText.classList.add("is-hidden");
}

if (photoFileInput) {
  photoFileInput.addEventListener("change", () => {
    const file = photoFileInput.files && photoFileInput.files[0];
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      setPhotoPreview(previewUrl);
    } else {
      setPhotoPreview(imageInput ? imageInput.value.trim() : "");
    }
    saveDraft();
  });
}

if (removePhotoBtn) {
  removePhotoBtn.addEventListener("click", () => {
    if (photoFileInput) {
      photoFileInput.value = "";
    }
    if (imageInput) {
      imageInput.value = "";
    }
    setPhotoPreview("");
    saveDraft();
  });
}

if (imageInput) {
  imageInput.addEventListener("input", () => {
    if (photoFileInput && photoFileInput.files && photoFileInput.files.length > 0) return;
    setPhotoPreview(imageInput.value.trim());
    saveDraft();
  });
}
if (toggleWorkingHoursBtn && workingHoursSection) {
  toggleWorkingHoursBtn.addEventListener("click", () => {
    const isHidden = workingHoursSection.classList.contains("is-hidden");
    workingHoursSection.classList.toggle("is-hidden");
    toggleWorkingHoursBtn.textContent = isHidden ? "Hide Working Hours" : "Set Working Hours";
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  if (userInitial) {
    userInitial.textContent = (user.displayName || user.email || "Doctor").charAt(0).toUpperCase();
  }

  setProfileStatus("Ready to save your profile.");

  const userSnap = await get(ref(db, "users/" + user.uid));
  const userData = userSnap.exists() ? (userSnap.val() || {}) : {};
  const existingSnap = await get(ref(db, "doctors/" + user.uid));
  if (existingSnap.exists()) {
    const existing = existingSnap.val();
    existingDoctorData = existing;
    existingStatus = String(existing.status || "pending").toLowerCase();

    if (imageInput) {
      imageInput.value = existing.image || "";
    }
    setPhotoPreview(existing.image || "");
    document.getElementById("name").value = existing.name || "";
    if (emailInput) {
      emailInput.value = String(existing.email || userData.email || user.email || "").trim().toLowerCase();
    }
    if (userInitial) {
      userInitial.textContent = (existing.name || user.displayName || user.email || "Doctor").charAt(0).toUpperCase();
    }
    if (specializationSelect) {
      const existingSpec = String(existing.specialization || "").trim();
      if (SPECIALIZATION_OPTIONS.includes(existingSpec)) {
        specializationSelect.value = existingSpec;
        if (specializationOtherInput) {
          specializationOtherInput.value = "";
        }
      } else if (existingSpec) {
        specializationSelect.value = "Other";
        if (specializationOtherInput) {
          specializationOtherInput.value = existingSpec;
        }
      }
      syncSpecializationOther();
    }
    document.getElementById("clinic").value = existing.clinic || "";
    document.getElementById("experience").value = existing.experience || "";
    document.getElementById("fee").value = existing.fee || "";
    document.getElementById("location").value = existing.location || "";

    const storedDays = (existing.availability?.days || []).map((d) => {
      if (typeof d === "number") {
        return Object.keys(dayMap).find((key) => dayMap[key] === d);
      }
      return d;
    });

    document.querySelectorAll(".day").forEach((checkbox) => {
      checkbox.checked = storedDays.includes(checkbox.value);
    });

    setTimePicker(
      startHourSelect,
      startMinuteSelect,
      startAmPmSelect,
      existing.availability?.start || DEFAULT_START
    );
    setTimePicker(
      endHourSelect,
      endMinuteSelect,
      endAmPmSelect,
      existing.availability?.end || DEFAULT_END
    );

    document.getElementById("slotDuration").value = String(existing.availability?.slotDuration || "15");

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

    if (medicalLicenseName) {
      const hasDoc = Boolean(existing.medicalLicenseUrl);
      medicalLicenseName.value = hasDoc ? "Uploaded" : "No file chosen";
      if (medicalLicenseInput && hasDoc) medicalLicenseInput.required = false;
    }
    if (medicalLicenseUrlInput) {
      medicalLicenseUrlInput.value = existing.medicalLicenseUrl || "";
    }
    if (specializationCertName) {
      const hasDoc = Boolean(existing.specializationCertUrl);
      specializationCertName.value = hasDoc ? "Uploaded" : "No file chosen";
    }
    if (specializationCertUrlInput) {
      specializationCertUrlInput.value = existing.specializationCertUrl || "";
    }
    if (idProofName) {
      const hasDoc = Boolean(existing.idProofUrl);
      idProofName.value = hasDoc ? "Uploaded" : "No file chosen";
      if (idProofInput && hasDoc) idProofInput.required = false;
    }
    if (idProofUrlInput) {
      idProofUrlInput.value = existing.idProofUrl || "";
    }
  } else {
    if (emailInput) {
      emailInput.value = String(userData.email || user.email || "").trim().toLowerCase();
    }
    applyDraft();
    existingStatus = "pending";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    setProfileStatus("Saving profile...", "");

    try {
      const medicalLicenseFile = medicalLicenseInput ? medicalLicenseInput.files[0] : null;
      const idProofFile = idProofInput ? idProofInput.files[0] : null;
      const medicalLicenseUrl = String(medicalLicenseUrlInput?.value || "").trim();
      const idProofUrl = String(idProofUrlInput?.value || "").trim();
      const hasMedicalLicense = Boolean(medicalLicenseFile || medicalLicenseUrl || existingDoctorData?.medicalLicenseUrl);
      const hasIdProof = Boolean(idProofFile || idProofUrl || existingDoctorData?.idProofUrl);

      if (!hasMedicalLicense) {
        alert("Please upload your medical license document.");
        setProfileStatus("Medical license is required.", "error");
        return;
      }

      if (!hasIdProof) {
        alert("Please upload your government ID proof.");
        setProfileStatus("Government ID proof is required.", "error");
        return;
      }

      if (!form.checkValidity()) {
        form.reportValidity();
        setProfileStatus("Please fill all required fields.", "error");
        return;
      }

      const nextEmail = String(emailInput?.value || user.email || "").trim().toLowerCase();
      if (!EMAIL_REGEX.test(nextEmail)) {
        setProfileStatus("Please enter a valid email address.", "error");
        alert("Please enter a valid email address.");
        return;
      }

      const days = [];
      document.querySelectorAll(".day:checked").forEach((checkbox) => {
        days.push(dayMap[checkbox.value]);
      });

      if (days.length === 0) {
        alert("Please select at least one working day from Set Working Hours.");
        setProfileStatus("Select at least one working day.", "error");
        return;
      }

      const start = convertPickerTo24(startHourSelect, startMinuteSelect, startAmPmSelect);
      const end = convertPickerTo24(endHourSelect, endMinuteSelect, endAmPmSelect);
      const slotDuration = parseInt(document.getElementById("slotDuration").value, 10);

      if (!start || !end) {
        alert("Please set valid start and end times in Set Working Hours.");
        setProfileStatus("Working hours are required.", "error");
        return;
      }

      if (start >= end) {
        alert("Start time must be before end time.");
        setProfileStatus("Start time must be before end time.", "error");
        return;
      }

      const lunchStart = convertPickerTo24(lunchStartHourSelect, lunchStartMinuteSelect, lunchStartAmPmSelect);
      const lunchEnd = convertPickerTo24(lunchEndHourSelect, lunchEndMinuteSelect, lunchEndAmPmSelect);
      let lunchBreak = null;
      if (lunchStart || lunchEnd) {
        if (!lunchStart || !lunchEnd) {
          alert("Please provide both lunch start and end times, or leave them blank.");
          setProfileStatus("Complete lunch break times or leave them blank.", "error");
          return;
        }
        if (lunchStart >= lunchEnd) {
          alert("Lunch start must be earlier than lunch end.");
          setProfileStatus("Lunch start must be earlier than lunch end.", "error");
          return;
        }
        lunchBreak = { start: lunchStart, end: lunchEnd };
      }

      const availability = {
        days,
        start,
        end,
        slotDuration: slotDuration || 15,
        maxPerSlot: 1
      };
      if (lunchBreak) {
        availability.lunchBreak = lunchBreak;
      }

      const selectedSpecialization = specializationSelect
        ? String(specializationSelect.value || "").trim()
        : "";
      const specialization =
        selectedSpecialization === "Other"
          ? String(specializationOtherInput?.value || "").trim()
          : selectedSpecialization;

      const nextStatus = existingStatus === "rejected" ? "pending" : (existingStatus || "pending");

      const doctorData = {
        name: document.getElementById("name").value.trim(),
        email: nextEmail,
        specialization: specialization,
        clinic: document.getElementById("clinic").value.trim(),
        location: document.getElementById("location").value.trim(),
        image: imageInput ? imageInput.value.trim() : "",
        experience: document.getElementById("experience").value,
        fee: document.getElementById("fee").value,
        availability,
        status: nextStatus,
        uid: user.uid,
        medicalLicenseUrl: medicalLicenseUrl || existingDoctorData?.medicalLicenseUrl || "",
        specializationCertUrl:
          String(specializationCertUrlInput?.value || "").trim() ||
          existingDoctorData?.specializationCertUrl ||
          "",
        idProofUrl: idProofUrl || existingDoctorData?.idProofUrl || ""
      };

      // Upload profile photo (optional)
      const photoFile = photoFileInput ? photoFileInput.files[0] : null;
      if (photoFile) {
        setProfileStatus("Uploading profile photo...", "");
        doctorData.image = await uploadFile(
          photoFile,
          `doctors/${user.uid}/profile-${Date.now()}`,
          "Profile photo"
        );
      }

      // Upload verification documents
      const specializationCertFile = specializationCertInput ? specializationCertInput.files[0] : null;

      if (medicalLicenseFile) {
        setProfileStatus("Uploading medical license...", "");
        try {
          doctorData.medicalLicenseUrl = await uploadFile(
            medicalLicenseFile,
            `doctors/${user.uid}/medical-license-${Date.now()}`,
            "Medical license"
          );
        } catch (error) {
          if (!doctorData.medicalLicenseUrl) throw error;
        }
      }
      if (specializationCertFile) {
        setProfileStatus("Uploading specialization certificate...", "");
        try {
          doctorData.specializationCertUrl = await uploadFile(
            specializationCertFile,
            `doctors/${user.uid}/specialization-cert-${Date.now()}`,
            "Specialization certificate"
          );
        } catch (error) {
          if (!doctorData.specializationCertUrl) throw error;
        }
      }
      if (idProofFile) {
        setProfileStatus("Uploading ID proof...", "");
        try {
          doctorData.idProofUrl = await uploadFile(
            idProofFile,
            `doctors/${user.uid}/id-proof-${Date.now()}`,
            "ID proof"
          );
        } catch (error) {
          if (!doctorData.idProofUrl) throw error;
        }
      }

      const feeValue = Number(doctorData.fee);
      const experienceValue = Number(doctorData.experience);
      const hasBasics =
        Boolean(doctorData.name && specialization && doctorData.clinic && doctorData.location) &&
        Number.isFinite(feeValue) &&
        feeValue > 0 &&
        Number.isFinite(experienceValue) &&
        experienceValue >= 0;
      const hasAvailability =
        Array.isArray(availability?.days) &&
        availability.days.length > 0 &&
        Boolean(availability.start && availability.end);
      const hasRequiredDocs = Boolean(doctorData.medicalLicenseUrl && doctorData.idProofUrl);
      doctorData.profileComplete = Boolean(hasBasics && hasAvailability && hasRequiredDocs);
      doctorData.updatedAt = Date.now();
      doctorData.rejectionMessage = nextStatus === "rejected" ? (existingDoctorData?.rejectionMessage || "") : null;
      doctorData.rejectedAt = nextStatus === "rejected" ? (existingDoctorData?.rejectedAt || null) : null;
      doctorData.reviewedBy = nextStatus === "rejected" ? (existingDoctorData?.reviewedBy || null) : null;
      if (existingStatus === "rejected") {
        doctorData.rejectionMessage = null;
        doctorData.rejectedAt = null;
        doctorData.reviewedBy = null;
        doctorData.resubmittedAt = doctorData.updatedAt;
      }

      if (String(user.email || "").trim().toLowerCase() !== nextEmail) {
        setProfileStatus("Updating email...", "");
        try {
          await updateEmail(user, nextEmail);
        } catch (error) {
          const code = String(error?.code || "").toLowerCase();
          if (code.includes("requires-recent-login")) {
            throw new Error("For security, please log out, log in again, and then update the email.");
          }
          if (code.includes("email-already-in-use")) {
            throw new Error("That email address is already in use by another account.");
          }
          throw error;
        }
      }

      await updateProfile(user, {
        displayName: doctorData.name
      });

      setProfileStatus("Saving profile data...", "");
      await Promise.all([
        set(ref(db, "doctors/" + user.uid), doctorData),
        update(ref(db, "users/" + user.uid), {
          email: nextEmail,
          name: doctorData.name,
          status: doctorData.status,
          rejectionMessage: doctorData.rejectionMessage,
          rejectedAt: doctorData.rejectedAt,
          updatedAt: doctorData.updatedAt
        })
      ]);
      alert("Profile Saved!");
      setProfileStatus("Profile saved successfully.", "success");
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      window.location.href = "doctor-dashboard.html";
    } catch (error) {
      console.error("Unable to save doctor profile:", error);
      const message = String(error?.message || "Unable to save profile. Please try again.");
      setProfileStatus(message, "error");
      alert(message);
    }
  });
});
