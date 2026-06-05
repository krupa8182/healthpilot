document.addEventListener("DOMContentLoaded", () => {
  removeLegacyButtons();
});

function removeLegacyButtons() {
  document.querySelectorAll(".custom-back-btn, .back-link, [data-flow-nav-generated='true']").forEach((element) => {
    element.remove();
  });
}
