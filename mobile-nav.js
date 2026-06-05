const toggleBtn = document.querySelector(".mobile-nav-toggle");
const navBar = document.querySelector(".patient-nav-bar");

if (toggleBtn && navBar) {
  const closeNav = () => {
    navBar.classList.remove("open");
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.textContent = "Menu";
  };

  const openNav = () => {
    navBar.classList.add("open");
    toggleBtn.setAttribute("aria-expanded", "true");
    toggleBtn.textContent = "Close";
  };

  toggleBtn.addEventListener("click", () => {
    if (navBar.classList.contains("open")) {
      closeNav();
    } else {
      openNav();
    }
  });

  navBar.addEventListener("click", (event) => {
    if (window.innerWidth <= 900 && event.target.closest("a, button")) {
      closeNav();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) {
      navBar.classList.remove("open");
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.textContent = "Menu";
    }
  });
}
