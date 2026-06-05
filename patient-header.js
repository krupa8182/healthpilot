import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const avatarBtn = document.getElementById("userAvatarBtn");
const avatarMenu = document.getElementById("userMenu");
const avatarDropdown = document.getElementById("userAvatarDropdown");
const userInitial = document.getElementById("userInitial");

function closeUserMenu() {
  if (!avatarBtn || !avatarMenu) return;
  avatarMenu.classList.remove("is-visible");
  avatarBtn.setAttribute("aria-expanded", "false");
}

function toggleUserMenu() {
  if (!avatarBtn || !avatarMenu) return;
  const visible = !avatarMenu.classList.contains("is-visible");
  avatarMenu.classList.toggle("is-visible", visible);
  avatarBtn.setAttribute("aria-expanded", visible ? "true" : "false");
}

if (avatarBtn) {
  avatarBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleUserMenu();
  });
}

if (avatarMenu) {
  avatarMenu.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.dataset?.action;
    if (!action) return;

    if (action === "edit-profile") {
      window.location.href = "patient-profile.html";
      return;
    }

    if (action === "logout") {
      await signOut(auth);
      window.location.href = "login.html";
    }
  });
}

document.addEventListener("click", (event) => {
  if (!avatarMenu || !avatarDropdown) return;
  if (avatarMenu.classList.contains("is-visible") && !avatarDropdown.contains(event.target)) {
    closeUserMenu();
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user || !userInitial) return;

  let name = String(user.displayName || "").trim();

  if (!name) {
    try {
      const userSnap = await get(ref(db, `users/${user.uid}`));
      if (userSnap.exists()) {
        name = String(userSnap.val()?.name || "").trim();
      }
    } catch (error) {
      console.error("Unable to load patient header profile", error);
    }
  }

  userInitial.textContent = (name || user.email || "P").trim().charAt(0).toUpperCase();
});
