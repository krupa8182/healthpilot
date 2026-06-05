import { auth, db } from "./firebase-client.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const getStartedBtn = document.getElementById("getStartedBtn");

if (getStartedBtn) {
  getStartedBtn.addEventListener("click", () => {
    // Check if user is authenticated
    const user = auth.currentUser;
    if (user) {
      // User is logged in, redirect based on role
      get(ref(db, "users/" + user.uid)).then((snapshot) => {
        if (snapshot.exists()) {
          const role = snapshot.val().role.toLowerCase();
          switch (role) {
            case "patient":
              window.location.href = "patient-dashboard.html";
              break;
            case "doctor":
              window.location.href = "doctor-dashboard.html";
              break;
            case "lab":
              window.location.href = "lab-dashboard.html";
              break;
            case "admin":
              window.location.href = "admin-dashboard.html";
              break;
            default:
              window.location.href = "login.html";
          }
        } else {
          window.location.href = "login.html";
        }
      }).catch(() => {
        window.location.href = "login.html";
      });
    } else {
      // User not logged in, go to login
      window.location.href = "login.html";
    }
  });
}

// Auto-redirect authenticated users to their dashboard
onAuthStateChanged(auth, (user) => {
  if (user) {
    get(ref(db, "users/" + user.uid)).then((snapshot) => {
      if (snapshot.exists()) {
        const role = snapshot.val().role.toLowerCase();
        let redirectUrl = "login.html";

        switch (role) {
          case "patient":
            redirectUrl = "patient-dashboard.html";
            break;
          case "doctor":
            redirectUrl = "doctor-dashboard.html";
            break;
          case "lab":
            redirectUrl = "lab-dashboard.html";
            break;
          case "admin":
            redirectUrl = "admin-dashboard.html";
            break;
        }

        // Only redirect if not already on the correct page
        if (!window.location.href.includes(redirectUrl.split('.')[0])) {
          window.location.href = redirectUrl;
        }
      }
    }).catch(console.error);
  }
});
