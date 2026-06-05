import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, update, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const adminNameEl = document.getElementById("adminName");
const adminMetaEl = document.getElementById("adminMeta");
const adminAvatarBtn = document.getElementById("adminAvatarBtn");
const adminAvatarDropdown = document.getElementById("adminAvatarDropdown");
const adminMenu = document.getElementById("adminMenu");
const adminInitial = document.getElementById("adminInitial");
const pendingReviewCountEl = document.getElementById("pendingReviewCount");
const approvedProfileCountEl = document.getElementById("approvedProfileCount");
const rejectedProfileCountEl = document.getElementById("rejectedProfileCount");
const totalProfileCountEl = document.getElementById("totalProfileCount");
const pendingDoctorsEl = document.getElementById("pendingDoctors");
const approvedDoctorsEl = document.getElementById("approvedDoctors");
const rejectedDoctorsEl = document.getElementById("rejectedDoctors");
const pendingLabsEl = document.getElementById("pendingLabs");
const approvedLabsEl = document.getElementById("approvedLabs");
const rejectedLabsEl = document.getElementById("rejectedLabs");

let doctorProfiles = [];
let labProfiles = [];

const normalizeStatus = (value) => String(value || "approved").toLowerCase();
const DEFAULT_REJECTION_MESSAGE = "Please review your profile details and documents, then resubmit for approval.";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function promptForReviewMessage(type, currentStatus, existingMessage = "") {
  const label = type === "doctor" ? "doctor" : "lab";
  const actionText = currentStatus === "approved" ? "suspension" : "rejection";
  const message = window.prompt(
    `Enter the ${actionText} reason for this ${label} profile.\nExamples: Document invalid, Clinic location not found, Phone number mismatch`,
    String(existingMessage || "").trim() || DEFAULT_REJECTION_MESSAGE
  );

  if (message === null) {
    return null;
  }

  const normalized = String(message).trim();
  if (!normalized) {
    alert("Please enter a reason before rejecting this profile.");
    return "";
  }

  return normalized;
}

function statusClass(status) {
  if (status === "approved") return "status-approved";
  if (status === "pending") return "status-pending";
  if (status === "rejected" || status === "suspended") return "status-cancelled";
  return "status-default";
}

function buildCard(profile, type) {
  const card = document.createElement("div");
  card.className = "doctor-card";

  const status = normalizeStatus(profile.status);
  const isDoctor = type === "doctor";
  const title = isDoctor ? `Dr. ${profile.name || "Doctor"}` : profile.labName || "Lab";
  const subtitle = isDoctor ? profile.specialization || "General" : profile.contactName || "Lab Contact";
  const location = profile.location || "N/A";
  const experience = isDoctor ? profile.experience : null;
  const phone = isDoctor ? null : profile.phone;

  card.innerHTML = `
    <h3>${title}</h3>
    <p><strong>${isDoctor ? "Specialization" : "Contact"}:</strong> ${subtitle}</p>
    <p><strong>Location:</strong> ${location}</p>
    ${experience ? `<p><strong>Experience:</strong> ${experience} years</p>` : ""}
    ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ""}
    <p><strong>Status:</strong> <span class="status-pill ${statusClass(status)}">${status}</span></p>
    ${
      status === "rejected" && profile.rejectionMessage
        ? `<p><strong>Admin Note:</strong> ${escapeHtml(profile.rejectionMessage)}</p>`
        : ""
    }
    <div class="profile-actions"></div>
    <div class="document-links"></div>
  `;

  const actions = card.querySelector(".profile-actions");
  if (actions) {
    if (status !== "approved") {
      const approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className = "primary-btn";
      approveBtn.textContent = "Approve";
      approveBtn.addEventListener("click", () => updateStatus(profile.uid, type, "approved"));
      actions.appendChild(approveBtn);
    }

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "ghost-btn";
    rejectBtn.textContent = status === "approved" ? "Suspend" : "Reject";
    rejectBtn.addEventListener("click", async () => {
      const reviewMessage = promptForReviewMessage(type, status, profile.rejectionMessage);
      if (reviewMessage === null || reviewMessage === "") return;
      await updateStatus(profile.uid, type, "rejected", reviewMessage);
    });
    actions.appendChild(rejectBtn);
  }

  const docLinks = card.querySelector(".document-links");
  if (!docLinks) return card;

  if (isDoctor) {
    if (profile.medicalLicenseUrl) {
      const link = document.createElement("a");
      link.href = profile.medicalLicenseUrl;
      link.target = "_blank";
      link.textContent = "View Medical License";
      link.className = "doc-link";
      docLinks.appendChild(link);
    }
    if (profile.specializationCertUrl) {
      const link = document.createElement("a");
      link.href = profile.specializationCertUrl;
      link.target = "_blank";
      link.textContent = "View Specialization Cert";
      link.className = "doc-link";
      docLinks.appendChild(link);
    }
    if (profile.idProofUrl) {
      const link = document.createElement("a");
      link.href = profile.idProofUrl;
      link.target = "_blank";
      link.textContent = "View ID Proof";
      link.className = "doc-link";
      docLinks.appendChild(link);
    }
  } else {
    if (profile.labLicenseUrl) {
      const link = document.createElement("a");
      link.href = profile.labLicenseUrl;
      link.target = "_blank";
      link.textContent = "View Lab License";
      link.className = "doc-link";
      docLinks.appendChild(link);
    }
    if (profile.nablCertUrl) {
      const link = document.createElement("a");
      link.href = profile.nablCertUrl;
      link.target = "_blank";
      link.textContent = "View NABL Cert";
      link.className = "doc-link";
      docLinks.appendChild(link);
    }
    if (profile.idProofUrl) {
      const link = document.createElement("a");
      link.href = profile.idProofUrl;
      link.target = "_blank";
      link.textContent = "View ID Proof";
      link.className = "doc-link";
      docLinks.appendChild(link);
    }
  }

  return card;
}

