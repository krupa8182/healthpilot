import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase,
  connectDatabaseEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// Shared Firebase client configuration for browser modules.
const firebaseConfig = {
  apiKey: "AIzaSyB3JLMZpenpdRX8-zuCNaqgJCpPga0KgZM",
  authDomain: "healthpilot-1da94.firebaseapp.com",
  projectId: "healthpilot-1da94",
  storageBucket: "healthpilot-1da94.firebasestorage.app",
  messagingSenderId: "982634684342",
  appId: "1:982634684342:web:b98dc0febae51ea0f22b17",
  databaseURL:
    "https://healthpilot-1da94-default-rtdb.asia-southeast1.firebasedatabase.app",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);

function isLocalhost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "127.0.0.1" || host === "localhost";
}

function shouldUseDatabaseEmulator() {
  if (!isLocalhost() || typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search);
  const query = params.get("emulator");

  if (query === "1") {
    window.localStorage.setItem("hp_use_emulator", "1");
    return true;
  }

  if (query === "0") {
    window.localStorage.setItem("hp_use_emulator", "0");
    return false;
  }

  return window.localStorage.getItem("hp_use_emulator") === "1";
}

if (shouldUseDatabaseEmulator()) {
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
}

// Test mode banner for demos (disable when going live).
const SHOW_TEST_MODE_BANNER = false;

function injectTestModeBanner() {
  if (typeof document === "undefined") return;

  const existingBanner = document.querySelector(".test-mode-banner");
  if (!SHOW_TEST_MODE_BANNER) {
    existingBanner?.remove();
    document.body.classList.remove("has-test-banner");
    return;
  }

  if (document.querySelector(".test-mode-banner")) return;

  const banner = document.createElement("div");
  banner.className = "test-mode-banner";
  banner.setAttribute("role", "status");
  banner.innerHTML = `
    <span class="test-mode-pill">TEST MODE</span>
    <span class="test-mode-text">No real money is charged.</span>
  `;

  document.body.prepend(banner);
  document.body.classList.add("has-test-banner");
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectTestModeBanner, {
      once: true,
    });
  } else {
    injectTestModeBanner();
  }
}
