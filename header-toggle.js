document.addEventListener("DOMContentLoaded", () => {
  const headerButtons = document.querySelectorAll(".header-actions [data-role]");
  const body = document.body;

  const setActive = (role) => {
    headerButtons.forEach((btn) => {
      if (btn.dataset.role === role) {
        btn.classList.add("btn-active");
      } else {
        btn.classList.remove("btn-active");
      }
    });
  };

  headerButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      setActive(btn.dataset.role);
    });
  });

  const initial = body.getAttribute("data-active-header");
  if (initial) {
    setActive(initial);
  }
});