async function updateStatus(uid, type, nextStatus, reviewMessage = "") {
  if (!uid) return;
  const reviewedAt = Date.now();
  const payload = { status: nextStatus, updatedAt: reviewedAt };
  const userPayload = { status: nextStatus, updatedAt: reviewedAt };

  if (nextStatus === "rejected") {
    payload.rejectionMessage = reviewMessage || DEFAULT_REJECTION_MESSAGE;
    payload.rejectedAt = reviewedAt;
    payload.reviewedBy = "admin";
    userPayload.rejectionMessage = payload.rejectionMessage;
    userPayload.rejectedAt = reviewedAt;
  } else {
    payload.rejectionMessage = null;
    payload.rejectedAt = null;
    userPayload.rejectionMessage = null;
    userPayload.rejectedAt = null;
  }

  const profilePath = type === "doctor" ? `doctors/${uid}` : `labs/${uid}`;
  try {
    await Promise.all([
      update(ref(db, profilePath), payload),
      update(ref(db, `users/${uid}`), userPayload)
    ]);
    alert("Status updated successfully.");
  } catch (error) {
    console.error("Error updating status:", error);
    if (error.code === "PERMISSION_DENIED") {
      alert("Permission denied. Please check admin privileges and deployed database rules.");
    } else {
      alert(`Unable to update status: ${error.message}`);
    }
  }
}

function renderProfileBucket(list, container) {
  if (!container) return;
  container.innerHTML = "";

  if (!list.length) {
    container.innerHTML = "<p class='empty-state'>No profiles in this section.</p>";
    return;
  }

  list.forEach((profile) => {
    container.appendChild(buildCard(profile, profile.type));
  });
}

function refreshDashboardCounts() {
  const allProfiles = [...doctorProfiles, ...labProfiles];
  const pendingCount = allProfiles.filter((profile) => normalizeStatus(profile.status) === "pending").length;
  const approvedCount = allProfiles.filter((profile) => normalizeStatus(profile.status) === "approved").length;
  const rejectedCount = allProfiles.filter((profile) => normalizeStatus(profile.status) === "rejected").length;

  if (pendingReviewCountEl) pendingReviewCountEl.textContent = String(pendingCount);
  if (approvedProfileCountEl) approvedProfileCountEl.textContent = String(approvedCount);
  if (rejectedProfileCountEl) rejectedProfileCountEl.textContent = String(rejectedCount);
  if (totalProfileCountEl) totalProfileCountEl.textContent = String(allProfiles.length);
}

function renderAllSections() {
  renderProfileBucket(
    doctorProfiles.filter((profile) => normalizeStatus(profile.status) === "pending").map((profile) => ({ ...profile, type: "doctor" })),
    pendingDoctorsEl
  );
  renderProfileBucket(
    doctorProfiles.filter((profile) => normalizeStatus(profile.status) === "approved").map((profile) => ({ ...profile, type: "doctor" })),
    approvedDoctorsEl
  );
  renderProfileBucket(
    doctorProfiles.filter((profile) => normalizeStatus(profile.status) === "rejected").map((profile) => ({ ...profile, type: "doctor" })),
    rejectedDoctorsEl
  );

  renderProfileBucket(
    labProfiles.filter((profile) => normalizeStatus(profile.status) === "pending").map((profile) => ({ ...profile, type: "lab" })),
    pendingLabsEl
  );
  renderProfileBucket(
    labProfiles.filter((profile) => normalizeStatus(profile.status) === "approved").map((profile) => ({ ...profile, type: "lab" })),
    approvedLabsEl
  );
  renderProfileBucket(
    labProfiles.filter((profile) => normalizeStatus(profile.status) === "rejected").map((profile) => ({ ...profile, type: "lab" })),
    rejectedLabsEl
  );

  refreshDashboardCounts();
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
      window.location.href = "admin-profile.html";
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

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const adminSnap = await get(ref(db, `users/${user.uid}`));
  const adminData = adminSnap.exists() ? (adminSnap.val() || {}) : {};
  const role = String(adminData.role || "").toLowerCase();

  if (role !== "admin") {
    alert("Admin access required.");
    window.location.href = "login.html";
    return;
  }

  const adminName = String(adminData.name || user.displayName || "Admin").trim() || "Admin";
  if (adminNameEl) {
    adminNameEl.textContent = `Welcome, ${adminName}`;
  }
  if (adminMetaEl) {
    adminMetaEl.textContent = user.email
      ? `Signed in as ${user.email}. Review doctor and lab registrations from the sections below.`
      : "Review doctor and lab registrations from the sections below.";
  }
  if (adminInitial) {
    adminInitial.textContent = (adminName.charAt(0) || "A").toUpperCase();
  }

  onValue(ref(db, "doctors"), (snapshot) => {
    const rows = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        rows.push({ uid: child.key, ...(child.val() || {}) });
      });
    }
    doctorProfiles = rows;
    renderAllSections();
  });

  onValue(ref(db, "labs"), (snapshot) => {
    const rows = [];
    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        rows.push({ uid: child.key, ...(child.val() || {}) });
      });
    }
    labProfiles = rows;
    renderAllSections();
  });
});
