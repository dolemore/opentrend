/**
 * Builds static trend data for GitHub Pages:
 *   data/trending.json  — github.com/trending scrape (daily + weekly)
 *   data/hf.json        — HuggingFace trendingScore lists (models/datasets/spaces)
 *   data/repos.json     — metadata for every curated collection repo
 *
 * Run: node scripts/build-data.js   (optional: GITHUB_TOKEN=... for rate limits)
 * Ported from bookiq-web/api/{trending,hf,repos}.js — same parsers, static output.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const TIMEOUT_MS = 12000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* ── trending scrape (from api/trending.js) ───────────── */

function decodeEntities(text) {
  return String(text || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html) {
  return decodeEntities(String(html || "").replace(/<[^>]*>/g, ""));
}

function parseTrending(html) {
  const articles = html.split('<article class="Box-row"').slice(1);
  return articles
    .map((article) => {
      const repoMatch = article.match(/<h2[\s\S]*?href="\/([^"]+)"[\s\S]*?<\/h2>/);
      const repo = repoMatch ? repoMatch[1] : null;
      if (!repo || !repo.includes("/")) return null;

      const descMatch = article.match(/<p class="col-9[\s\S]*?<\/p>/);
      const langMatch = article.match(/itemprop="programmingLanguage">([^<]+)</);
      const starsMatch = article.match(
        /href="\/[^"]*\/stargazers"[\s\S]*?>\s*<svg[\s\S]*?<\/svg>\s*([\d,]+)/
      );
      const todayMatch = article.match(/([\d,]+)\s*stars (today|this week)/);
      const forksMatch = article.match(
        /href="\/[^"]*\/forks"[\s\S]*?>\s*<svg[\s\S]*?<\/svg>\s*([\d,]+)/
      );
      const avatarMatch =
        article.match(/<img[^>]+class="avatar[^"]*"[^>]+src="([^"]+)"/) ||
        article.match(/<img[^>]+src="(https:\/\/avatars\.githubusercontent[^"]+)"/);

      const [owner, name] = repo.split("/");
      return {
        repo,
        owner,
        name,
        url: `https://github.com/${repo}`,
        description: descMatch ? stripTags(descMatch[0]) : "",
        language: langMatch ? langMatch[1].trim() : null,
        stars: starsMatch ? starsMatch[1] : null,
        forks: forksMatch ? forksMatch[1] : null,
        starsPeriod: todayMatch ? todayMatch[1] : null,
        avatar: avatarMatch ? avatarMatch[1] : `https://github.com/${owner}.png?size=80`,
      };
    })
    .filter(Boolean);
}

async function fetchText(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeTrending(since) {
  const html = await fetchText(`https://github.com/trending?since=${since}`, {
    "User-Agent": UA,
    "Accept-Language": "en-US,en;q=0.9",
  });
  const items = parseTrending(html);
  if (!items.length) throw new Error(`trending(${since}) parsed 0 items`);
  return items;
}

/* ── HuggingFace (from api/hf.js) ─────────────────────── */

function normalizeHf(type, item) {
  const base = {
    id: item.id || item.modelId || "",
    url:
      type === "models"
        ? `https://huggingface.co/${item.id || item.modelId}`
        : type === "datasets"
          ? `https://huggingface.co/datasets/${item.id}`
          : `https://huggingface.co/spaces/${item.id}`,
    likes: item.likes || 0,
    downloads: item.downloads || 0,
    trendingScore: item.trendingScore || 0,
    createdAt: item.createdAt || null,
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 6) : [],
  };
  if (type === "models") {
    base.pipeline = item.pipeline_tag || null;
    base.library = item.library_name || null;
  } else if (type === "datasets") {
    base.description = String(item.description || "").replace(/\s+/g, " ").trim().slice(0, 240);
  } else {
    base.sdk = item.sdk || null;
  }
  return base;
}

async function fetchHf(type, limit) {
  const url = `https://huggingface.co/api/${type}?sort=trendingScore&direction=-1&limit=${limit}`;
  const { status, data } = await fetchJson(url, { Accept: "application/json" });
  if (status !== 200 || !Array.isArray(data)) throw new Error(`hf(${type}) -> ${status}`);
  return data.map((d) => normalizeHf(type, d));
}

