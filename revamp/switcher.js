/* Shared version + screen switcher for the Pointo frontend reworks.
   Each page sets <body data-version="v2-kronos" data-screen="dashboard">.
   The nav bar is injected at the top of every page so you can jump between
   the 5 versions and the 4 screens without editing anything. */
(function () {
  const VERSIONS = [
    { id: "v1-editorial",       label: "1 · Éditorial" },
    { id: "v2-kronos",          label: "2 · Kronos" },
    { id: "v3-landscape",       label: "3 · Landscape" },
    { id: "v4-softlight",       label: "4 · Aurora" },
    { id: "v5-terminal",        label: "5 · Terminal" },
    { id: "v6-kronos-artifact", label: "6 · Kronos Artifact" },
    { id: "v7-cosmos",          label: "7 · Cosmos" },
  ];
  const SCREENS = [
    { id: "landing",   label: "Accueil" },
    { id: "login",     label: "Connexion" },
    { id: "dashboard", label: "Employé" },
    { id: "admin",     label: "Admin" },
  ];

  const body = document.body;
  const curVersion = body.getAttribute("data-version") || "v1-editorial";
  const curScreen = body.getAttribute("data-screen") || "landing";

  const rel = (versionId, screenId) => `../${versionId}/${screenId}.html`;

  const nav = document.createElement("nav");
  nav.className = "rework-switcher";
  nav.setAttribute("aria-label", "Sélecteur de version et d'écran");

  const versionBtns = VERSIONS.map((v) => {
    const active = v.id === curVersion;
    return `<a class="rsw-btn${active ? " is-active" : ""}" href="${rel(v.id, curScreen)}"
      ${active ? 'aria-current="true"' : ""}>${v.label}</a>`;
  }).join("");

  const screenBtns = SCREENS.map((s) => {
    const active = s.id === curScreen;
    return `<a class="rsw-tab${active ? " is-active" : ""}" href="${rel(curVersion, s.id)}"
      ${active ? 'aria-current="true"' : ""}>${s.label}</a>`;
  }).join("");

  nav.innerHTML = `
    <div class="rsw-inner">
      <span class="rsw-brand">Pointo · <b>Reworks</b></span>
      <div class="rsw-group rsw-versions">${versionBtns}</div>
      <span class="rsw-sep" aria-hidden="true"></span>
      <div class="rsw-group rsw-screens">${screenBtns}</div>
      <a class="rsw-home" href="../index.html" title="Vue d'ensemble">⌂</a>
    </div>`;

  body.insertBefore(nav, body.firstChild);

  // Keyboard: 1-5 switch version, arrows switch screen.
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    const vi = VERSIONS.findIndex((v) => v.id === curVersion);
    const si = SCREENS.findIndex((s) => s.id === curScreen);
    if (e.key >= "1" && e.key <= "7") {
      const v = VERSIONS[Number(e.key) - 1];
      if (v) location.href = rel(v.id, curScreen);
    } else if (e.key === "ArrowRight") {
      location.href = rel(curVersion, SCREENS[(si + 1) % SCREENS.length].id);
    } else if (e.key === "ArrowLeft") {
      location.href = rel(curVersion, SCREENS[(si - 1 + SCREENS.length) % SCREENS.length].id);
    }
  });
})();
