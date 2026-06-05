import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const container = document.getElementById("doctorAppointments");

onAuthStateChanged(auth, (user) => {
  if (!container || !user) return;

  const appointmentsRef = ref(db, "appointments");

  onValue(appointmentsRef, async (snapshot) => {
    container.innerHTML = "";

    snapshot.forEach(async (child) => {
      const appt = child.val();

      if (appt.doctorUID !== user.uid) return;

      // get patient info
      const patientSnap = await get(ref(db, "users/" + appt.patientUID));
      const patient = patientSnap.val();

      const card = document.createElement("div");
      card.style.border = "1px solid #ccc";
      card.style.margin = "10px";
      card.style.padding = "10px";
      card.style.borderRadius = "6px";
      card.style.background = "#fff";

      const status = appt.status || "pending";

      const info = document.createElement("div");
      info.innerHTML = `
        <b>Patient:</b> ${patient?.name || "Unknown"} <br>
        <b>Date:</b> ${appt.date || "N/A"} <br>
        <b>Time:</b> ${appt.time || "N/A"} <br>
        <b>Status:</b> ${status}
      `;

      const actions = document.createElement("div");
      actions.style.marginTop = "8px";
      actions.style.display = "flex";
      actions.style.gap = "8px";

      const setStatus = async (newStatus) => {
        const payload = {
          status: newStatus,
          updatedAt: Date.now(),
          updatedBy: "doctor"
        };

        if (newStatus === "approved") {
          payload.approvedAt = Date.now();
        }

        if (newStatus === "rejected") {
          payload.rejectedAt = Date.now();
          payload.rejectedBy = "doctor";
        }

        if (newStatus === "cancelled") {
          payload.cancelledAt = Date.now();
          payload.cancelledBy = "doctor";
        }

        try {
          await update(ref(db, `appointments/${child.key}`), payload);
        } catch (error) {
          console.error("Failed to update appointment status", error);
          alert("Could not update the appointment status. Please try again.");
        }
      };

      const createButton = (label, colour, statusValue) => {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.type = "button";
        btn.style.padding = "6px 12px";
        btn.style.border = "none";
        btn.style.borderRadius = "4px";
        btn.style.cursor = "pointer";
        btn.style.backgroundColor = colour;
        btn.style.color = "#fff";
        btn.addEventListener("click", () => setStatus(statusValue));
        return btn;
      };

      if (status === "pending") {
        actions.appendChild(createButton("Approve", "#0b7a34", "approved"));
        actions.appendChild(createButton("Reject", "#b12222", "rejected"));
      } else if (status === "approved") {
        actions.appendChild(createButton("Cancel", "#b12222", "cancelled"));
      }

      card.appendChild(info);
      card.appendChild(actions);
      container.appendChild(card);
    });
  });
});
