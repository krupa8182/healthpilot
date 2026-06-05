import { auth, db } from "./firebase-client.js";
import { ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const list = document.getElementById("appointmentsList");

// listen to all appointments
onValue(ref(db, "appointments"), (snapshot) => {

    list.innerHTML = "";

    if (!snapshot.exists()) {
        list.innerHTML = "<p>No appointment requests</p>";
        return;
    }

    snapshot.forEach(child => {
        const appt = child.val();

        list.innerHTML += `
            <div class="appt-card">
                <p><b>Patient:</b> ${appt.patientId}</p>
                <p><b>Doctor:</b> ${appt.doctorName}</p>
                <p><b>Date:</b> ${appt.date}</p>
                <p><b>Status:</b> ${appt.status}</p>

                <button class="acceptBtn" data-id="${child.key}">Accept</button>
                <button class="rejectBtn" data-id="${child.key}">Reject</button>
            </div>
        `;
    });
});


// accept or reject
document.addEventListener("click", (e) => {

    if (e.target.classList.contains("acceptBtn")) {
        const id = e.target.dataset.id;
        update(ref(db, "appointments/" + id), { status: "approved" });
    }

    if (e.target.classList.contains("rejectBtn")) {
        const id = e.target.dataset.id;
        update(ref(db, "appointments/" + id), { status: "rejected" });
    }
});
