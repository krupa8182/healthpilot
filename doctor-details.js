import { db, auth } from "./firebase-client.js";
import { ref, get, push, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const doctorContainer = document.getElementById("doctorContainer");
const reviewsContainer = document.getElementById("reviewsContainer");
const reviewForm = document.getElementById("reviewForm");
const ratingInput = document.getElementById("rating");
const commentInput = document.getElementById("comment");

const params = new URLSearchParams(window.location.search);
const doctorUID = params.get("uid");

async function loadDoctor() {
  try {
    const snapshot = await get(ref(db, "doctors/" + doctorUID));

    if (!snapshot.exists()) {
      doctorContainer.innerHTML = "<p>Doctor not found</p>";
      return;
    }

    const doctor = snapshot.val();
    const status = String(doctor.status || "approved").toLowerCase();
    if (doctor.profileComplete !== true) {
      doctorContainer.innerHTML = "<p>Doctor profile is incomplete.</p>";
      return;
    }

    doctorContainer.innerHTML = `
      <h3>Dr. ${doctor.name}</h3>
      ${doctor.image ? `<img src="${doctor.image}" class="doctor-photo" alt="${doctor.name}">` : ""}
      <p><b>Specialization:</b> ${doctor.specialization}</p>
      <p><b>Clinic:</b> ${doctor.clinic}</p>
      <p><b>Experience:</b> ${doctor.experience} years</p>
      <p><b>Consultation Fee:</b> &#8377;${doctor.fee}</p>
      <p><b>Location:</b> <span class="location-pin">&#128205;</span> ${doctor.location}</p>
      <div class="doctor-actions">
        <button id="mapBtn" type="button"><span class="location-pin">&#128205;</span> View Clinic on Map</button>
        ${status === "approved" ? `<button id="bookBtn" type="button">Book Appointment</button>` : `<p class="empty-state">Profile awaiting approval.</p>`}
      </div>
    `;

    const mapBtn = document.getElementById("mapBtn");
    const bookBtn = document.getElementById("bookBtn");

    if (mapBtn) {
      mapBtn.addEventListener("click", () => openMap(doctor.location));
    }

    if (bookBtn) {
      bookBtn.addEventListener("click", () => {
        window.location.href = `booking-appointment.html?uid=${doctorUID}`;
      });
    }
  } catch (error) {
    console.error(error);
    doctorContainer.innerHTML = "<p>Error loading doctor</p>";
  }
}

loadDoctor();

function loadReviews() {
  const reviewsRef = ref(db, "reviews/" + doctorUID);

  onValue(reviewsRef, (snapshot) => {
    reviewsContainer.innerHTML = "";

    if (!snapshot.exists()) {
      reviewsContainer.innerHTML = "<p>No reviews yet</p>";
      return;
    }

    snapshot.forEach((child) => {
      const review = child.val();
      const div = document.createElement("div");

      div.innerHTML = `
        <p><b>Rating:</b> ${"*".repeat(Number(review.rating || 0))}</p>
        <p>${review.comment || ""}</p>
        <hr>
      `;

      reviewsContainer.appendChild(div);
    });
  });
}

loadReviews();

reviewForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = auth.currentUser;
  if (!user) {
    alert("Please login first");
    return;
  }

  const rating = ratingInput.value;
  const comment = commentInput.value;

  await push(ref(db, "reviews/" + doctorUID), {
    patientUID: user.uid,
    rating,
    comment
  });

  alert("Review submitted!");
  reviewForm.reset();
});

function openMap(location) {
  const mapURL =
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(location);
  window.open(mapURL, "_blank");
}
