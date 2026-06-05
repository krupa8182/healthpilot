const footerMarkup = `
  <footer class="site-footer" aria-label="Site footer">
    <div class="site-footer__shell">
      <div class="site-footer__top">
        <section class="site-footer__brandblock">
          <p class="site-footer__eyebrow">HealthPilot platform</p>
          <h3 class="site-footer__logo">HealthPilot</h3>
          <p class="site-footer__summary">Digital healthcare journeys for appointments, lab bookings, approvals, and follow-up that feel clearer for every role.</p>
          <div class="site-footer__badges" aria-label="HealthPilot highlights">
            <span>Doctor bookings</span>
            <span>Lab coordination</span>
            <span>Role dashboards</span>
          </div>
        </section>

        <nav class="site-footer__nav" aria-label="Footer navigation">
          <a href="index.html">Home</a>
          <a href="doctors.html">Doctors</a>
          <a href="labs.html">Labs</a>
          <a href="patient-dashboard.html#appointments">Appointments</a>
        </nav>

        <section class="site-footer__contact">
          <p class="site-footer__contact-title">Need help?</p>
          <a href="mailto:support@healthpilot.com">support@healthpilot.com</a>
          <a href="tel:+919876543210">+91 98765 43210</a>
          <p class="site-footer__contact-copy">Built to keep patients, clinics, and labs aligned with less back-and-forth.</p>
        </section>
      </div>

      <div class="site-footer__bottom">
        <p class="site-footer__legal">&copy; ${new Date().getFullYear()} HealthPilot. All rights reserved.</p>
        <div class="site-footer__meta">
          <a href="index.html">Privacy</a>
          <a href="index.html">Terms</a>
          <a href="index.html#care-journey">Platform flow</a>
        </div>
      </div>
    </div>
  </footer>
`;

function injectSiteFooter() {
  if (typeof document === "undefined") return;
  if (document.querySelector(".site-footer")) return;
  document.body.insertAdjacentHTML("beforeend", footerMarkup);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", injectSiteFooter, { once: true });
} else {
  injectSiteFooter();
}
