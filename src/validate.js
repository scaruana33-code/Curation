const FIELDS = ["title", "publisher", "publish_date", "summary", "url"];
const iso = d => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !Number.isNaN(Date.parse(d));

export function windowStart(runDate, months) {
  const d = new Date(runDate);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

// Validates the Mode 1 reply. Returns { ok, status, articles, errors }.
export function validateCuration(reply, { runDate, recencyMonths }) {
  const errors = [];
  if (!reply || typeof reply !== "object") return { ok: false, errors: ["Reply is not a JSON object"] };
  if (reply.status === "no_data") return { ok: false, status: "no_data", errors: [reply.reason || "No qualifying articles found"] };
  if (reply.status !== "ok") errors.push(`status must be "ok" or "no_data", got ${JSON.stringify(reply.status)}`);
  const list = Array.isArray(reply.results) ? reply.results : [];
  if (list.length < 1 || list.length > 3) errors.push(`results must hold 1 to 3 articles, got ${list.length}`);
  const from = windowStart(runDate, recencyMonths);
  const to = new Date(runDate).toISOString().slice(0, 10);
  list.forEach((a, i) => {
    for (const f of FIELDS) if (!a || typeof a[f] !== "string" || !a[f].trim()) errors.push(`article ${i + 1}: missing ${f}`);
    if (a?.url && !/^https:\/\//i.test(a.url)) errors.push(`article ${i + 1}: url must be https`);
    if (a?.publish_date) {
      if (!iso(a.publish_date)) errors.push(`article ${i + 1}: publish_date must be YYYY-MM-DD`);
      else if (a.publish_date > to) errors.push(`article ${i + 1}: publish_date is in the future`);
      else if (a.publish_date < from) errors.push(`article ${i + 1}: publish_date ${a.publish_date} is older than ${from}`);
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, status: "ok", articles: list.map((a, i) => ({ articleNumber: i + 1, title: a.title, publisher: a.publisher, publish_date: a.publish_date, summary: a.summary, url: a.url })), errors: [] };
}

export const DISCLAIMER = "Disclaimer - Created with generative AI and human-reviewed. For informational purposes only. Views are my own and do not represent any current or former employer or client. Please verify independently before acting. This content was developed with the assistance of generative AI and reviewed by a human prior to publication. It is provided for general informational and thought-leadership purposes only and does not constitute legal, financial, procurement, or employment advice.";
export const FORWARD = "Forward-Looking Statement: This content may include forward-looking perspectives on the contingent workforce, staffing, MSP and VMS ecosystems, and workforce technology. Such views reflect current assumptions as of the publication date and are subject to change. Actual outcomes may differ materially.";

export const bodyOf = draft => (draft || "").split(/\n\s*Source:/)[0].trim();
export const wordCount = draft => bodyOf(draft).split(/\s+/).filter(Boolean).length;

// Checks a post draft: 150-250 body words, Source line, both footers.
export function validateDraft(draft) {
  const errors = [];
  const n = wordCount(draft);
  if (n < 150 || n > 250) errors.push(`Body is ${n} words; it must be 150 to 250`);
  if (!/\n\s*Source:\s*https:\/\//.test(draft || "")) errors.push("Missing a 'Source: https://…' line");
  if (!(draft || "").includes("Disclaimer - Created with generative AI")) errors.push("Missing the disclaimer footer");
  if (!(draft || "").includes("Forward-Looking Statement:")) errors.push("Missing the Forward-Looking Statement footer");
  return { ok: !errors.length, errors, words: n };
}

// Strips the "REQUEST ID / LINKEDIN POST" header the agent returns.
export function cleanDraft(text) {
  return (text || "").replace(/^\s*REQUEST ID:.*\n/i, "").replace(/^\s*LINKEDIN POST\s*\n/i, "").trim();
}
