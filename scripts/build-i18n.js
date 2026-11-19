/**
 * Pre-translates every UI string into the 11 non-English site languages and
 * writes data/i18n/<lang>.json ({ source: translation }).
 *
 * Engine chain (same as bookiq-web/api/translate.js):
 *   LibreTranslate public instances → Google gtx → MyMemory,
 * with brand-name protection (GitHub, HuggingFace, OpenTrend, MobileClaw …).
 *
 * Run after changing any text in index.html / strings.js / collections.js:
 *   node scripts/build-i18n.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "i18n");

const LANGS = ["tr", "de", "fr", "es", "pt", "it", "ru", "zh", "ja", "ar", "hi"];

const GTX_TARGET = {
  en: "en", tr: "tr", de: "de", fr: "fr", es: "es", pt: "pt",
  it: "it", ru: "ru", zh: "zh-CN", "zh-cn": "zh-CN", ja: "ja",
  ar: "ar", hi: "hi",
};

const LT_URLS = ["https://libretranslate.com", "https://translate.terraprints.com", "https://translate.fedilab.app"];

const MAX_TEXTS = 20;
const MAX_LEN = 600;
const LT_TIMEOUT = 2500;
const ENGINE_TIMEOUT = 4000;

const BRANDS = ["HuggingFace", "Hugging Face", "GitHub", "OpenTrend", "MobileClaw", "BookIQ", "MyMemory"];

/* ── brand protection (port of api/translate.js) ──────── */

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function protectBrands(texts) {
  const maps = texts.map(() => new Map());
  const re = new RegExp(`(${BRANDS.map(escapeRegex).join("|")})`, "gi");
  const protectedTexts = texts.map((text, i) =>
    String(text).replace(re, (m) => {
      const token = `Zxbr${maps[i].size}zx`;
      maps[i].set(token, m);
      return token;
    })
  );
  return { protectedTexts, maps };
}

function unprotectOne(text, map) {
  if (!map.size) return String(text == null ? "" : text);
  let out = String(text == null ? "" : text);
  for (const [token, brand] of map) out = out.split(token).join(brand);
  return out;
}

function splitByBrands(text) {
  const re = new RegExp(`(${BRANDS.map(escapeRegex).join("|")})`, "gi");
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(String(text)))) {
    if (m.index > last) parts.push({ text: String(text).slice(last, m.index) });
    parts.push({ brand: m[0] });
    last = m.index + m[0].length;
  }
  if (last < String(text).length) parts.push({ text: String(text).slice(last) });
  return parts;
}

async function segmentedTranslate(text, target, fn) {
  const parts = splitByBrands(text);
  const segTexts = parts.filter((p) => p.text && p.text.trim()).map((p) => p.text);
  const translated = segTexts.length ? await fn(segTexts, target) : [];
  let k = 0;
  let out = "";
  for (const p of parts) {
    if (p.brand) out += p.brand;
    else if (p.text.trim()) out += translated[k] != null ? translated[k++] : p.text;
    else out += p.text;
  }
  return out;
}

async function translateWithRepair(texts, target, fn) {
  const { protectedTexts, maps } = protectBrands(texts);
  const raw = await fn(protectedTexts, target);
  const out = raw.map((t, i) => unprotectOne(t, maps[i]));
  for (let i = 0; i < texts.length; i++) {
    const lost = Array.from(maps[i].keys()).some((tok) => !String(raw[i] || "").includes(tok));
    if (lost) {
      try { out[i] = await segmentedTranslate(texts[i], target, fn); } catch { /* keep */ }
    }
  }
  return out;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sanitize(text) {
  return String(text == null ? "" : text).replace(/[\r\n]+/g, " ").trim().slice(0, MAX_LEN);
}

/* ── engines ──────────────────────────────────────────── */

async function ltOnce(base, texts, target) {
  const url = `${base.replace(/\/$/, "")}/translate`;
  const res = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: texts, source: "en", target, format: "text" }),
    }),
    LT_TIMEOUT
  );
  if (!res.ok) throw new Error(`${base} -> ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data.translatedText) && data.translatedText.length === texts.length) {
    return data.translatedText.map((t) => String(t || ""));
  }
  if (typeof data.translatedText === "string" && texts.length === 1) return [data.translatedText];
  throw new Error(`${base} -> unexpected shape`);
}

async function viaLibreTranslate(texts, target) {
  const attempts = await Promise.allSettled(LT_URLS.map((base) => ltOnce(base, texts, target)));
  for (const a of attempts) if (a.status === "fulfilled") return a.value;
  throw new Error("libretranslate unavailable");
}

async function gtxOnce(texts, target) {
  const tl = GTX_TARGET[target] || target;
  const joined = texts.join("\n");
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=en&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(joined)}`;
  const res = await withTimeout(fetch(url), ENGINE_TIMEOUT);
  if (!res.ok) throw new Error(`gtx -> ${res.status}`);
  const data = await res.json();
  const translated = (data[0] || []).map((seg) => seg[0]).join("");
  const lines = translated.split("\n").map((l) => l.trim());
  if (lines.length === texts.length) return lines;
  throw new Error("gtx -> line count mismatch");
}

