import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const userAvatarBtn = document.getElementById("userAvatarBtn");
const userMenu = document.getElementById("userMenu");
const userInitial = document.getElementById("userInitial");
const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");
const testsList = document.getElementById("testsList");
const addTestBtn = document.getElementById("addTestBtn");
const saveLabTestsBtn = document.getElementById("saveLabTests");

let currentUser = null;
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

function hasAvailability(profile) {
  return Boolean(
    Array.isArray(profile?.availability?.days) &&
    profile.availability.days.length > 0 &&
    profile.availability.start &&
    profile.availability.end
  );
}

function computeProfileComplete(profile, tests) {
  return Boolean(
    hasBasicDetails(profile) &&
    hasRequiredDocs(profile) &&
    hasAvailability(profile) &&
    tests &&
    Object.keys(tests).length > 0
  );
}

if (addTestBtn) {
  addTestBtn.addEventListener("click", () => addTestRow());
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

if (saveLabTestsBtn) {
  saveLabTestsBtn.addEventListener("click", async () => {
    if (!currentUser) return;
    const parsedTests = collectTestsFromRows();
    if (!parsedTests.ok) {
      alert(parsedTests.error);
      return;
    }

    const nextProfileComplete = computeProfileComplete(existingLabData || {}, parsedTests.tests);

    try {
      await update(ref(db, `labs/${currentUser.uid}`), {
        tests: parsedTests.tests,
        updatedAt: Date.now(),
        profileComplete: nextProfileComplete
      });
      existingLabData = {
        ...(existingLabData || {}),
        tests: parsedTests.tests,
        updatedAt: Date.now(),
        profileComplete: nextProfileComplete
      };
      alert("Tests updated successfully.");
    } catch (error) {
      console.error(error);
      alert("Unable to save tests.");
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;
  const userSnap = await get(ref(db, `users/${user.uid}`));
  const userData = userSnap.exists() ? (userSnap.val() || {}) : {};
  if (String(userData.role || "").toLowerCase() !== "lab") {
    window.location.href = "login.html";
    return;
  }

  const labSnap = await get(ref(db, `labs/${user.uid}`));
  existingLabData = labSnap.exists() ? (labSnap.val() || {}) : {};
  const labName = String(existingLabData.labName || userData.name || user.displayName || user.email || "Lab").trim();

  if (userInitial) userInitial.textContent = (labName.charAt(0) || "L").toUpperCase();
  if (pageTitle) pageTitle.textContent = existingLabData.labName ? `${existingLabData.labName} Tests` : "Edit Tests";
  if (pageSubtitle && existingLabData.labName) {
    pageSubtitle.textContent = `Manage the tests and preparation notes shown for ${existingLabData.labName}.`;
  }

  populateTestRows(existingLabData.tests || {});
});
