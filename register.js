import { auth, db } from "./firebase-client.js?v=20260324b";
import {
    createUserWithEmailAndPassword,
    updateProfile,
    sendEmailVerification,
    signOut,
    onAuthStateChanged,
    deleteUser,
    reload,
    getIdTokenResult
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, set, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const form = document.getElementById("registerForm");
const roleInput = document.getElementById("role");
const clinicStaffWrap = document.getElementById("clinicStaffWrap");
const clinicCodeInput = document.getElementById("clinicCode");
const passwordInput = document.getElementById("password");
const emailInput = document.getElementById("email");
const nameInput = document.getElementById("name");
const phoneInput = document.getElementById("phone");
const statusEl = document.getElementById("emailVerificationStatus");
const verificationWaitPanel = document.getElementById("verificationWaitPanel");
const verificationWaitTitle = document.getElementById("verificationWaitTitle");
const verificationWaitMessage = document.getElementById("verificationWaitMessage");
const submitBtn = form?.querySelector("button[type='submit']");
const params = new URLSearchParams(window.location.search);
const recoverMode = params.get("recover") === "1";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INDIAN_PHONE_10_DIGIT_REGEX = /^[6-9]\d{9}$/;
const PENDING_VERIFICATION_EMAIL_KEY = "hp_pending_verification_email";
const PENDING_REGISTRATION_KEY = "hp_pending_registration";

let recoverUser = null;
let verificationPollId = null;

if (recoverMode) {
    const heading = document.querySelector(".hero h2");
    if (heading) heading.textContent = "Complete Your Profile";
    if (passwordInput) {
        passwordInput.required = false;
        passwordInput.placeholder = "Password not required for profile completion";
        passwordInput.value = "";
    }
} else {
    if (form) form.reset();
    if (nameInput) nameInput.value = "";
    if (emailInput) emailInput.value = "";
    if (phoneInput) phoneInput.value = "";
    if (passwordInput) passwordInput.value = "";
    if (roleInput) roleInput.value = "patient";
    if (clinicCodeInput) clinicCodeInput.value = "";
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

function setStatus(message, variant) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("success", variant === "success");
    statusEl.classList.toggle("error", variant === "error");
    statusEl.classList.toggle("is-hidden", !message);
}

function setVerificationWaitState(isVisible, email = "") {
    if (!verificationWaitPanel) return;
    verificationWaitPanel.classList.toggle("is-hidden", !isVisible);
    if (!isVisible) return;

    if (verificationWaitTitle) {
        verificationWaitTitle.textContent = "Verify from your phone";
    }
    if (verificationWaitMessage) {
        verificationWaitMessage.textContent = email
            ? `A verification link was sent to ${email}. Open that link on your phone or any other device to verify email.`
            : "Open the verification link from your email to verify email.";
    }
}

function syncVerificationWaitingUi(isWaiting) {
    if (!submitBtn) return;
    submitBtn.disabled = isWaiting;
    submitBtn.textContent = isWaiting
        ? "Waiting For Verification..."
        : (recoverMode ? "Save Profile" : "Register");
}

function normalizeIndianPhone(rawPhone) {
    const digits = String(rawPhone || "").replace(/\D/g, "");

    if (INDIAN_PHONE_10_DIGIT_REGEX.test(digits)) {
        return `+91${digits}`;
    }

    if (digits.length === 12 && digits.startsWith("91")) {
        const tenDigit = digits.slice(2);
        if (INDIAN_PHONE_10_DIGIT_REGEX.test(tenDigit)) {
            return `+91${tenDigit}`;
        }
    }

    return null;
}

function syncSpecializationVisibility() {
    const role = String(roleInput?.value || "").toLowerCase();
    const isClinicStaff = role === "clinic_staff";

    if (clinicStaffWrap) {
        clinicStaffWrap.classList.toggle("is-hidden", !isClinicStaff);
    }

    if (clinicCodeInput) {
        clinicCodeInput.required = isClinicStaff;
        clinicCodeInput.disabled = !isClinicStaff;
        if (!isClinicStaff) clinicCodeInput.value = "";
    }
}

function getVerificationContinueUrl() {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.hostname === "127.0.0.1" || currentUrl.hostname === "localhost") {
        return "https://healthpilot-1da94.firebaseapp.com/login.html?verified=1";
    }
    return new URL("login.html?verified=1", currentUrl).toString();
}

function stopVerificationWatcher() {
    if (verificationPollId) {
        window.clearInterval(verificationPollId);
        verificationPollId = null;
    }
    setVerificationWaitState(false);
}

