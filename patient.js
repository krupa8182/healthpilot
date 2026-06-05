import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// protect page
onAuthStateChanged(auth, (user) => {

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    loadPatientData(user.uid);
});

// load patient info
function loadPatientData(uid) {

    const userRef = ref(db, "users/" + uid);

    get(userRef).then((snapshot) => {
        if (snapshot.exists()) {

            const data = snapshot.val();

            document.getElementById("patientName").innerText = data.name;
            document.getElementById("patientEmail").innerText = data.email;
            document.getElementById("patientPhone").innerText = data.phone;

        } else {
            alert("No patient data found!");
        }
    }).catch((error) => {
        console.error(error);
    });
}

// logout (outside the function)
document.getElementById("logoutBtn").addEventListener("click", () => {
    signOut(auth).then(() => {
        window.location.href = "login.html";
    }).catch((error) => {
        alert("Error logging out");
    });
});
