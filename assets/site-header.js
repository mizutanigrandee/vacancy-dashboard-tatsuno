// assets/site-header.js — たつの・相生版 共通ヘッダー
(() => {
  const script = document.currentScript;
  const active = script?.dataset?.active || "calendar";

  const BASE = "https://mizutanigrandee.github.io/vacancy-dashboard-tatsuno/";

  const MENU = [
    { id: "calendar", label: "料金カレンダー", path: BASE }
  ];

  const CFG = {
    logo: "assets/banner3.png",
    title: "めちゃいいツール",
    menu: MENU
  };

  const hdr = document.createElement("header");
  hdr.className = "site-header";
  hdr.innerHTML = `
    <div class="wrap">
      <a class="brand" href="${BASE}">
        <img src="${CFG.logo}" alt="${CFG.title} logo" decoding="async" />
        <strong>${CFG.title}</strong>
      </a>
      <button class="menu-toggle" aria-label="メニュー" aria-expanded="false">☰</button>
      <nav class="site-nav" role="navigation" aria-label="Main">
        ${CFG.menu.map(m => `<a href="${m.path}" data-mid="${m.id}">${m.label}</a>`).join("")}
      </nav>
    </div>
  `;

  const existing = document.querySelector("header.site-header");
  if (existing) existing.replaceWith(hdr);
  else document.body.prepend(hdr);

  hdr.querySelectorAll(".site-nav a").forEach(a => {
    const id = a.getAttribute("data-mid");
    if (active === id) {
      a.classList.add("is-active");
      a.setAttribute("aria-current", "page");
    }
  });

  const toggle = hdr.querySelector(".menu-toggle");
  const navEl = hdr.querySelector(".site-nav");

  if (toggle && navEl) {
    const OPEN = "open";
    const closeMenu = () => {
      navEl.classList.remove(OPEN);
      toggle.setAttribute("aria-expanded", "false");
    };

    const onToggle = e => {
      e.stopPropagation();
      navEl.classList.toggle(OPEN);
      toggle.setAttribute(
        "aria-expanded",
        navEl.classList.contains(OPEN) ? "true" : "false"
      );
    };

    toggle.addEventListener("pointerup", onToggle);
    toggle.addEventListener("click", onToggle);

    document.addEventListener(
      "pointerdown",
      e => {
        if (!hdr.contains(e.target)) setTimeout(closeMenu, 0);
      },
      { passive: true }
    );
  }
})();
