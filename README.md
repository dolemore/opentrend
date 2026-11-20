# OpenTrend

Open-source trend dashboard for **trends.getmobileclaw.com** — live GitHub
trending, HuggingFace trending and curated collections, in the Hallmark
**Dusk** theme (`fog / periwinkle-apricot / glass`).

Data layer is a static port of the OpenTrend (bookiq-web) serverless API:
what used to run in `api/trending.js`, `api/hf.js` and `api/repos.js` is now
pre-built into `data/*.json` and refreshed hourly by GitHub Actions.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html` | Single page, dusk design |
| `style.css` | Dusk tokens + layout (see `themes/dusk.md` in Nutlope/hallmark) |
| `app.js` | Client renderer for `data/*.json` + i18n |
| `collections.js` | 7 curated collections (112 repos) |
| `strings.js` | Dynamic English strings (`window.OT_DYN`) |
| `scripts/build-data.js` | Scrapes github.com/trending, HuggingFace, GitHub Search → `data/*.json` |
| `scripts/build-i18n.js` | Pre-translates all UI strings → `data/i18n/<lang>.json` |
| `.github/workflows/update-data.yml` | Hourly data refresh (cron `17 * * * *`) |

## Maintenance

```bash
# refresh trend data locally
node scripts/build-data.js            # optional: GITHUB_TOKEN=... for rate limits

# after changing any text in index.html / strings.js / collections.js
node scripts/build-i18n.js            # writes data/i18n/*.json (11 languages)
```

Static site, deployed by GitHub Pages from `main`. Custom domain
`trends.getmobileclaw.com` via the `CNAME` file.

> Scheduled workflows stop after 60 days without repo activity — nudge the
> workflow (`workflow_dispatch`) if the data goes stale.

## Photo credit

Hero: “Fog in the valley of Savoureuse” by Thomas Bresson,
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) via Wikimedia
Commons.
