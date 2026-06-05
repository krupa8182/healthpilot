import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, onValue, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const doctorCache = new Map();
const NOTIFICATION_READ_KEY_PREFIX = "hp_patient_notification_reads";
let currentUserId = "";
let currentNotifications = [];

function getReadStorageKey(userId) {
  return `${NOTIFICATION_READ_KEY_PREFIX}_${userId}`;
}

function loadReadNotifications(userId) {
  if (!userId) return {};
  try {
    const raw = window.localStorage.getItem(getReadStorageKey(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveReadNotifications(userId, readMap) {
  if (!userId) return;
  try {
    window.localStorage.setItem(getReadStorageKey(userId), JSON.stringify(readMap));
  } catch {
    // ignore storage errors
  }
}

function isNotificationRead(userId, item) {
  const readMap = loadReadNotifications(userId);
  return Boolean(readMap?.[item.id]);
}

function markNotificationsRead(userId, items = []) {
  if (!userId || !items.length) return;
  const readMap = loadReadNotifications(userId);
  items.forEach((item) => {
    if (!item?.id) return;
    readMap[item.id] = Number(item.createdAt || Date.now());
  });
  saveReadNotifications(userId, readMap);
}

function ensureNotificationUI() {
  const headerActions = document.querySelector(".header-actions");
  if (!headerActions) return null;

  let wrapper = document.getElementById("patientNotifications");
  if (wrapper) return wrapper;

  wrapper = document.createElement("div");
  wrapper.className = "patient-notification-dropdown";
  wrapper.id = "patientNotifications";
  wrapper.innerHTML = `
    <button
      type="button"
      class="notification-btn"
      id="patientNotificationBtn"
      aria-label="Open notifications"
      aria-haspopup="true"
      aria-expanded="false"
    >
      <span class="notification-bell" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2Z"></path>
        </svg>
      </span>
      <span class="notification-badge is-hidden" id="patientNotificationBadge">0</span>
    </button>
    <div class="notification-panel" id="patientNotificationPanel" role="dialog" aria-label="Notifications">
      <div class="notification-panel-head">
        <h3>Notifications</h3>
      </div>
      <div class="notification-list" id="patientNotificationList">
        <p class="notification-empty">No notifications yet.</p>
      </div>
    </div>
  `;

  const avatarDropdown = document.getElementById("userAvatarDropdown");
  if (avatarDropdown) {
    headerActions.insertBefore(wrapper, avatarDropdown);
  } else {
    headerActions.appendChild(wrapper);
  }

  const button = wrapper.querySelector("#patientNotificationBtn");
  const panel = wrapper.querySelector("#patientNotificationPanel");

  button?.addEventListener("click", (event) => {
    event.stopPropagation();
    const shouldOpen = !panel?.classList.contains("is-visible");
    panel?.classList.toggle("is-visible", shouldOpen);
    button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    if (shouldOpen) {
      markNotificationsRead(currentUserId, currentNotifications);
      renderNotifications(currentNotifications, currentUserId);
    }
  });

  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target)) {
      panel?.classList.remove("is-visible");
      button?.setAttribute("aria-expanded", "false");
    }
  });

  return wrapper;
}

async function getDoctorContact(doctorUID) {
  if (!doctorUID) return { name: "Doctor", phone: "N/A" };
  if (doctorCache.has(doctorUID)) return doctorCache.get(doctorUID);

  let contact = { name: "Doctor", phone: "N/A" };

  try {
    const userSnap = await get(ref(db, `users/${doctorUID}`));
    if (userSnap.exists()) {
      const data = userSnap.val() || {};
      contact = {
        name: data.name || "Doctor",
        phone: data.phone || "N/A"
      };
    } else {
      const doctorSnap = await get(ref(db, `doctors/${doctorUID}`));
      if (doctorSnap.exists()) {
        const data = doctorSnap.val() || {};
        contact = {
          name: data.name || "Doctor",
          phone: data.phone || "N/A"
        };
      }
    }
  } catch (error) {
    console.error("Unable to load doctor contact for notification", error);
  }

  doctorCache.set(doctorUID, contact);
  return contact;
}

async function buildCancellationNotifications(appointments = []) {
  const cancelledByDoctor = appointments.filter((appointment) => {
    const status = String(appointment?.status || "").toLowerCase();
    const cancelledBy = String(appointment?.cancelledBy || appointment?.updatedBy || "").toLowerCase();
    return status === "cancelled" && cancelledBy === "doctor";
  });

  return Promise.all(
    cancelledByDoctor.map(async (appointment) => {
      const contact = await getDoctorContact(appointment.doctorUID);
      return {
        id: appointment.id,
        createdAt: Number(appointment.cancelledAt || appointment.updatedAt || appointment.createdAt || 0),
        message: `Your appointment is cancelled by doctor please contact that doctor by their phone number for refund or further appointment.`,
        phone: contact.phone || "N/A",
        doctorName: contact.name || "Doctor",
        date: appointment.date || "N/A",
        time: appointment.time || "N/A"
      };
    })
  );
}

function renderNotifications(items = [], userId = "") {
  const list = document.getElementById("patientNotificationList");
  const badge = document.getElementById("patientNotificationBadge");
  if (!list || !badge) return;

  list.innerHTML = "";

  if (!items.length) {
    list.innerHTML = `<p class="notification-empty">No notifications yet.</p>`;
    badge.textContent = "0";
    badge.classList.add("is-hidden");
    return;
  }

  const unreadCount = items.filter((item) => !isNotificationRead(userId, item)).length;
  badge.textContent = String(unreadCount);
  badge.classList.toggle("is-hidden", unreadCount === 0);

  items
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
    .forEach((item) => {
      const row = document.createElement("article");
      row.className = "notification-item";
      row.innerHTML = `
        <p class="notification-message">${item.message}</p>
        <p class="notification-meta"><strong>Doctor:</strong> Dr. ${item.doctorName}</p>
        <p class="notification-meta"><strong>Phone:</strong> ${item.phone}</p>
        <p class="notification-meta"><strong>Date:</strong> ${item.date}</p>
        <p class="notification-meta"><strong>Time:</strong> ${item.time}</p>
      `;
      list.appendChild(row);
    });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUserId = user.uid;

  const wrapper = ensureNotificationUI();
  if (!wrapper) return;

  const userSnapshot = await get(ref(db, `users/${user.uid}`));
  const role = userSnapshot.exists() ? String(userSnapshot.val().role || "").toLowerCase() : "";
  if (role && role !== "patient") {
    wrapper.remove();
    return;
  }

  const appointmentsRef = query(ref(db, "appointments"), orderByChild("patientUID"), equalTo(user.uid));
  onValue(appointmentsRef, async (snapshot) => {
    if (!snapshot.exists()) {
      renderNotifications([]);
      return;
    }

    const appointments = Object.entries(snapshot.val() || {}).map(([id, data]) => ({
      id,
      ...data
    }));
    const notifications = await buildCancellationNotifications(appointments);
    currentNotifications = notifications;
    renderNotifications(currentNotifications, currentUserId);
  }, (error) => {
    console.error("Unable to load patient notifications", error);
    currentNotifications = [];
    renderNotifications([], currentUserId);
  });
});
