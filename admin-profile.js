import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut, updateProfile, updateEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const form = document.getElementById("adminProfileForm");
const nameInput = document.getElementById("adminNameInput");
const emailInput = document.getElementById("adminEmailInput");
const phoneInput = document.getElementById("adminPhoneInput");
const statusMessage = document.getElementById("profileStatus");
const adminAvatarBtn = document.getElementById("adminAvatarBtn");
const adminAvatarDropdown = document.getElementById("adminAvatarDropdown");
const adminMenu = document.getElementById("adminMenu");
const adminInitial = document.getElementById("adminInitial");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function applyStatus(message, type = "muted") {
  if (!statusMessage) return;
  statusMessage.textContent = message;
  statusMessage.className = `verification-help ${type === "error" ? "error" : ""}`;
}

function closeAdminMenu() {
  if (!adminMenu || !adminAvatarBtn) return;
  adminMenu.classList.remove("is-visible");
  adminAvatarBtn.setAttribute("aria-expanded", "false");
}

function toggleAdminMenu() {
  if (!adminMenu || !adminAvatarBtn) return;
  const nextVisible = !adminMenu.classList.contains("is-visible");
  adminMenu.classList.toggle("is-visible", nextVisible);
  adminAvatarBtn.setAttribute("aria-expanded", nextVisible ? "true" : "false");
}

if (adminAvatarBtn) {
  adminAvatarBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAdminMenu();
  });
}

if (adminMenu) {
  adminMenu.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "edit-profile") {
      closeAdminMenu();
      return;
    }
    if (action === "logout") {
      closeAdminMenu();
      await signOut(auth);
      window.location.href = "login.html";
    }
  });
}

document.addEventListener("click", (event) => {
  if (!adminMenu || !adminAvatarDropdown) return;
  if (adminMenu.classList.contains("is-visible") && !adminAvatarDropdown.contains(event.target)) {
    closeAdminMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAdminMenu();
  }
});

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const displayName = String(nameInput.value || "").trim();
    const email = String(emailInput.value || "").trim().toLowerCase();
    const phone = String(phoneInput.value || "").trim();

    if (!displayName || !email) {
      applyStatus("Please fill in name and email before saving.", "error");
      return;
    }
    if (!EMAIL_REGEX.test(email)) {
      applyStatus("Enter a valid email address.", "error");
      return;
    }
    if (!auth.currentUser) {
      applyStatus("You were signed out. Reload the page and try again.", "error");
      return;
    }

    applyStatus("Saving changes...");

    try {
      const updateTasks = [];
      if (displayName !== auth.currentUser.displayName) {
        updateTasks.push(updateProfile(auth.currentUser, { displayName }));
      }
      if (email !== auth.currentUser.email) {
        updateTasks.push(updateEmail(auth.currentUser, email));
      }
      if (updateTasks.length) {
        await Promise.all(updateTasks);
      }

      await update(ref(db, `users/${auth.currentUser.uid}`), {
        name: displayName,
        email,
        phone
      });

      if (adminInitial) {
        adminInitial.textContent = (displayName.charAt(0) || "A").toUpperCase();
      }
      applyStatus("Profile updated successfully.");
    } catch (error) {
      console.error(error);
      if (error.code === "auth/requires-recent-login") {
        applyStatus("Please sign out and sign in again to update your email.", "error");
      } else {
        applyStatus(error.message || "Unable to save profile changes.", "error");
      }
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const snapshot = await get(ref(db, `users/${user.uid}`));
    const data = snapshot.exists() ? (snapshot.val() || {}) : {};
    if (String(data.role || "").toLowerCase() !== "admin") {
      window.location.href = "login.html";
      return;
    }

    const displayName = String(data.name || user.displayName || "Admin").trim() || "Admin";
    if (adminInitial) {
      adminInitial.textContent = (displayName.charAt(0) || "A").toUpperCase();
    }
    if (nameInput) nameInput.value = displayName;
    if (emailInput) emailInput.value = data.email || user.email || "";
    if (phoneInput) phoneInput.value = data.phone || "";
  } catch (error) {
    console.error(error);
    applyStatus("Unable to load your profile right now.", "error");
  }
});