async function viaGtx(texts, target) {
  try {
    return await gtxOnce(texts, target);
  } catch {
    const out = [];
    for (const t of texts) {
      const [line] = await gtxOnce([t], target);
      out.push(line);
    }
    return out;
  }
}

async function viaMyMemory(texts, target) {
  const out = [];
  for (const t of texts) {
    const url =
      "https://api.mymemory.translated.net/get" +
      `?q=${encodeURIComponent(t)}&langpair=${encodeURIComponent("en|" + target)}`;
    const res = await withTimeout(fetch(url), ENGINE_TIMEOUT);
    if (!res.ok) throw new Error(`mymemory -> ${res.status}`);
    const data = await res.json();
    out.push(String((data.responseData && data.responseData.translatedText) || t));
  }
  return out;
}

async function translate(texts, target) {
  const errors = [];
  for (const [engine, fn] of [
    ["libretranslate", viaLibreTranslate],
    ["gtx", viaGtx],
    ["mymemory", viaMyMemory],
  ]) {
    try {
      const translations = await translateWithRepair(texts, target, fn);
      return { translations, engine };
    } catch (err) {
      errors.push(`${engine}: ${err.message}`);
      console.log(`  ${engine} failed for ${target}: ${err.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

/* ── source collection ────────────────────────────────── */

function decodeEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function collectSources() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const statics = [];
  // capture only plain text (no nested tags) between the attr and the close tag
  const re = /data-i18n="[^"]*"[^>]*>([^<]*)<\/[a-z0-9]+>/g;
  let m;
  while ((m = re.exec(html))) statics.push(decodeEntities(m[1]));

  global.window = {};
  require(path.join(ROOT, "strings.js"));
  require(path.join(ROOT, "collections.js"));
  const dyn = Object.values(global.window.OT_DYN || {});
  const titles = (global.window.COLLECTIONS || []).map((c) => c.title);

  return [...new Set([...statics, ...dyn, ...titles])].filter(Boolean);
}

/* ── main ─────────────────────────────────────────────── */

async function main() {
  const sources = collectSources();
  console.log(`→ ${sources.length} unique strings × ${LANGS.length} languages`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const lang of LANGS) {
    const out = {};
    let engine = "?";
    for (let i = 0; i < sources.length; i += MAX_TEXTS) {
      const chunk = sources.slice(i, i + MAX_TEXTS);
      const { translations, engine: e } = await translate(chunk, lang);
      engine = e;
      chunk.forEach((src, idx) => {
        const val = translations[idx];
        if (val && val !== src) out[src] = val;
        else if (!val) out[src] = src;
      });
    }
    // Every source must be present (fallback: English) so app.js finds it.
    for (const src of sources) if (!out[src]) out[src] = src;
    fs.writeFileSync(path.join(OUT_DIR, `${lang}.json`), JSON.stringify(out, null, 2) + "\n");
    const brandLeaks = sources.filter((s) =>
      /GitHub|HuggingFace|OpenTrend|MobileClaw/.test(s) &&
      !Object.values(out).some((v) => v.includes(s.match(/GitHub|HuggingFace|OpenTrend|MobileClaw/)[0]))
    );
    console.log(`✓ ${lang}.json  (${Object.keys(out).length} strings, engine: ${engine})`);
  }
  console.log("✓ i18n build complete");
}

main().catch((err) => {
  console.error("✗ build-i18n failed:", err.message);
  process.exit(1);
});
