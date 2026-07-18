// Earnings Quality Assessment — Gemini Interactions API
// No npm dependencies. Uses native fetch (Node 18+).
// Requires environment variable GEMINI_API_KEY set in Netlify UI.

const MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"];
const API_URL = "https://generativelanguage.googleapis.com/v1beta2/interactions";

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
  if (!company)
    return new Response(JSON.stringify({ error: "Provide a company name or website URL." }), { status: 400, headers: cors });

  const userPrompt =
    `Company under consideration: ${company}\n` +
    (focus ? `Owner's particular concern: ${focus}\n` : "") +
    `Research the latest available filings and investor materials, then write the assessment.`;

  let lastErr = "";
  for (const model of MODELS) {
    try {
      const payload = {
        model,
        store: false,
        input: userPrompt,
        system_instruction: SYSTEM_PROMPT,
        tools: [{ type: "google_search" }],
        generation_config: { temperature: 0.4, max_output_tokens: 4096 },
      };

      const r = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) { lastErr = data?.error?.message || `HTTP ${r.status}`; continue; }

      // Interactions API response: find the last model_output step and extract text + annotations
      const steps = data?.steps || [];
      let text = "";
      const sources = [];

      for (const step of steps) {
        if (step.type === "model_output" && step.content) {
          for (const part of step.content) {
            if (part.type === "text" && part.text) {
              text += part.text;
              // Collect inline annotations (citations from google_search)
              if (part.annotations) {
                for (const anno of part.annotations) {
                  sources.push({ title: anno.title, uri: anno.uri });
                }
              }
            }
          }
        }
        // Also collect sources from google_search_result steps
        if (step.type === "google_search_result" && step.content) {
          for (const part of step.content) {
            if (part.type === "text" && part.text) {
              const already = sources.some(s => s.uri === part.uri);
              if (!already) sources.push({ title: part.title || part.text, uri: part.uri });
            }
          }
        }
      }

      if (!text) { lastErr = "Empty response from model"; continue; }

      // Deduplicate sources by uri
      const seen = new Set();
      const uniqueSources = sources.filter(s => {
        if (seen.has(s.uri)) return false;
        seen.add(s.uri);
        return s.uri;
      });

      return new Response(JSON.stringify({ report: text, sources: uniqueSources, model }), { status: 200, headers: cors });
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }
  return new Response(JSON.stringify({ error: `Analysis failed: ${lastErr}` }), { status: 502, headers: cors });
};

export const config = { path: "/api/analyze" };
