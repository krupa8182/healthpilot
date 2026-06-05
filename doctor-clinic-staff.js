import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const userAvatarBtn = document.getElementById("userAvatarBtn");
const userMenu = document.getElementById("userMenu");
const userInitial = document.getElementById("userInitial");
const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");
const clinicCodeDisplay = document.getElementById("clinicCodeDisplay");
const generateClinicCodeBtn = document.getElementById("generateClinicCodeBtn");
const staffListContainer = document.getElementById("staffListContainer");

let currentUser = null;

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

function generateClinicCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getStaffStatusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "active") return "staff-status staff-status--active";
  if (normalized === "rejected") return "staff-status staff-status--rejected";
  return "staff-status staff-status--pending";
}

function getStaffStatusLabel(staff) {
  const status = String(staff?.status || "").toLowerCase();
  if (status === "active") return "";
  if (status === "rejected") return "Rejected";
  return "Pending Approval";
}

async function saveClinicCode(user, clinicCode) {
  try {
    const doctorRef = ref(db, "doctors/" + user.uid);
    const doctorSnap = await get(doctorRef);
    const existing = doctorSnap.exists() ? doctorSnap.val() : {};
    const payload = { clinicCode };
    if (!Object.prototype.hasOwnProperty.call(existing, "status")) payload.status = "pending";
    if (!Object.prototype.hasOwnProperty.call(existing, "uid")) payload.uid = user.uid;
    await update(doctorRef, payload);
  } catch (error) {
    console.error("Error saving clinic code:", error);
    alert("Error saving clinic code. Please try again.");
  }
}

async function updateStaffApproval(uid, nextStatus) {
  try {
    const patch = {
      status: nextStatus,
      staffApprovalUpdatedAt: Date.now(),
      approvedBy: currentUser?.uid || null,
    };
    if (nextStatus === "active") patch.linkedDoctorUID = currentUser?.uid || null;
    await update(ref(db, `users/${uid}`), patch);
    await loadStaffList(currentUser);
  } catch (error) {
    console.error(`Error updating staff status to ${nextStatus}:`, error);
    const code = String(error?.code || "").toLowerCase();
    if (code.includes("permission-denied") || code.includes("permission_denied")) {
      alert("Doctor approval is blocked by Realtime Database rules. Publish the latest database rules, then try again.");
      return;
    }
    alert("Unable to update the staff request right now. Please try again.");
  }
}

async function loadStaffList(user) {
  try {
    const doctorSnap = await get(ref(db, "doctors/" + user.uid));
    if (!doctorSnap.exists()) return;

    const doctorData = doctorSnap.val() || {};
    const clinicCode = doctorData.clinicCode;
    if (!clinicCode || !staffListContainer) return;

    const usersSnap = await get(ref(db, "users"));
    if (!usersSnap.exists()) {
      staffListContainer.innerHTML = "";
      return;
    }

    const users = usersSnap.val();
    const staffMembers = Object.entries(users)
      .filter(([, userData]) =>
        userData.role === "clinic_staff" &&
        userData.clinicCode === clinicCode &&
        userData.verifiedAt
      )
      .map(([uid, userData]) => ({ uid, ...userData }));

    let html = "";
    if (staffMembers.length === 0) {
      html = "";
    } else {
      html += "<div class='staff-grid'>";
      staffMembers.forEach((staff) => {
        const statusLabel = getStaffStatusLabel(staff);
        html += `
          <div class='staff-card'>
            <div class='staff-avatar'>${(staff.name || "Staff").charAt(0).toUpperCase()}</div>
            <div class='staff-info'>
              <h4>${staff.name || "Staff Member"}</h4>
              <p>${staff.email || ""}</p>
              ${statusLabel ? `<p class='${getStaffStatusClass(staff.status)}'>${statusLabel}</p>` : ""}
              ${
                staff.status === "pending"
                  ? `
                    <div class="staff-actions">
                      <button class="approve-btn" type="button" data-staff-action="approve" data-staff-id="${staff.uid}">Approve</button>
                      <button class="reject-btn" type="button" data-staff-action="reject" data-staff-id="${staff.uid}">Reject</button>
                    </div>
                  `
                  : ""
              }
            </div>
          </div>
        `;
      });
      html += "</div>";
    }

    staffListContainer.innerHTML = html;
  } catch (error) {
    console.error("Error loading staff list:", error);
  }
}

async function loadDoctorIdentity(user) {
  const userSnap = await get(ref(db, "users/" + user.uid));
  const userData = userSnap.exists() ? (userSnap.val() || {}) : {};
  if (String(userData.role || "").toLowerCase() !== "doctor") {
    window.location.href = "login.html";
    return false;
  }

  const doctorSnap = await get(ref(db, "doctors/" + user.uid));
  const doctorData = doctorSnap.exists() ? (doctorSnap.val() || {}) : {};
  const doctorDisplayName = String(userData.name || doctorData.name || user.displayName || user.email || "Doctor").trim();
  const clinicName = String(doctorData.clinic || userData.clinic || "").trim();

  if (userInitial) userInitial.textContent = (doctorDisplayName.charAt(0) || "D").toUpperCase();
  if (pageTitle && clinicName) pageTitle.textContent = `${clinicName} Staff`;
  if (pageSubtitle) {
    pageSubtitle.textContent = clinicName
      ? `Manage receptionists and administrative staff for ${clinicName}.`
      : "Manage your clinic receptionists and administrative staff.";
  }
  if (clinicCodeDisplay) {
    clinicCodeDisplay.value = doctorData.clinicCode || "No clinic code generated";
  }
  return true;
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
      window.location.href = "doctor-profile.html";
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

if (staffListContainer) {
  staffListContainer.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-staff-action]");
    if (!button) return;
    const staffId = button.dataset.staffId;
    const action = button.dataset.staffAction;
    if (!staffId || !action) return;
    if (action === "approve") {
      await updateStaffApproval(staffId, "active");
      return;
    }
    if (action === "reject") await updateStaffApproval(staffId, "rejected");
  });
}

if (generateClinicCodeBtn) {
  generateClinicCodeBtn.addEventListener("click", async () => {
    if (!currentUser) return;
    const newCode = generateClinicCode();
    if (clinicCodeDisplay) clinicCodeDisplay.value = newCode;
    await saveClinicCode(currentUser, newCode);
    alert("New clinic code generated and saved!");
    await loadStaffList(currentUser);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  currentUser = user;
  const ok = await loadDoctorIdentity(user);
  if (!ok) return;
  await loadStaffList(user);
});