async function isAuthEmailVerified(user) {
    if (!user) return false;

    let tokenVerified = false;
    try {
        const tokenResult = await getIdTokenResult(user, true);
        tokenVerified = Boolean(tokenResult?.claims?.email_verified);
    } catch (error) {
        tokenVerified = false;
    }

    return Boolean(user.emailVerified) || tokenVerified;
}

function startVerificationWatcher(user, email) {
    stopVerificationWatcher();
    setVerificationWaitState(true, email);
    syncVerificationWaitingUi(true);
    setStatus(
        `Verification link sent to ${email}. Open it on your phone or any other device to verify email.`,
        "success"
    );

    verificationPollId = window.setInterval(async () => {
        try {
            if (!auth.currentUser || auth.currentUser.uid !== user.uid) {
                stopVerificationWatcher();
                return;
            }

            await reload(auth.currentUser);
            if (!(await isAuthEmailVerified(auth.currentUser))) {
                return;
            }

            stopVerificationWatcher();
            await signOut(auth);
            alert("Email verified successfully. This laptop will now open the login page.");
            window.location.href = "login.html?verified=1";
        } catch (error) {
            console.error("Verification polling failed", error);
        }
    }, 4000);
}

async function savePendingRegistration(user, registrationData) {
    const payload = {
        uid: user.uid,
        email: String(user.email || "").trim().toLowerCase(),
        ...registrationData,
        emailVerificationRequired: true,
        createdAt: Date.now(),
    };
    localStorage.setItem(PENDING_REGISTRATION_KEY, JSON.stringify(payload));
}

