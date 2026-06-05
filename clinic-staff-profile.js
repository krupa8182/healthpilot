import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut, updateProfile, updateEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const form = document.getElementById("staffProfileForm");
const nameInput = document.getElementById("staffNameInput");
const emailInput = document.getElementById("staffEmailInput");
const phoneInput = document.getElementById("staffPhoneInput");
const clinicCodeInput = document.getElementById("staffClinicCodeInput");
const statusMessage = document.getElementById("profileStatus");
const editWorkingHoursBtn = document.getElementById("editWorkingHoursBtn");
const userAvatarBtn = document.getElementById("userAvatarBtn");
const userMenu = document.getElementById("userMenu");
const userInitial = document.getElementById("userInitial");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

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
  return emailFallback || "";
}

function applyStatus(message, type = "muted") {
  if (!statusMessage) return;
  statusMessage.textContent = message;
  statusMessage.className = `verification-help ${type === "error" ? "error" : ""}`;
}

function normalizeIndianPhone(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (digits.length === 10 && INDIAN_PHONE_REGEX.test(digits)) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    const tenDigit = digits.slice(2);
    if (INDIAN_PHONE_REGEX.test(tenDigit)) {
      return `+91${tenDigit}`;
    }
  }
  return null;
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

if (userAvatarBtn) {
  userAvatarBtn.addEventListener("click", toggleUserMenu);
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

if (editWorkingHoursBtn) {
  editWorkingHoursBtn.addEventListener("click", () => {
    window.location.href = "clinic-staff-dashboard.html?openWorkingHours=1";
  });
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const displayName = nameInput.value.trim();
    const rawEmail = emailInput.value.trim().toLowerCase();
    const normalizedPhone = normalizeIndianPhone(phoneInput.value.trim());

    if (!displayName || !rawEmail || !phoneInput.value.trim()) {
      applyStatus("Please fill in every field before saving.", "error");
      return;
    }

    if (!EMAIL_REGEX.test(rawEmail)) {
      applyStatus("Enter a valid email address.", "error");
      return;
    }

    if (!normalizedPhone) {
      applyStatus("Enter a valid Indian phone number (10 digits).", "error");
      return;
    }

    if (!auth.currentUser) {
      applyStatus("You were signed out. Reload the page to sign in again.", "error");
      return;
    }

    applyStatus("Saving changes...");

    try {
      const updateTasks = [];

      if (displayName !== auth.currentUser.displayName) {
        updateTasks.push(updateProfile(auth.currentUser, { displayName }));
      }

      if (rawEmail !== auth.currentUser.email) {
        updateTasks.push(updateEmail(auth.currentUser, rawEmail));
      }

      if (updateTasks.length) {
        await Promise.all(updateTasks);
      }

      await update(ref(db, `users/${auth.currentUser.uid}`), {
        name: displayName,
        email: rawEmail,
        phone: normalizedPhone
      });

      applyStatus("Profile updated successfully.");
    } catch (error) {
      console.error(error);
      if (error.code === "auth/requires-recent-login") {
        applyStatus("Please sign out and sign in again to update your email.", "error");
      } else {
        applyStatus(error.message || "Something went wrong while saving your profile.", "error");
      }
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  if (userInitial) {
    userInitial.textContent = (user.email || "S").charAt(0).toUpperCase();
  }

  try {
    const snapshot = await get(ref(db, `users/${user.uid}`));
    const data = snapshot.exists() ? snapshot.val() : {};
    if (String(data.role || "").toLowerCase() !== "clinic_staff") {
      window.location.href = "login.html";
      return;
    }
    let doctorData = {};
    if (data.linkedDoctorUID) {
      const doctorSnap = await get(ref(db, `doctors/${data.linkedDoctorUID}`));
      doctorData = doctorSnap.exists() ? (doctorSnap.val() || {}) : {};
    }
    const displayName = getStaffDisplayName(data, user, doctorData);

    if (userInitial) {
      userInitial.textContent = (displayName.charAt(0) || "S").toUpperCase();
    }

    nameInput.value = displayName || "";
    emailInput.value = data.email || user.email || "";
    phoneInput.value = data.phone || "";
    clinicCodeInput.value = data.clinicCode || "";
  } catch (error) {
    console.error(error);
    applyStatus("Unable to load your profile right now.", "error");
  }
});
