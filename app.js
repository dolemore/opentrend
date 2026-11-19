/* OpenTrend — client app (Dusk theme)
   Static data: /data/trending.json, /data/hf.json, /data/repos.json
   i18n: pre-translated in /data/i18n/<lang>.json (built by scripts/build-i18n.js)
*/
(function () {
  "use strict";

  /* ── Languages ─────────────────────────────────────── */

  const LANGS = [
    { code: "en", label: "English", flag: "🇬🇧" },
    { code: "tr", label: "Türkçe", flag: "🇹🇷" },
    { code: "de", label: "Deutsch", flag: "🇩🇪" },
    { code: "fr", label: "Français", flag: "🇫🇷" },
    { code: "es", label: "Español", flag: "🇪🇸" },
    { code: "pt", label: "Português", flag: "🇵🇹" },
    { code: "it", label: "Italiano", flag: "🇮🇹" },
    { code: "ru", label: "Русский", flag: "🇷🇺" },
    { code: "zh", label: "中文", flag: "🇨🇳" },
    { code: "ja", label: "日本語", flag: "🇯🇵" },
    { code: "ar", label: "العربية", flag: "🇸🇦" },
    { code: "hi", label: "हिन्दी", flag: "🇮🇳" },
  ];

  const DYN_EN = Object.assign({}, window.OT_DYN || {});

  const state = {
    lang: "en",
    gh: { since: "daily", items: null },
    hf: { type: "models", byType: {}, active: 0 },
    col: { id: null, items: null, notes: null, title: "" },
  };

  const DATA = { trending: null, hf: null, repos: null };

  let I18N = {};
  let DYN_CUR = Object.assign({}, DYN_EN);
  let staticSources = [];

  /* ── Helpers ───────────────────────────────────────── */

  const $ = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(n) {
    const raw = Number(String(n).replace(/,/g, ""));
    if (!Number.isFinite(raw)) return "0";
    const v = Math.round(raw);
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return String(v);
  }

  function digits(s) {
    return String(s == null ? "" : s).replace(/[^\d]/g, "");
  }

  function t(key) {
    return DYN_CUR[key] || DYN_EN[key] || key;
  }

  function tr(source) {
    return I18N[source] || source;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
  }

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + " -> " + res.status);
    return res.json();
  }

  const LANG_COLORS = {
    JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5",
    Rust: "#dea584", Go: "#00ADD8", Java: "#b07219", "C++": "#f34b7d",
    C: "#555555", "C#": "#178600", Kotlin: "#A97BFF", Swift: "#F05138",
    Dart: "#00B4AB", Ruby: "#701516", PHP: "#4F5D95", Shell: "#89e051",
    HTML: "#e34c26", CSS: "#563d7c", Lua: "#000080", Elixir: "#6e4a7e",
    Zig: "#ec915c", Vue: "#41b883", SCSS: "#c6538c", Julia: "#a270ca",
  };

  function langDot(lang) {
    if (!lang) return "";
    const color = LANG_COLORS[lang] || "#4f8cff";
    return '<span class="lang-dot" style="--dot:' + color + '"></span>';
  }

  /* ── i18n ──────────────────────────────────────────── */

  function collectStaticSources() {
    staticSources = [];
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (!el.dataset.orig) el.dataset.orig = el.textContent.trim();
      staticSources.push(el.dataset.orig);
    });
  }

  function collectionTitles() {
    return (window.COLLECTIONS || []).map((c) => c.title);
  }

  function applyStatic() {
    document.querySelectorAll("[data-orig]").forEach((el) => {
      el.textContent = tr(el.dataset.orig);
    });
  }

  async function setLanguage(lang) {
    state.lang = lang;
    try { localStorage.setItem("ot-lang", lang); } catch (e) {}

    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    $("#langLabel").textContent = lang.toUpperCase();
    document.querySelectorAll("#langMenu li").forEach((li) => {
      li.setAttribute("aria-selected", String(li.dataset.lang === lang));
    });

    if (lang === "en") {
      I18N = {};
      DYN_CUR = Object.assign({}, DYN_EN);
      applyStatic();
      renderAll();
      return;
    }

    try {
      const cache = await getJSON("/data/i18n/" + lang + ".json");
      I18N = cache;
      DYN_CUR = {};
      Object.keys(DYN_EN).forEach((k) => {
        DYN_CUR[k] = cache[DYN_EN[k]] || DYN_EN[k];
      });
      applyStatic();
      renderAll();
    } catch (err) {
      I18N = {};
      DYN_CUR = Object.assign({}, DYN_EN);
      applyStatic();
      renderAll();
      toast(t("trErr"));
    }
  }

  function buildLangMenu() {
    const menu = $("#langMenu");
    const btn = $("#langBtn");
    const saved = (() => {
      try { return localStorage.getItem("ot-lang"); } catch (e) { return null; }
    })();
    const initial = LANGS.some((l) => l.code === saved) ? saved : "en";

    LANGS.forEach((l) => {
      const li = document.createElement("li");
      li.dataset.lang = l.code;
      li.setAttribute("role", "option");
      li.innerHTML =
        '<span class="flag">' + l.flag + "</span>" +
        "<span>" + esc(l.label) + "</span>" +
        '<span class="code">' + l.code.toUpperCase() + "</span>";
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        closeMenu();
        if (l.code !== state.lang) setLanguage(l.code);
      });
      menu.appendChild(li);
    });

    function openMenu() {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    }
    function closeMenu() {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
    btn.addEventListener("click", () => {
      menu.hidden ? openMenu() : closeMenu();
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        menu.hidden ? openMenu() : closeMenu();
      } else if (e.key === "Escape") {
        closeMenu();
      }
    });
    document.addEventListener("click", (e) => {
      if (!menu.hidden && !btn.contains(e.target)) closeMenu();
    });

    return initial;
  }

  /* ── Renderers ─────────────────────────────────────── */

  function nameHTML(r) {
    const repo = r.repo || "";
    const idx = repo.indexOf("/");
    if (idx < 0) return esc(repo);
    return '<span class="owner">' + esc(repo.slice(0, idx + 1)) + "</span>" + esc(repo.slice(idx + 1));
  }

  function ghRow(r, i) {
    const href = r.url || "https://github.com/" + r.repo;
    const avatar = r.avatar || "https://github.com/" + (r.owner || String(r.repo).split("/")[0]) + ".png?size=80";
    const meta = [];
    if (r.language) {
      meta.push('<span class="m m-lang">' + langDot(r.language) + esc(r.language) + "</span>");
    }
    if (r.stars != null && r.stars !== "") {
      meta.push('<span class="m num">★ ' + fmt(r.stars) + "</span>");
    }
    if (r.starsPeriod && digits(r.starsPeriod)) {
      meta.push('<span class="m m-hot num">+' + fmt(digits(r.starsPeriod)) + " " +
        esc(t(state.gh.since === "weekly" ? "week" : "today")) + "</span>");
    }
    if (r.forks != null && r.forks !== "") {
      meta.push('<span class="m m-fork num">⑂ ' + fmt(r.forks) + " " + esc(t("forks")) + "</span>");
    }
    return (
      '<a class="run-row" style="--i:' + i + '" href="' + esc(href) + '" target="_blank" rel="noopener">' +
        '<span class="run-rank">' + (i + 1) + "</span>" +
        '<img class="run-avatar" src="' + esc(avatar) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
        '<span class="run-main"><span class="run-name-line"><span class="run-name">' + nameHTML(r) + "</span></span>" +
        (r.description ? '<span class="run-desc">' + esc(r.description) + "</span>" : "") +
        "</span>" +
        '<span class="run-meta">' + meta.join("") + "</span>" +
      "</a>"
    );
  }

  function colRow(r, i, note) {
    const href = r.url || "https://github.com/" + r.repo;
    const avatar = r.avatar || "https://github.com/" + (r.owner || String(r.repo).split("/")[0]) + ".png?size=80";
    const meta = [];
    if (r.language) {
      meta.push('<span class="m m-lang">' + langDot(r.language) + esc(r.language) + "</span>");
    }
    if (r.stars != null && r.stars !== "") {
      meta.push('<span class="m num">★ ' + fmt(r.stars) + "</span>");
    }
    const noteHTML = note ? '<span class="row-note">' + esc(note) + "</span>" : "";
    return (
      '<a class="run-row" style="--i:' + i + '" href="' + esc(href) + '" target="_blank" rel="noopener">' +
        '<span class="run-rank">' + (i + 1) + "</span>" +
        '<img class="run-avatar" src="' + esc(avatar) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
        '<span class="run-main"><span class="run-name-line"><span class="run-name">' + nameHTML(r) + "</span>" + noteHTML + "</span>" +
        (r.description ? '<span class="run-desc">' + esc(r.description) + "</span>" : "") +
        "</span>" +
        '<span class="run-meta">' + meta.join("") + "</span>" +
      "</a>"
    );
  }

  function heroRows() {
    const list = $("#heroRows");
    if (!list) return;
    const items = (DATA.trending && DATA.trending.daily) || [];
    if (!items.length) {
      list.innerHTML = '<li class="grow-row" style="--i:0"><span class="g-main"><span class="g-name">—</span></span></li>';
      return;
    }
    list.innerHTML = items.slice(0, 5).map((r, i) => {
      const gain = r.starsPeriod && digits(r.starsPeriod)
        ? '<span class="g-gain num">+' + fmt(digits(r.starsPeriod)) + " " + esc(t("today")) + "</span>"
        : "";
      return (
        '<li class="grow-row" style="--i:' + i + '">' +
          '<span class="g-rank num">' + (i + 1) + "</span>" +
          '<span class="g-main"><span class="g-name">' + esc(r.repo) + "</span></span>" +
          gain +
        "</li>"
      );
    }).join("");
  }

  function renderGH() {
    const list = $("#ghList");
    const items = state.gh.items;
    if (!items) return;
    if (!items.length) { list.innerHTML = '<div class="empty">' + esc(t("noGh")) + "</div>"; return; }
    list.innerHTML = items.map((r, i) => ghRow(r, i)).join("");
    $("#statTrending").textContent = String(items.length);
  }

  function hfLine(item) {
    const type = state.hf.type;
    if (type === "models") return [item.pipeline, item.library].filter(Boolean).join(" · ");
    if (type === "datasets") return item.description || "";
    return item.sdk ? "SDK: " + item.sdk : "";
  }

  function hfRow(item, i) {
    const active = i === state.hf.active;
    const score = item.trendingScore != null ? fmt(item.trendingScore) : "";
    return (
      '<li class="tour-row' + (active ? " is-active" : "") + '" data-idx="' + i + '" role="button" tabindex="0" style="--i:' + i + '">' +
        '<span class="t-dot" aria-hidden="true"></span>' +
        '<span class="t-main"><span class="t-name">' + esc(item.id) + "</span>" +
        '<span class="t-desc">' + esc(hfLine(item) || "—") + "</span></span>" +
        '<span class="t-score num" title="' + esc(t("score")) + '">' + score + "</span>" +
      "</li>"
    );
  }

  function renderHFPane() {
    const pane = $("#hfPane");
    const items = state.hf.byType[state.hf.type] || [];
    const item = items[state.hf.active];
    if (!item) { pane.innerHTML = ""; return; }

    const badge = t(state.hf.type === "models" ? "models" : state.hf.type === "datasets" ? "datasets" : "spaces");
    const line = hfLine(item);
    const seen = new Set();
    const tags = (item.tags || [])
      .filter((x) => !/^(license:|region:|arxiv:|base_model:|library_name:|transformers|safetensors)/.test(x))
      .filter((x) => (seen.has(x) ? false : (seen.add(x), true)))
      .slice(0, 4)
      .map((x) => '<span class="pane-tag">' + esc(x) + "</span>")
      .join("");

    pane.innerHTML =
      '<div class="pane-badge">' + esc(badge) + "</div>" +
      '<div class="pane-id">' + esc(item.id) + "</div>" +
      (line ? '<div class="pane-line">' + esc(line) + "</div>" : "") +
      '<div class="pane-statement"><span class="num">' + fmt(item.trendingScore || 0) + '</span><span class="lbl">' + esc(t("score")) + "</span></div>" +
      '<div class="pane-figures">' +
        '<div class="pane-figrow"><span class="pf-label">' + esc(t("likes")) + '</span><span class="pf-val">' + fmt(item.likes || 0) + "</span></div>" +
        '<div class="pane-figrow"><span class="pf-label">' + esc(t("downloads")) + '</span><span class="pf-val">' + fmt(item.downloads || 0) + "</span></div>" +
      "</div>" +
      (tags ? '<div class="pane-tags">' + tags + "</div>" : "") +
      '<div class="pane-open"><a class="btn btn-ghost" href="' + esc(item.url) + '" target="_blank" rel="noopener">' + esc(t("openHf")) + "</a></div>";
  }

  function renderHF() {
    const list = $("#hfList");
    const items = state.hf.byType[state.hf.type];
    if (!items) return;
    if (!items.length) {
      list.innerHTML = '<li class="empty">' + esc(t("noHf")) + "</li>";
      $("#hfPane").innerHTML = "";
      return;
    }
    if (state.hf.active >= items.length) state.hf.active = 0;
    list.innerHTML = items.slice(0, 10).map((it, i) => hfRow(it, i)).join("");
    renderHFPane();
    const total = ["models", "datasets", "spaces"].reduce(
      (sum, k) => sum + (DATA.hf && DATA.hf[k] ? DATA.hf[k].length : 0), 0
    );
    $("#statHF").textContent = String(total);
  }

  function renderCol() {
    const list = $("#colList");
    const desc = $("#colDesc");
    const items = state.col.items;
    if (!items) return;
    const title = state.col.title ? tr(state.col.title) : "";
    desc.textContent = items.length + " " + t("repos") + (title ? " · " + title : "");
    if (!items.length) { list.innerHTML = '<div class="empty">' + esc(t("noCol")) + "</div>"; return; }
    list.innerHTML = items
      .map((r, i) => colRow(r, i, state.col.notes[r.repo] || null))
      .join("");
  }

  function renderStamp() {
    const el = $("#dataStamp");
    if (!el) return;
    const ga = DATA.trending && DATA.trending.generatedAt;
    if (!ga) { el.textContent = ""; return; }
    const when = String(ga).slice(0, 16).replace("T", " ") + " UTC";
    el.textContent = t("updated") + " · " + when;
  }

  function renderAll() {
    renderGH();
    renderHF();
    renderCol();
    heroRows();
    renderStamp();
    document.querySelectorAll("#colTabs .tab, #colTabs .rtab").forEach((b) => {
      if (b.dataset.orig) b.textContent = tr(b.dataset.orig);
    });
  }

  function setStaticStats() {
    const cols = window.COLLECTIONS || [];
    $("#statCol").textContent = String(cols.length);
    $("#statCurated").textContent = String(cols.reduce((s, c) => s + c.repos.length, 0));
  }

  /* ── Data loading ──────────────────────────────────── */

  async function loadData() {
    const [trending, hf, reposFile] = await Promise.all([
      getJSON("/data/trending.json").catch(() => null),
      getJSON("/data/hf.json").catch(() => null),
      getJSON("/data/repos.json").catch(() => null),
    ]);
    if (!trending || !hf || !reposFile) toast(t("errNet"));

    DATA.trending = trending;
    DATA.hf = hf;
    DATA.repos = reposFile && reposFile.repos ? reposFile.repos : {};

    if (trending) state.gh.items = trending[state.gh.since] || [];
    else state.gh.items = [];

    if (hf) {
      state.hf.byType = { models: hf.models || [], datasets: hf.datasets || [], spaces: hf.spaces || [] };
    } else {
      state.hf.byType = { models: [], datasets: [], spaces: [] };
    }

    loadCollection(state.col.id || ((window.COLLECTIONS || [])[0] || {}).id, true);
    renderAll();
  }

  function loadCollection(id, silent) {
    const col = (window.COLLECTIONS || []).find((c) => c.id === id);
    if (!col) return;
    state.col.id = id;
    state.col.title = col.title;
    state.col.notes = {};
    col.repos.forEach((r) => { state.col.notes[r.repo] = r.note || null; });

    const names = col.repos.map((r) => r.repo);
    const byName = DATA.repos || {};
    state.col.items = names.map((n) => {
      const hit = byName[n.toLowerCase()];
      return hit || { repo: n, owner: n.split("/")[0], description: "", stars: null };
    });
    if (!silent) renderCol();
  }

  /* ── Tabs & interactions ───────────────────────────── */

  function wireTabs(container, dataAttr, onPick) {
    if (!container) return;
    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".rtab, .tab");
      if (!btn) return;
      container.querySelectorAll(".rtab, .tab").forEach((b) => {
        const active = b === btn;
        b.classList.toggle("active", active);
        b.setAttribute("aria-selected", String(active));
      });
      onPick(btn.dataset[dataAttr]);
    });
  }

  function buildColTabs() {
    const box = $("#colTabs");
    box.innerHTML = "";
    (window.COLLECTIONS || []).forEach((c, i) => {
      const b = document.createElement("button");
      b.className = "rtab" + (i === 0 ? " active" : "");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(i === 0));
      b.dataset.col = c.id;
      b.dataset.orig = c.title;
      b.textContent = tr(c.title);
      box.appendChild(b);
    });
  }

  function wireTour() {
    const list = $("#hfList");
    const pick = (el) => {
      const idx = Number(el.dataset.idx);
      if (!Number.isFinite(idx) || idx === state.hf.active) {
        if (Number.isFinite(idx)) return;
      }
      state.hf.active = idx;
      renderHF();
    };
    list.addEventListener("click", (e) => {
      const row = e.target.closest(".tour-row");
      if (row) pick(row);
    });
    list.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const row = e.target.closest(".tour-row");
        if (row) { e.preventDefault(); pick(row); }
      }
    });
  }

  function onScroll() {
    const header = $("#siteHeader");
    if (header) header.classList.toggle("is-slate", window.scrollY > 30);
  }

  /* ── Init ──────────────────────────────────────────── */

  function init() {
    $("#year").textContent = String(new Date().getFullYear());
    collectStaticSources();

    const initialLang = buildLangMenu();
    buildColTabs();
    setStaticStats();

    wireTabs($("#ghTabs"), "since", (since) => {
      state.gh.since = since;
      if (DATA.trending) {
        state.gh.items = DATA.trending[since] || [];
        renderGH();
      }
    });
    wireTabs($("#hfTabs"), "type", (type) => {
      state.hf.type = type;
      state.hf.active = 0;
      if (DATA.hf) renderHF();
    });
    wireTabs($("#colTabs"), "col", (id) => loadCollection(id));
    wireTour();

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    setLanguage(initialLang);
    loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
