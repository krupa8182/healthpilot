import { db, auth } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const doctorList = document.getElementById("doctorList");
const searchInput = document.getElementById("searchInput");
const specializationFilter = document.getElementById("specializationFilter");
const logoutBtn = document.getElementById("logoutBtn");

let doctorsData = [];
const isVisibleToPatients = (doctor) => {
  const status = String(doctor?.status || "approved").toLowerCase();
  return status === "approved" && doctor?.profileComplete === true;
};

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
  }
});

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });
}

const doctorsRef = ref(db, "doctors");

onValue(doctorsRef, (snapshot) => {
  doctorsData = [];

  snapshot.forEach((childSnapshot) => {
    const doctor = childSnapshot.val();
    doctor.uid = childSnapshot.key;
    if (isVisibleToPatients(doctor)) {
      doctorsData.push(doctor);
    }
  });

  displayDoctors(doctorsData);
});

function displayDoctors(doctors) {
  doctorList.innerHTML = "";

  if (doctors.length === 0) {
    doctorList.innerHTML = "<p>No doctors found</p>";
    return;
  }

  doctors.forEach((doctor) => {
    const div = document.createElement("div");
    div.className = "doctor-card";

    const todayIndex = new Date().getDay();
    const availabilityDays = Array.isArray(doctor.availability?.days)
      ? doctor.availability.days
      : [];
    const availableToday = availabilityDays.includes(todayIndex);

    const doctorName = doctor.name || "Doctor";
    const specialization = doctor.specialization || "N/A";
    const clinic = doctor.clinic || "N/A";
    const experience = doctor.experience || "N/A";
    const fee = doctor.fee || "N/A";
    const location = doctor.location || "N/A";
    const image = doctor.image || "https://via.placeholder.com/120x120?text=Doctor";
    const status = String(doctor?.status || "approved").toLowerCase();

    const availabilityBadge = availableToday
      ? `<span class="available">Available Today</span>`
      : `<span class="not-available">Not Available Today</span>`;

    const statusBadge = status === "approved" 
      ? `<span class="status-approved">Approved</span>`
      : status === "pending"
      ? `<span class="status-pending">Pending Approval</span>`
      : `<span class="status-rejected">Rejected</span>`;

    div.innerHTML = `
      <img src="${image}" class="doctor-photo" alt="${doctorName}">
      <h3>${doctorName}<span class="verified">&#10003; Verified</span></h3>
      ${availabilityBadge}
      ${statusBadge}
      <p><b>Specialization:</b> ${specialization}</p>
      <p><b>Clinic:</b> ${clinic}</p>
      <p>${experience} years experience</p>
      <p>Consultation Fee: &#8377;${fee}</p>
      <p>${location}</p>
      <button class="view-btn" onclick="viewDoctor('${doctor.uid}')">View Profile</button>
    `;

    doctorList.appendChild(div);
  });
}

function filterDoctors() {
  const searchValue = searchInput.value.toLowerCase();
  const specializationValue = specializationFilter.value;

  const filtered = doctorsData.filter((doctor) => {
    const matchesName = (doctor.name || "").toLowerCase().includes(searchValue);

    const matchesSpecialization =
      specializationValue === "" ||
      specializationMatches(doctor.specialization, specializationValue);

    return matchesName && matchesSpecialization;
  });

  displayDoctors(filtered);
}

function normalizeText(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function specializationMatches(doctorSpecialization, selectedSpecialization) {
  const doctor = normalizeText(doctorSpecialization);
  const selected = normalizeText(selectedSpecialization);

  if (!doctor || !selected) return false;
  if (doctor === selected) return true;
  if (doctor.includes(selected) || selected.includes(doctor)) return true;

  const distance = levenshteinDistance(doctor, selected);
  const allowedDistance = selected.length <= 8 ? 2 : 3;

  return distance <= allowedDistance;
}

searchInput.addEventListener("input", filterDoctors);
specializationFilter.addEventListener("change", filterDoctors);

window.viewDoctor = function(uid) {
  window.location.href = `doctor-details.html?uid=${uid}`;
};
