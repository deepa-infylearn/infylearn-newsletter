/* Infylearn: adds a "Back" link to listmonk's public pages (Settings -> Appearance -> Public JS).
   listmonk's subscribe, archive and login pages have no way back to where the visitor came from.
   The link is shown only when the previous page was on this same site, so people arriving from an
   external signup link are not sent to the admin home page. */
(function () {
  function addBackLink() {
    var header = document.querySelector(".wrap > .header");
    if (!header || header.querySelector(".back-link")) return;

    var cameFromHere = document.referrer && document.referrer.indexOf(window.location.origin + "/") === 0 &&
      document.referrer !== window.location.href;
    if (!cameFromHere) return;

    var link = document.createElement("a");
    link.className = "back-link";
    link.href = document.referrer;
    link.textContent = "← Back";
    link.addEventListener("click", function (event) {
      if (window.history.length > 1) {
        event.preventDefault();
        window.history.back();
      }
    });
    header.appendChild(link);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addBackLink);
  } else {
    addBackLink();
  }
})();
