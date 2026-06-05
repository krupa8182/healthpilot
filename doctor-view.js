import { db } from "./firebase-client.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const params = new URLSearchParams(window.location.search);
const doctorUID = params.get("uid");

const name = document.getElementById("doctorName");
const specialization = document.getElementById("specialization");
const clinic = document.getElementById("clinic");
const experience = document.getElementById("experience");
const fee = document.getElementById("fee");

const bookBtn = document.getElementById("bookBtn");

const doctorRef = ref(db, "doctors/" + doctorUID);

get(doctorRef).then((snapshot)=>{

    if(snapshot.exists()){

        const data = snapshot.val();

        name.innerText = "Dr. " + data.name;
        specialization.innerText = data.specialization;
        clinic.innerText = data.clinic;
        experience.innerText = data.experience;
        fee.innerText = data.fee;

    }

});

bookBtn.addEventListener("click", ()=>{

    window.location.href = `booking-appointment.html?uid=${doctorUID}`;

});
