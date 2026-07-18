# Earnings, Examined — Quality of Earnings App

A Netlify-hosted web app + installable mobile PWA. Enter a company name or website; the app researches its stock-exchange filings and investor reports live (Gemini with Google Search grounding) and writes a plain-language quality of earnings assessment addressed to the company's owners and CEO.

No local packages, no build step. Everything runs on Netlify.

## Deploy (no command line needed)

1. Go to https://app.netlify.com → **Add new site → Deploy manually**.
2. Drag this entire `qoe-app` folder onto the page. Netlify publishes the site and installs the serverless function automatically (the `netlify.toml` tells it where everything is).
3. Get a Gemini API key (free tier is fine): https://aistudio.google.com/apikey
4. In Netlify: **Site configuration → Environment variables → Add a variable**
   - Key: `GEMINI_API_KEY`
   - Value: your key
5. **Deploys → Trigger deploy → Deploy site** (so the function picks up the key).

Done. Open the site URL; on a phone, use "Add to Home Screen" to install it as an app.

## Files

| File | Purpose |
|---|---|
| `index.html` | Entire UI — editorial design, markdown renderer, PWA registration |
| `netlify/functions/analyze.mjs` | Serverless function → Gemini 2.5 Flash with Google Search grounding |
| `netlify.toml` | Tells Netlify where the site and function live; 26s function timeout |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA install + offline shell |

## Notes

- The Gemini key never reaches the browser — it lives only in the Netlify function.
- Analyses are never cached by the service worker.
- If a very large company's research runs past the 26-second function limit, the UI invites a retry (second passes are typically faster due to search caching).
- Model fallback: `gemini-2.5-flash` → `gemini-2.0-flash`.
