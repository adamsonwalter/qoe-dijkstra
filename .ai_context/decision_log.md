# Decision Log

## 2026-07-18 — Immediate "connection timed out" was a mislabeled crash

**Problem:** UI showed "The connection timed out" almost immediately after submit.

**Cause:**
1. Fast-path fallback in `analyze.mjs` referenced `result` outside its `for` block → `ReferenceError` when Gemini failed → Netlify returned a non-JSON 500.
2. Client `catch` treated *every* failure (including JSON parse of that 500) as a timeout.

**Solution:** Scope `lastErr` for the fast path; map AbortError to an explicit timeout string; parse responses as text+JSON and show the real error unless it is an abort/timeout.

**Why:** Without surfacing the real error, API-key / model / crash failures looked like network timeouts.
