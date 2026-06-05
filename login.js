import { auth, db } from "./firebase-client.js";
import {
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    applyActionCode,
    checkActionCode,
    setPersistence,
    browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, set, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const emailSuggestions = document.getElementById("emailSuggestions");
const params = new URLSearchParams(window.location.search);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_STORAGE_KEY = "hp_recent_emails";
const PENDING_VERIFICATION_EMAIL_KEY = "hp_pending_verification_email";
const PENDING_REGISTRATION_KEY = "hp_pending_registration";
if (form) {
    form.reset();
}

if (emailInput) {
    emailInput.value = "";
    emailInput.autocomplete = "email";
}

if (passwordInput) {
    passwordInput.value = "";
    passwordInput.autocomplete = "current-password";
}

document.querySelectorAll("[data-password-toggle]").forEach((toggleBtn) => {
    const targetId = toggleBtn.getAttribute("data-password-toggle");
    const targetInput = targetId ? document.getElementById(targetId) : null;
    if (!targetInput) return;

    toggleBtn.addEventListener("click", () => {
        const isVisible = targetInput.type === "text";
        targetInput.type = isVisible ? "password" : "text";
        toggleBtn.classList.toggle("is-visible", !isVisible);
        toggleBtn.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
        toggleBtn.setAttribute("aria-pressed", isVisible ? "false" : "true");
    });
});

function loadEmailSuggestions() {
    if (!emailSuggestions) return;
    emailSuggestions.innerHTML = "";
    let stored = [];
    try {
        stored = JSON.parse(localStorage.getItem(EMAIL_STORAGE_KEY) || "[]");
    } catch (error) {
        stored = [];
    }
    stored
        .filter((value) => EMAIL_REGEX.test(String(value || "")))
        .forEach((email) => {
            const option = document.createElement("option");
            option.value = email;
            emailSuggestions.appendChild(option);
        });
}

function rememberEmail(email) {
    if (!EMAIL_REGEX.test(email)) return;
    let stored = [];
    try {
        stored = JSON.parse(localStorage.getItem(EMAIL_STORAGE_KEY) || "[]");
    } catch (error) {
        stored = [];
    }
    const next = [email, ...stored.filter((item) => item !== email)].slice(0, 5);
    localStorage.setItem(EMAIL_STORAGE_KEY, JSON.stringify(next));
    loadEmailSuggestions();
}

function loadPendingRegistration(email = "") {
    try {
        const raw = localStorage.getItem(PENDING_REGISTRATION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const pendingEmail = String(parsed?.email || "").trim().toLowerCase();
        const targetEmail = String(email || "").trim().toLowerCase();
        if (targetEmail && pendingEmail !== targetEmail) return null;
        return parsed;
    } catch (error) {
        return null;
    }
}

function clearPendingRegistration() {
    localStorage.removeItem(PENDING_REGISTRATION_KEY);
}

function hasRecordedVerification(profileData) {
    if (!profileData || typeof profileData !== "object") return false;
    if (profileData.emailVerificationRequired === false) return true;
    return Boolean(profileData.verifiedAt);
}

function getSignedInUser(user) {
    return user || auth.currentUser || null;
}

async function syncVerifiedProfile(user, profileData = null) {
    if (!user?.uid || !profileData) return;
    if (profileData.emailVerificationRequired === false && profileData.verifiedAt) return;

    await update(ref(db, `users/${user.uid}`), {
        email: String(user.email || profileData.email || "").trim().toLowerCase(),
        emailVerificationRequired: false,
        verifiedAt: profileData.verifiedAt || Date.now()
    });
}

async function promotePendingRegistration(user) {
    const pendingData = loadPendingRegistration(user.email);
    if (!pendingData) {
        return false;
    }

    await set(ref(db, `users/${user.uid}`), {
        name: pendingData.name || user.displayName || "",
        phone: pendingData.phone || "",
        role: pendingData.role || "patient",
        email: String(user.email || "").trim().toLowerCase(),
        specialization: pendingData.specialization || "",
        clinicCode: pendingData.clinicCode || "",
        linkedDoctorUID: pendingData.linkedDoctorUID || "",
        status: pendingData.status || "active",
        createdAt: pendingData.createdAt || Date.now(),
        emailVerificationRequired: false,
        verifiedAt: Date.now()
    });
    clearPendingRegistration();
    return true;
}

window.addEventListener("load", () => {
    handleVerificationRedirect();
});

async function handleVerificationRedirect() {
    if (form) form.reset();
    if (emailInput) emailInput.value = "";
    if (passwordInput) passwordInput.value = "";
    // Some browsers autofill after load; clear again shortly after.
    setTimeout(() => {
        if (emailInput) emailInput.value = "";
        if (passwordInput) passwordInput.value = "";
    }, 200);
    loadEmailSuggestions();

    const mode = params.get("mode");
    const oobCode = params.get("oobCode");

    if (mode === "verifyEmail" && oobCode) {
        try {
            const info = await checkActionCode(auth, oobCode);
            const verifiedEmail = String(info?.data?.email || "").trim().toLowerCase();
            await applyActionCode(auth, oobCode);
            if (verifiedEmail) {
                sessionStorage.setItem(PENDING_VERIFICATION_EMAIL_KEY, verifiedEmail);
                if (emailInput && !emailInput.value) {
                    emailInput.value = verifiedEmail;
                }
            }
            alert("Your email has been verified. Please log in.");
        } catch (error) {
            const message = String(error?.message || "").toLowerCase();
            if (message.includes("expired") || message.includes("invalid")) {
                alert("This verification link is invalid or expired. If your email is already verified, try logging in normally.");
            } else {
                alert(error?.message || "Unable to complete email verification right now.");
            }
        } finally {
            window.history.replaceState({}, document.title, "login.html");
        }
        return;
    }

    if (params.get("verified") === "1") {
        const pendingEmail = sessionStorage.getItem(PENDING_VERIFICATION_EMAIL_KEY);
        if (pendingEmail && emailInput && !emailInput.value) {
            emailInput.value = pendingEmail;
        }
        alert("Your email has been verified. Please log in.");
        sessionStorage.removeItem(PENDING_VERIFICATION_EMAIL_KEY);
        window.history.replaceState({}, document.title, "login.html");
    }
}

if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener("click", async () => {
        const email = String(emailInput?.value || "").trim().toLowerCase();
        if (!EMAIL_REGEX.test(email)) {
            alert("Please enter your email above, then click Forgot Password.");
            return;
        }

        try {
            await sendPasswordResetEmail(auth, email);
            alert(`Password reset email sent to ${email}. Check Inbox/Spam.`);
        } catch (error) {
            const code = String(error?.code || "").toLowerCase();
            if (code.includes("user-not-found")) {
                alert("No account found with this email.");
                return;
            }
            if (code.includes("invalid-email")) {
                alert("Please enter a valid email address.");
                return;
            }
            alert(error?.message || "Unable to send reset email. Please try again.");
        }
    });
}

function hasDoctorProfileBasics(doctorData) {
    if (!doctorData) return false;

    const requiredFields = ["name", "specialization", "clinic", "experience", "fee", "location"];
    return requiredFields.every((field) => String(doctorData[field] || "").trim() !== "");
}

function hasLabProfileBasics(labData) {
    if (!labData) return false;

    const requiredFields = ["labName", "contactName", "phone", "location"];
    const hasRequiredFields = requiredFields.every((field) => String(labData[field] || "").trim() !== "");
    const hasTests = Boolean(labData.tests && Object.keys(labData.tests).length > 0);
    const hasAvailability = Boolean(labData.availability && labData.availability.start && labData.availability.end);

    return hasRequiredFields && hasTests && hasAvailability;
}

form.addEventListener("submit", async function(e) {
    e.preventDefault();

    const email = document.getElementById("email").value.trim().toLowerCase();
    const password = document.getElementById("password").value;

    if (!EMAIL_REGEX.test(email)) {
        alert("Please enter a valid email address.");
        return;
    }

    try {
        await setPersistence(auth, browserSessionPersistence);
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = getSignedInUser(userCredential.user);
        if (!user) {
            throw new Error("Unable to confirm the signed-in account. Please try again.");
        }
        rememberEmail(email);
        let snapshot = await get(ref(db, "users/" + user.uid));
        let profileData = snapshot.exists() ? snapshot.val() : null;

        if (!snapshot.exists()) {
            const promoted = await promotePendingRegistration(user);
            if (promoted) {
                snapshot = await get(ref(db, "users/" + user.uid));
                profileData = snapshot.exists() ? snapshot.val() : null;
            }
        } else if (user.emailVerified && profileData && !hasRecordedVerification(profileData)) {
            await syncVerifiedProfile(user, profileData);
            snapshot = await get(ref(db, "users/" + user.uid));
            profileData = snapshot.exists() ? snapshot.val() : profileData;
        }

        if (snapshot.exists()) {
            sessionStorage.removeItem(PENDING_VERIFICATION_EMAIL_KEY);
            clearPendingRegistration();
            const data = snapshot.val();
            const role = (data.role || "").toLowerCase();

            if (role === "patient") {
                window.location.href = "patient-dashboard.html";
            }
            else if (role === "doctor") {
                const doctorSnapshot = await get(ref(db, "doctors/" + user.uid));
                const doctorData = doctorSnapshot.exists() ? doctorSnapshot.val() : null;
                const profileReady = hasDoctorProfileBasics(doctorData);

                window.location.href = profileReady
                    ? "doctor-dashboard.html"
                    : "doctor-profile.html";
            }
            else if (role === "lab") {
                const labSnapshot = await get(ref(db, "labs/" + user.uid));
                const labData = labSnapshot.exists() ? labSnapshot.val() : null;
                const profileReady = hasLabProfileBasics(labData);
                window.location.href = profileReady
                    ? "lab-dashboard.html"
                    : "lab-profile.html";
            }
            else if (role === "clinic_staff") {
                window.location.href = "clinic-staff-dashboard.html";
            }
            else if (role === "admin") {
                window.location.href = "admin-dashboard.html";
            }
            else {
                alert("Role not found!");
            }

        } else {
            alert("We couldn't find your profile in the database. Please complete it once.");
            window.location.href = "register.html?recover=1";
        }
    } catch (error) {
        const message = String(error?.message || "");
        const code = String(error?.code || "").toLowerCase();
        const normalized = message.toLowerCase();

        if (
            code.includes("permission-denied") ||
            code.includes("permission_denied") ||
            normalized.includes("permission denied") ||
            normalized.includes("permission_denied")
        ) {
            alert("Access denied by database rules. Deploy the latest database rules, then try login again.");
            return;
        }
        alert(message || "Login failed. Please try again.");
    }
});