/* ── curated repo metadata (from api/repos.js) ────────── */

const SEARCH_CHUNK = 40;

function shape(item) {
  return {
    repo: item.full_name,
    name: item.name,
    owner: item.owner ? item.owner.login : item.full_name.split("/")[0],
    description: item.description || "",
    stars: item.stargazers_count || 0,
    forks: item.forks_count || 0,
    language: item.language || null,
    url: item.html_url,
    avatar: item.owner ? item.owner.avatar_url : null,
    topics: Array.isArray(item.topics) ? item.topics.slice(0, 4) : [],
    updatedAt: item.pushed_at || null,
    archived: Boolean(item.archived),
  };
}

function ghHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "opentrend-build",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function searchChunk(names) {
  const q = names.map((n) => `repo:${n}`).join(" ") + " fork:true";
  const url =
    "https://api.github.com/search/repositories" +
    `?q=${encodeURIComponent(q)}&per_page=100`;
  const { status, data } = await fetchJson(url, ghHeaders());
  if (status !== 200 || !data || !Array.isArray(data.items)) {
    throw new Error(`search -> ${status}`);
  }
  const byName = new Map();
  for (const item of data.items) byName.set(item.full_name.toLowerCase(), item);
  return byName;
}

async function fetchSingle(name) {
  const { status, data } = await fetchJson(`https://api.github.com/repos/${name}`, ghHeaders());
  if (status === 200 && data && data.full_name) return data;
  return null;
}

async function fetchRepoMeta(names) {
  const found = new Map();
  const missing = [];
  for (let i = 0; i < names.length; i += SEARCH_CHUNK) {
    const slice = names.slice(i, i + SEARCH_CHUNK);
    try {
      const byName = await searchChunk(slice);
      for (const n of slice) {
        const item = byName.get(n);
        if (item) found.set(n, shape(item));
        else missing.push(n);
      }
    } catch (err) {
      missing.push(...slice);
    }
  }
  const stillMissing = [];
  for (const n of missing) {
    if (found.has(n)) continue;
    const item = await fetchSingle(n);
    if (item) found.set(n, shape(item));
    else stillMissing.push(n);
  }
  return { found, stillMissing };
}

/* ── collections (shared source: collections.js) ──────── */

function collectionNames() {
  global.window = {};
  require(path.join(__dirname, "..", "collections.js"));
  const out = [];
  for (const c of global.window.COLLECTIONS) {
    for (const r of c.repos) out.push(r.repo.toLowerCase());
  }
  return [...new Set(out)];
}

/* ── main ─────────────────────────────────────────────── */

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();

  console.log("→ scraping github.com/trending (daily, weekly)…");
  const [daily, weekly] = await Promise.all([scrapeTrending("daily"), scrapeTrending("weekly")]);
  console.log(`  daily ${daily.length}, weekly ${weekly.length}`);

  console.log("→ fetching HuggingFace trending…");
  const [models, datasets, spaces] = await Promise.all([
    fetchHf("models", 24),
    fetchHf("datasets", 24),
    fetchHf("spaces", 24),
  ]);
  console.log(`  models ${models.length}, datasets ${datasets.length}, spaces ${spaces.length}`);

  console.log("→ fetching curated repo metadata…");
  const names = collectionNames();
  const { found, stillMissing } = await fetchRepoMeta(names);
  console.log(`  ${found.size}/${names.length} found` + (stillMissing.length ? `, missing: ${stillMissing.join(", ")}` : ""));

  const trending = { generatedAt, daily, weekly };
  const hf = { generatedAt, models, datasets, spaces };
  const repos = { generatedAt, repos: Object.fromEntries(found) };

  fs.writeFileSync(path.join(DATA_DIR, "trending.json"), JSON.stringify(trending, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, "hf.json"), JSON.stringify(hf, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, "repos.json"), JSON.stringify(repos, null, 2));

  console.log(`✓ wrote data/trending.json, data/hf.json, data/repos.json at ${generatedAt}`);
}

main().catch((err) => {
  console.error("✗ build-data failed:", err.message);
  process.exit(1);
});