function clearPendingRegistration() {
    localStorage.removeItem(PENDING_REGISTRATION_KEY);
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

async function resolveLinkedDoctorUID(clinicCode) {
    const normalizedClinicCode = String(clinicCode || "").trim().toUpperCase();
    if (!normalizedClinicCode) return null;

    const doctorsSnap = await get(ref(db, "doctors"));
    if (!doctorsSnap.exists()) return null;

    let linkedDoctorUID = null;
    doctorsSnap.forEach((child) => {
        if (linkedDoctorUID) return;
        const doctorData = child.val() || {};
        const doctorCode = String(doctorData.clinicCode || "").trim().toUpperCase();
        if (doctorCode && doctorCode === normalizedClinicCode) {
            linkedDoctorUID = child.key;
        }
    });

    return linkedDoctorUID;
}

async function sendVerificationEmail(user) {
    auth.useDeviceLanguage();
    const continueUrl = getVerificationContinueUrl();

    try {
        await sendEmailVerification(user, {
            url: continueUrl,
            handleCodeInApp: false
        });
    } catch (error) {
        const code = String(error?.code || "").toLowerCase();
        if (
            code.includes("invalid-continue-uri") ||
            code.includes("missing-continue-uri") ||
            code.includes("unauthorized-continue-uri")
        ) {
            await sendEmailVerification(user);
            return;
        }
        throw error;
    }
}

if (roleInput) {
    roleInput.addEventListener("change", syncSpecializationVisibility);
    syncSpecializationVisibility();
}

if (phoneInput) {
    phoneInput.addEventListener("input", () => {
        const digits = phoneInput.value.replace(/\D/g, "").slice(0, 10);
        phoneInput.value = digits;
    });
}

if (emailInput) {
    emailInput.addEventListener("input", () => {
        if (!recoverMode) {
            setStatus("A verification link will be sent after you register.", null);
        }
    });
}

if (!recoverMode) {
    const pendingEmail = sessionStorage.getItem(PENDING_VERIFICATION_EMAIL_KEY);
    const pendingRegistration = loadPendingRegistration(pendingEmail || "");
    setStatus(
        pendingEmail && pendingRegistration
            ? `Verification link already sent to ${pendingEmail}. Open your inbox, click the link, then log in.`
            : "A verification link will be sent after you register.",
        pendingEmail && pendingRegistration ? "success" : null
    );
    setVerificationWaitState(false);
    syncVerificationWaitingUi(false);
}

if (recoverMode) {
    onAuthStateChanged(auth, (user) => {
        recoverUser = user;
        if (!user) return;
        if (nameInput && !nameInput.value) nameInput.value = user.displayName || "";
        if (emailInput) {
            emailInput.value = user.email || "";
            emailInput.readOnly = true;
        }
    });
}

if (!recoverMode) {
    onAuthStateChanged(auth, async (user) => {
        const pendingRegistration = loadPendingRegistration();
        if (!user || !pendingRegistration) {
            stopVerificationWatcher();
            syncVerificationWaitingUi(false);
            return;
        }

        try {
            await reload(user);
            if (await isAuthEmailVerified(user)) {
                stopVerificationWatcher();
                await signOut(auth);
                window.location.href = "login.html?verified=1";
                return;
            }

            startVerificationWatcher(
                user,
                String(pendingRegistration.email || user.email || "").trim().toLowerCase()
            );
        } catch (error) {
            console.error("Unable to restore verification watcher", error);
        }
    });
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (typeof form.reportValidity === "function" && !form.reportValidity()) {
        return;
    }

    const name = String(nameInput?.value || "").trim();
    const rawPhone = String(phoneInput?.value || "").trim();
    const role = String(roleInput?.value || "").toLowerCase();
    const email = String(emailInput?.value || "").trim().toLowerCase();
    const password = passwordInput ? passwordInput.value : "";
    const clinicCode = clinicCodeInput ? clinicCodeInput.value.trim() : "";
    const phone = normalizeIndianPhone(rawPhone);

    if (!name || !rawPhone || !role || !email || (!recoverMode && !password)) {
        alert("Please fill in all required fields.");
        return;
    }

    if (!EMAIL_REGEX.test(email)) {
        alert("Please enter a valid email address.");
        return;
    }

    if (!phone) {
        alert("Please enter a valid Indian phone number.");
        return;
    }

    let user = null;
    let verificationSent = false;
    let waitingForVerification = false;

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = recoverMode ? "Saving..." : "Registering...";
        }
        setStatus("Submitting your registration request...", null);

        if (recoverMode) {
            if (!recoverUser) {
                alert("Please login again to complete your profile.");
                window.location.href = "login.html";
                return;
            }
            user = recoverUser;
        } else {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            user = userCredential.user;
        }

        let linkedDoctorUID = null;
        if (role === "clinic_staff") {
            if (!clinicCode) {
                alert("Clinic staff must provide a clinic code from their doctor.");
                return;
            }

            linkedDoctorUID = await resolveLinkedDoctorUID(clinicCode);
            if (!linkedDoctorUID) {
                if (!recoverMode && user) {
                    try {
                        await deleteUser(user);
                    } catch (cleanupError) {
                        console.error("Failed to delete invalid clinic staff account", cleanupError);
                    }
                }
                alert("Invalid clinic code. Please check with your doctor for the correct code.");
                return;
            }
        }

        await updateProfile(user, { displayName: name });

        const status = role === "patient" ? "active" : "pending";
        const registrationData = {
            name,
            phone,
            role,
            specialization: "",
            clinicCode: role === "clinic_staff" ? clinicCode : "",
            linkedDoctorUID: role === "clinic_staff" ? linkedDoctorUID : "",
            status
        };

        if (!recoverMode) {
            await savePendingRegistration(user, registrationData);
            await sendVerificationEmail(user);
            verificationSent = true;
            sessionStorage.setItem(PENDING_VERIFICATION_EMAIL_KEY, email);
            waitingForVerification = true;
            startVerificationWatcher(user, email);
            if (passwordInput) passwordInput.value = "";
            alert(
                `Registration successful. A verification link was sent to ${email}. Open the email on your phone or another device. This laptop will move to the login page automatically after verification completes.`
            );
            return;
        }

        await set(ref(db, `users/${user.uid}`), {
            ...registrationData,
            email,
            createdAt: Date.now(),
            emailVerificationRequired: false
        });

        alert("Profile saved. You can continue.");
        if (role === "patient") {
            window.location.href = "patient-dashboard.html";
        } else if (role === "doctor") {
            window.location.href = "doctor-profile.html";
        } else if (role === "lab") {
            window.location.href = "lab-profile.html";
        } else if (role === "clinic_staff") {
            window.location.href = "clinic-staff-dashboard.html";
        } else {
            window.location.href = "index.html";
        }
    } catch (error) {
        console.error(error);
        const currentUser = auth.currentUser;
        if (!recoverMode && currentUser && !verificationSent) {
            try {
                clearPendingRegistration();
                await deleteUser(currentUser);
            } catch (cleanupError) {
                console.error("Failed to clean up partial registration", cleanupError);
            }
        }
        const code = String(error?.code || "").toLowerCase();
        const message = String(error?.message || "Unable to complete registration right now.");

        if (code.includes("email-already-in-use")) {
            const existingAccountMessage =
                "This email is already registered in Firebase Authentication. Open the latest verification email for that account, then log in. If it is already verified, go to Login directly.";
            setStatus(existingAccountMessage, "error");
            alert(existingAccountMessage);
            return;
        }

        if (code.includes("weak-password")) {
            const weakPasswordMessage = "Password is too short for Firebase Authentication. Please use at least 6 characters.";
            setStatus(weakPasswordMessage, "error");
            alert(weakPasswordMessage);
            return;
        }

        setStatus(message, "error");
        alert(message);
    } finally {
        syncVerificationWaitingUi(waitingForVerification);
    }
});
