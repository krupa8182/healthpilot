import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const list = document.getElementById("appointmentsContainer");

onAuthStateChanged(auth, (user) => {
  if (!user) return;

  const appointmentsRef = ref(db, "appointments");

  onValue(appointmentsRef, async (snapshot) => {
    list.innerHTML = "";

    const promises = [];

    snapshot.forEach((child) => {
      const appt = child.val();

      if (appt.patientUID === user.uid) {

        const p = get(ref(db, "doctors/" + appt.doctorUID))
          .then((doctorSnap) => {
            const doctor = doctorSnap.val();

            const div = document.createElement("div");
            div.classList.add("appointment-card");

            div.innerHTML = `
              <b>Doctor:</b> ${doctor?.name || "Unknown"} <br>
              <b>Date:</b> ${appt.date} <br>
              <b>Time:</b> ${appt.time} <br>
              <b>Status:</b> ${appt.status}
            `;

            list.appendChild(div);
          });

        promises.push(p);
      }
    });

    await Promise.all(promises);
  });
});
