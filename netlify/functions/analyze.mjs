// Earnings Quality Assessment — Gemini API (generateContent)
// Two-pass strategy:
//   Pass 1 (full):  google_search + full output — may timeout on complex companies
//   Pass 2 (fast):  no search, shorter output — reliable fallback
// Client sends { company, focus, fast: true } to request the fast path.
// No npm dependencies. Uses native fetch (Node 18+).
// Requires environment variable GEMINI_API_KEY set in Netlify UI.

const MODELS_FULL  = ["gemini-2.5-flash", "gemini-2.5-pro"];
const MODELS_FAST  = ["gemini-2.5-flash"];
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const SYSTEM_PROMPT = `
You are a senior financial analyst preparing a Quality of Earnings (QoE) assessment
of a public (or occasionally private) company for its owners, board and CEO.

INTERNAL METHOD (never mention it, never expose jargon about it):
Model the company's earnings as a network — revenue streams, margins, expenses,
one-time items, cash conversion — where each link is weighted by how much it
distorts or supports sustainable earnings. Trace the lowest-friction path from
revenue to durable net income (the high-quality core) and flag the heavy-weight
links (non-recurring gains, aggressive accruals, working-capital strain,
customer concentration, cash flow diverging from reported profit).

RESEARCH: Use Google Search to find the most recent annual report, half-year /
quarterly results, stock exchange announcements, investor presentations and
reputable financial press for the company. Prefer primary sources (exchange
filings, investor relations pages). Note the reporting period you relied on.

OUTPUT — a persuasive, business-style assessment written in the language of the
company's owners and CEO. Plain, confident, concrete. No analyst jargon, no
mention of graphs, nodes, algorithms or methodology. Use Markdown with this shape:

# Quality of Earnings Assessment — {Company} ({Ticker/Exchange if listed})
*Period reviewed and date of assessment*

## The headline
Three or four sentences a CEO would actually say aloud: what the earnings are
really made of, and how much of the reported profit you could bank on next year.

## What is driving the profit
The durable core — recurring revenue, pricing power, cost discipline, cash
conversion. Quantify wherever the filings allow.

## What is flattering the profit
One-off gains, revaluations, subsidy or settlement income, timing effects,
working-capital movements masking cash strain, concentration risks. Be specific:
name items and amounts from the filings.

## Sustainable earnings, restated
A short plain-language bridge: reported profit → adjustments → what we would
call maintainable earnings. Present as a simple Markdown table.

## What we would do about it
3–5 actions, each framed as a decision the owner/CEO can take, with the payoff.

## If you are buying, selling or borrowing against this business
Two or three sentences on how these findings shift valuation or deal terms.

## Sources
Bullet list of the filings and documents relied on, with dates.

End with exactly this line:
*Prepared as an independent desk assessment from public disclosures. Not investment, accounting or legal advice.*

If you cannot find sufficient financial disclosure, say so plainly, state what
you did find, and list exactly which documents would let you finish the job.
Keep total length 700–1100 words. Never invent numbers; if estimating, say so.
`;

async function callGemini(model, payload, key, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const raw = await r.text();
    console.log(`[${model}] status=${r.status} body=${raw.slice(0, 2000)}`);
    let data;
    try { data = JSON.parse(raw); } catch {
      return { error: `API returned invalid JSON: ${raw.slice(0, 300)}` };
    }
    if (!r.ok) return { error: data?.error?.message || `HTTP ${r.status}` };

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || "").join("");
    if (!text) return { error: "Empty response from model" };

    const grounding = data?.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map(c => c?.web ? { title: c.web.title, uri: c.web.uri } : null)
      .filter(Boolean) || [];

    return { text, sources: grounding, model };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError" || /aborted/i.test(e.message || "")) {
      return { error: `Model timed out after ${Math.round(timeoutMs / 1000)}s` };
    }
    return { error: e.message || String(e) };
  }
}

export default async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });
  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors });

  const key = process.env.GEMINI_API_KEY;
  if (!key)
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured in Netlify environment variables." }), { status: 500, headers: cors });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const company = (body.company || "").toString().trim().slice(0, 300);
  const focus = (body.focus || "").toString().trim().slice(0, 500);
  const fast = body.fast === true;
  if (!company)
    return new Response(JSON.stringify({ error: "Provide a company name or website URL." }), { status: 400, headers: cors });

  const userPrompt =
    `Company under consideration: ${company}\n` +
    (focus ? `Owner's particular concern: ${focus}\n` : "") +
    `Research the latest available filings and investor materials, then write the assessment.`;

  // --- FAST PATH: no search, shorter output, single model, 15s timeout ---
  if (fast) {
    const payload = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    };
    let lastErr = "";
    for (const model of MODELS_FAST) {
      const result = await callGemini(model, payload, key, 15000);
      if (result.text) {
        return new Response(JSON.stringify({
          report: result.text, sources: [], model: result.model, fast: true,
        }), { status: 200, headers: cors });
      }
      lastErr = result.error || "unknown error";
    }
    return new Response(JSON.stringify({ error: `Fast analysis failed: ${lastErr}` }), { status: 502, headers: cors });
  }

  // --- FULL PATH: google search, full output, model fallback, 22s timeout per model ---
  const payload = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
  };
  let lastErr = "";
  for (const model of MODELS_FULL) {
    const result = await callGemini(model, payload, key, 22000);
    if (result.text) {
      return new Response(JSON.stringify({
        report: result.text, sources: result.sources, model: result.model,
      }), { status: 200, headers: cors });
    }
    lastErr = result.error;
  }
  return new Response(JSON.stringify({ error: `Analysis failed: ${lastErr}` }), { status: 502, headers: cors });
};

export const config = { path: "/api/analyze" };
