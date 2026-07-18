# System Map

- `index.html` — UI, fetch to `/api/analyze`, auto-retry fast path on 502/timeout
- `netlify/functions/analyze.mjs` — Gemini generateContent; full path (google_search, 22s/model) or fast path (no search, 15s)
- `netlify.toml` — function timeout 60s, publish `.`
- `sw.js` — PWA shell cache; skips `/api/`
