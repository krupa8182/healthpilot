import { auth, db } from "./firebase-client.js";
import {
  onAuthStateChanged,
  updateProfile,
  updateEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref,
  get,
  update
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const form = document.getElementById("patientProfileForm");
const nameInput = document.getElementById("patientNameInput");
const emailInput = document.getElementById("patientEmailInput");
const phoneInput = document.getElementById("patientPhoneInput");
const statusMessage = document.getElementById("profileStatus");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

const normalizeIndianPhone = (rawPhone) => {
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
};

const applyStatus = (message, type = "muted") => {
  statusMessage.textContent = message;
  statusMessage.className = `verification-help ${type === "error" ? "error" : ""}`;
};

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

  applyStatus("Saving changes...", "muted");

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
  } catch (err) {
    console.error(err);
    if (err.code === "auth/requires-recent-login") {
      applyStatus("Please sign out and sign in again to update your email.", "error");
    } else {
      applyStatus(err.message || "Something went wrong while saving your profile.", "error");
    }
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const snapshot = await get(ref(db, `users/${user.uid}`));
    const data = snapshot.exists() ? snapshot.val() : {};

    nameInput.value = data.name || user.displayName || "";
    emailInput.value = data.email || user.email || "";
    phoneInput.value = data.phone || "";
  } catch (err) {
    console.error(err);
    applyStatus("Unable to load your profile right now.", "error");
  }
});
