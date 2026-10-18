import { readFileSync } from "node:fs";
import { cfg } from "./config.js";
import { validateCuration, validateDraft, cleanDraft, DISCLAIMER, FORWARD, windowStart } from "./validate.js";

const INSTRUCTIONS = readFileSync(new URL("./agent-instructions.md", import.meta.url), "utf8");

async function ask(payload) {
  const c = cfg();
  if (!c.anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": c.anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: c.model,
      max_tokens: 4000,
      system: INSTRUCTIONS,
      tools: payload.mode === "Curation" ? [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }] : [],
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }),
  });
  if (!res.ok) throw new Error(`Agent API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}

const parseJson = text => {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Agent did not return JSON");
  return JSON.parse(text.slice(a, b + 1));
};

// --- offline mock, used only when MOCK_AGENT=true (dev and tests) ---
function mockCuration(p) {
  const d = new Date(p.runDate);
  const day = n => new Date(d.getTime() - n * 864e5).toISOString().slice(0, 10);
  return { status: "ok", requestId: p.requestId, results: [1, 2, 3].map(i => ({
    articleNumber: i, title: `[MOCK] ${p.topics} sample article ${i}`, publisher: "Mock Publisher",
    publish_date: day(i * 3), summary: `Sample summary for article ${i}. This is mock data for development only.`, url: `https://example.com/mock/${i}` })) };
}
const lorem = "Buyers keep asking the wrong question. The headline number matters less than what sits underneath it, and this article shows why. Program owners who treat the category as a cost line miss the structural shift in how work gets bought, staffed and governed. Here is the practical read: audit who controls the spend, check whether your data is clean enough to trust, and ask your suppliers what they would change if they owned the outcome. If you cannot answer those three questions in a single meeting, the strategy is not ready. Strong programs combine clear ownership, honest reporting and a willingness to renegotiate scope as the work changes. Weak ones wait for the annual review and call it governance. For buyers the implication is simple: tighten decision rights now, because the market will not wait for your next planning cycle. Read the piece, then tell me where your program disagrees. I would rather argue about real numbers than agree on slogans.";
export const buildMockPost = (a, comments = "") =>
  `${a.title}\n\n${lorem}${comments ? `\n\n(Revised per feedback: ${comments})` : ""}\n\nSource: ${a.url}\n\n${DISCLAIMER}\n\n${FORWARD}`;

export async function curate(p) {
  const c = cfg();
  const opts = { runDate: p.runDate, recencyMonths: p.recencyMonths };
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = c.mockAgent ? mockCuration(p) : parseJson(await ask(attempt ? { ...p, comments: `${p.comments || ""} Previous reply was rejected: ${last.errors.join("; ")}`.trim() } : p));
    last = validateCuration(reply, opts);
    if (last.ok || last.status === "no_data") break;
  }
  return last;
}

export async function draftPost(p) {
  const c = cfg();
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = c.mockAgent ? buildMockPost(p.selectedArticle, p.comments) : await ask(attempt ? { ...p, comments: `${p.comments || ""} Fix: ${last.errors.join("; ")}`.trim() } : p);
    const text = cleanDraft(raw);
    last = { ...validateDraft(text), text };
    if (last.ok) break;
  }
  return last;
}
export { windowStart };
