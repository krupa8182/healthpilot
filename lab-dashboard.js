import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, onValue, push, set, update, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const avatarBtn = document.getElementById("labAvatarBtn");
const avatarMenu = document.getElementById("labAvatarMenu");
const avatarDropdown = document.getElementById("labAvatarDropdown");
const avatarInitial = document.getElementById("labAvatarInitial");
const labTitle = document.getElementById("labTitle");
const labMeta = document.getElementById("labMeta");
const totalBookingsEl = document.getElementById("totalBookings");
const pendingBookingsEl = document.getElementById("pendingBookings");
const completedBookingsEl = document.getElementById("completedBookings");
const bookingsContainer = document.getElementById("labBookingsContainer");
const tabs = document.querySelectorAll(".tab-btn");
const labRejectedBanner = document.getElementById("labRejectedBanner");
const labRejectedTitle = document.getElementById("labRejectedTitle");
const labRejectedMessage = document.getElementById("labRejectedMessage");
const labRejectedEditBtn = document.getElementById("labRejectedEditBtn");

let currentUser = null;
let allBookings = {};
let currentStatus = "approved";
let labDetails = null;
const DEFAULT_REJECTION_MESSAGE = "Your lab profile is hidden until the requested corrections are made and submitted again.";

function getBookingStatusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value === "approved") return "upcoming";
  return value || "active";
}

function applyLabProfile(profile, user) {
  labDetails = profile || null;
  renderRejectedBanner(profile);

  if (labTitle) {
    labTitle.textContent = profile?.labName || "Laboratory";
  }

  if (labMeta) {
    labMeta.textContent = `${profile?.location || ""} ${profile?.phone ? `| ${profile.phone}` : ""}`.trim();
  }

  if (avatarInitial) {
    const displaySource = (profile?.labName || user?.displayName || "Lab").trim() || "Lab";
    avatarInitial.textContent = displaySource.charAt(0).toUpperCase();
  }
}

function renderRejectedBanner(profile = null) {
  if (!labRejectedBanner || !labRejectedTitle || !labRejectedMessage) return;

  const status = String(profile?.status || "").toLowerCase();
  if (status !== "rejected") {
    labRejectedBanner.classList.add("is-hidden");
    labRejectedMessage.textContent = "";
    return;
  }

  labRejectedTitle.textContent = "Your lab profile needs updates before it can go live.";
  labRejectedMessage.textContent = profile?.rejectionMessage || DEFAULT_REJECTION_MESSAGE;
  labRejectedBanner.classList.remove("is-hidden");
}

tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabs.forEach((tab) => tab.classList.remove("active"));
    btn.classList.add("active");
    currentStatus = btn.dataset.status;
    renderBookings();
  });
});

async function handleLogout() {
  await signOut(auth);
  window.location.href = "login.html";
}

function closeAvatarMenu() {
  if (!avatarMenu || !avatarBtn) return;
  avatarMenu.classList.remove("is-visible");
  avatarBtn.setAttribute("aria-expanded", "false");
}

function toggleAvatarMenu() {
  if (!avatarMenu || !avatarBtn) return;
  const isVisible = avatarMenu.classList.toggle("is-visible");
  avatarBtn.setAttribute("aria-expanded", String(isVisible));
}

if (avatarBtn) {
  avatarBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAvatarMenu();
  });
}

if (avatarMenu) {
  avatarMenu.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.dataset?.action;
    if (!action) return;
    if (action === "logout") {
      await handleLogout();
      return;
    }
    if (action === "edit-profile") {
      window.location.href = "lab-profile.html";
    }
    closeAvatarMenu();
  });
}

if (labRejectedEditBtn) {
  labRejectedEditBtn.addEventListener("click", () => {
    window.location.href = "lab-profile.html";
  });
}

document.addEventListener("click", (event) => {
  if (!avatarMenu || !avatarDropdown) return;
  if (avatarMenu.classList.contains("is-visible") && !avatarDropdown.contains(event.target)) {
    closeAvatarMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAvatarMenu();
  }
});

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value === "approved" || value === "completed") return "status-approved";
  if (value === "pending") return "status-pending";
  if (value === "cancelled" || value === "rejected") return "status-cancelled";
  return "status-default";
}

