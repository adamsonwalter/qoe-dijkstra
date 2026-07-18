# Decision Log

## 2026-07-18 — Immediate "connection timed out" was a mislabeled crash

**Problem:** UI showed "The connection timed out" almost immediately after submit.

**Cause:**
1. Fast-path fallback in `analyze.mjs` referenced `result` outside its `for` block → `ReferenceError` when Gemini failed → Netlify returned a non-JSON 500.
2. Client `catch` treated *every* failure (including JSON parse of that 500) as a timeout.

**Solution:** Scope `lastErr` for the fast path; map AbortError to an explicit timeout string; parse responses as text+JSON and show the real error unless it is an abort/timeout.

**Why:** Without surfacing the real error, API-key / model / crash failures looked like network timeouts.

## 2026-07-18 — Switch primary model to gemini-3.5-flash

**Problem:** Analysis failed with model errors; gemini-2.5-* was not reliable for this key/account.

**Solution:** Primary/fast path = `gemini-3.5-flash`; keep `gemini-2.5-flash` as full-path fallback only.

**Why:** User confirmed 3.5-flash works in practice; 2.0 flash is shut down per Google docs.

## 2026-07-18 — Empty response from gemini-3.5-flash

**Problem:** Fast analysis failed with "Empty response from model".

**Cause:** Gemini 3.x enables thinking by default; thinking tokens consume maxOutputTokens, leaving zero answer tokens (finishReason=MAX_TOKENS).

**Solution:** Set thinkingConfig.thinkingLevel (minimal fast / low full), raise maxOutputTokens (8k/16k), skip thought parts when extracting text, longer per-call timeouts.

**Why:** Matches Google docs for Gemini 3.5 Flash; empty content is the known symptom of under-budgeted output with thinking on.
