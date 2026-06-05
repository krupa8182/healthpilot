import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const labList = document.getElementById("labList");
const searchInput = document.getElementById("searchInput");
const testFilter = document.getElementById("testFilter");
const logoutBtn = document.getElementById("logoutBtn");

let labsData = [];
const isVisibleToPatients = (lab) => {
  const status = String(lab?.status || "approved").toLowerCase();
  return status === "approved" && lab?.profileComplete === true;
};

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const userSnap = await get(ref(db, "users/" + user.uid));
  if (!userSnap.exists() || String(userSnap.val().role || "").toLowerCase() !== "patient") {
    window.location.href = "login.html";
  }
});

onValue(ref(db, "labs"), (snapshot) => {
  labsData = [];
  if (snapshot.exists()) {
    snapshot.forEach((child) => {
      const lab = child.val();
      lab.uid = child.key;
      if (isVisibleToPatients(lab)) {
        labsData.push(lab);
      }
    });
  }
  updateTestFilterOptions(labsData);
  filterLabs();
});

function isLabOpenToday(lab) {
  const availabilityDays = Array.isArray(lab.availability?.days) ? lab.availability.days : [];
  return availabilityDays.includes(new Date().getDay());
}

function stringifyTests(tests) {
  if (!tests) return [];
  return Object.values(tests)
    .map((test) => ({
      name: String(test.name || "").trim(),
      price: Number(test.price || 0)
    }))
    .filter((test) => test.name);
}

function formatTests(tests) {
  if (tests.length === 0) return "<p><strong>Tests:</strong> Not configured</p>";
  return `<p><strong>Tests:</strong> ${tests.map((test) => `${test.name} (Rs. ${test.price || "N/A"})`).join(", ")}</p>`;
}

function displayLabs(labs) {
  labList.innerHTML = "";

  if (labs.length === 0) {
    labList.innerHTML = "<p>No labs found.</p>";
    return;
  }

  labs.forEach((lab) => {
    const tests = stringifyTests(lab.tests);
    const openToday = isLabOpenToday(lab);

    const card = document.createElement("div");
    card.className = "doctor-card";
    card.innerHTML = `
      <h3>${lab.labName || "Pathology Lab"}</h3>
      ${openToday ? '<span class="available">Open Today</span>' : '<span class="not-available">Closed Today</span>'}
      <p><strong>Contact:</strong> ${lab.contactName || "N/A"}</p>
      <p><strong>Phone:</strong> ${lab.phone || "N/A"}</p>
      <p><strong>Location:</strong> ${lab.location || "N/A"}</p>
      ${formatTests(tests)}
      <button class="view-btn" data-id="${lab.uid}">Book Test</button>
    `;

    const button = card.querySelector(".view-btn");
    button.addEventListener("click", () => {
      window.location.href = `lab-booking.html?uid=${lab.uid}`;
    });

    labList.appendChild(card);
  });
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function updateTestFilterOptions(labs) {
  if (!testFilter) return;

  const selected = normalizeText(testFilter.value);
  const unique = new Map();

  labs.forEach((lab) => {
    stringifyTests(lab.tests).forEach((test) => {
      const name = String(test.name || "").trim();
      const key = normalizeText(name);
      if (name && !unique.has(key)) {
        unique.set(key, name);
      }
    });
  });

  const names = Array.from(unique.values()).sort((a, b) => a.localeCompare(b));

  testFilter.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All Tests";
  testFilter.appendChild(allOption);

  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    testFilter.appendChild(option);
  });

  if (!selected) return;
  const match = names.find((name) => normalizeText(name) === selected);
  if (match) testFilter.value = match;
}

function filterLabs() {
  const searchValue = normalizeText(searchInput?.value);
  const testValue = normalizeText(testFilter?.value);

  const filtered = labsData.filter((lab) => {
    const labName = normalizeText(lab.labName);
    const tests = stringifyTests(lab.tests).map((test) => normalizeText(test.name));

    const matchesSearch = !searchValue || labName.includes(searchValue);
    const matchesTest = !testValue || tests.some((testName) => testName === testValue);

    return matchesSearch && matchesTest;
  });

  displayLabs(filtered);
}

if (searchInput) searchInput.addEventListener("input", filterLabs);
if (testFilter) testFilter.addEventListener("change", filterLabs);