async function renderBookings() {
  if (!currentUser) return;

  bookingsContainer.innerHTML = "";
  const rows = Object.entries(allBookings)
    .filter(([, booking]) => booking.labUID === currentUser.uid && String(booking.status || "").toLowerCase() === currentStatus)
    .sort((a, b) => Number(b[1].createdAt || 0) - Number(a[1].createdAt || 0));

  if (rows.length === 0) {
    bookingsContainer.innerHTML = `<p>No ${getBookingStatusLabel(currentStatus)} lab bookings.</p>`;
    return;
  }

  for (const [bookingId, booking] of rows) {
    const patientName = booking.patientName || "Patient";
    const patientPhone = booking.patientPhone || "N/A";

    const card = document.createElement("div");
    card.className = "appointment-card";
    const paymentStatus = booking.payment?.status || "unpaid";
    const paymentMethod = booking.payment?.method || booking.payment?.preference || "";
    const paymentSummary = `${paymentStatus}${paymentMethod ? ` (${paymentMethod})` : ""}`;

    const resultBox = `
      <div class="working-hours-box" style="margin-top:10px;">
        <label for="summary-${bookingId}">Result Summary</label>
        <textarea id="summary-${bookingId}" placeholder="Add observations and key result points">${booking.resultSummary || ""}</textarea>
        <label for="url-${bookingId}">Report URL (Drive/PDF link)</label>
        <input id="url-${bookingId}" type="url" placeholder="https://..." value="${booking.resultUrl || ""}">
        <button type="button" class="view-btn save-result-btn" data-id="${bookingId}">Save Result</button>
      </div>
    `;

    card.innerHTML = `
      <p><strong>Patient:</strong> ${patientName}</p>
      <p><strong>Phone:</strong> ${patientPhone}</p>
      <p><strong>Test:</strong> ${booking.testName || "N/A"}</p>
      <p><strong>Amount:</strong> Rs. ${Number(booking.testPrice || booking.payment?.amount || 0)}</p>
      <p><strong>Date:</strong> ${booking.date || "N/A"}</p>
      <p><strong>Time:</strong> ${booking.time || "N/A"}</p>
      <p><strong>Status:</strong> <span class="status-pill ${statusClass(booking.status)}">${booking.status || "N/A"}</span></p>
      <p><strong>Payment:</strong> ${paymentSummary}</p>
      <p><strong>Notes:</strong> ${booking.notes || "-"}</p>
      ${booking.status === "approved" ? `<button type="button" class="approve-btn mark-completed-btn" data-id="${bookingId}">Mark Completed</button>` : ""}
      ${booking.status !== "cancelled" ? `<button type="button" class="reject-btn cancel-booking-btn" data-id="${bookingId}">Cancel</button>` : ""}
      ${booking.status === "completed" ? resultBox : (booking.resultSummary || booking.resultUrl ? resultBox : "")}
      ${booking.resultUploadedAt ? `<p><strong>Result Updated:</strong> ${new Date(Number(booking.resultUploadedAt)).toLocaleString()}</p>` : ""}
      ${booking.resultUrl ? `<p><a href="${booking.resultUrl}" target="_blank" rel="noopener noreferrer">Open Uploaded Report</a></p>` : ""}
    `;

    bookingsContainer.appendChild(card);
  }

  bindActions();
}

function bindActions() {
  document.querySelectorAll(".mark-completed-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const bookingId = btn.dataset.id;
      try {
        await update(ref(db, "labBookings/" + bookingId), { status: "completed" });
      } catch (error) {
        console.error(error);
        alert("Unable to update status.");
      }
    });
  });

  document.querySelectorAll(".cancel-booking-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const bookingId = btn.dataset.id;
      try {
        await update(ref(db, "labBookings/" + bookingId), { status: "cancelled" });
      } catch (error) {
        console.error(error);
        alert("Unable to cancel booking.");
      }
    });
  });

  document.querySelectorAll(".save-result-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const bookingId = btn.dataset.id;
      const summary = String(document.getElementById(`summary-${bookingId}`)?.value || "").trim();
      const resultUrl = String(document.getElementById(`url-${bookingId}`)?.value || "").trim();

      if (!summary && !resultUrl) {
        alert("Please add summary or report URL.");
        return;
      }

      try {
        await update(ref(db, "labBookings/" + bookingId), {
          resultSummary: summary,
          resultUrl,
          resultUploadedAt: Date.now(),
          status: "completed"
        });
        await recordLabReportEntry(bookingId, allBookings[bookingId], summary, resultUrl);
        alert(resultUrl
          ? "Result saved. Share the report link with the patient if needed."
          : "Result saved successfully.");
      } catch (error) {
        console.error(error);
        alert("Unable to save result.");
      }
    });
  });
}

async function recordLabReportEntry(bookingId, booking, summary, resultUrl) {
  if (!currentUser || !booking) return;
  const formattedSummary = String(summary || "").trim();
  const formattedUrl = String(resultUrl || "").trim();
  if (!formattedSummary && !formattedUrl) return;

  const payload = {
    patientUID: booking.patientUID,
    patientName: booking.patientName || "",
    labUID: currentUser.uid,
    labName: labDetails?.labName || booking.labName || "",
    bookingId,
    testName: booking.testName || "",
    summary: formattedSummary,
    url: formattedUrl,
    message: formattedSummary || `Your report for ${booking.testName || "the requested test"} is ready.`,
    createdAt: Date.now()
  };

  const reportRef = push(ref(db, "labReports"));
  await set(reportRef, payload);
}

function updateStats() {
  if (!currentUser) return;

  const rows = Object.values(allBookings).filter((booking) => booking.labUID === currentUser.uid);
  totalBookingsEl.textContent = String(rows.length);
  pendingBookingsEl.textContent = String(rows.filter((item) => item.status === "approved").length);
  completedBookingsEl.textContent = String(rows.filter((item) => item.status === "completed").length);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const userSnap = await get(ref(db, "users/" + user.uid));
  if (!userSnap.exists() || String(userSnap.val().role || "").toLowerCase() !== "lab") {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;

  const labRef = ref(db, "labs/" + user.uid);
  const labSnap = await get(labRef);
  if (!labSnap.exists()) {
    alert("Please setup your lab profile first.");
    window.location.href = "lab-profile.html";
    return;
  }

  applyLabProfile(labSnap.val(), user);

  onValue(labRef, (snapshot) => {
    if (!snapshot.exists()) {
      window.location.href = "lab-profile.html";
      return;
    }

    applyLabProfile(snapshot.val(), user);
  });

  const labBookingsQuery = query(ref(db, "labBookings"), orderByChild("labUID"), equalTo(user.uid));
  onValue(labBookingsQuery, (snapshot) => {
    allBookings = snapshot.exists() ? snapshot.val() : {};
    updateStats();
    renderBookings();
  }, (error) => {
    console.error("Unable to load lab bookings", error);
    allBookings = {};
    updateStats();
    renderBookings();
  });
});
