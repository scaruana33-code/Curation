import { cfg, INDUSTRIES, AUDIENCES, STYLES, RECENCY_MONTHS, fullTopic } from "./config.js";
import { curate, draftPost } from "./agent.js";
import { validateDraft } from "./validate.js";
import { publish } from "./linkedin.js";
import { sendMail, esc } from "./mailer.js";

const now = () => new Date().toISOString();
const plusHours = h => new Date(Date.now() + h * 36e5).toISOString();
export const ST = { CURATING: "Curating", G1: "Gate 1 Pending", DRAFTING: "Drafting", G2: "Gate 2 Pending", REVISING: "Revising", PUBLISHING: "Publishing", PUBLISHED: "Published", R1: "Rejected — Gate 1", R2: "Rejected — Gate 2", FAILED: "Failed", EXPIRED: "Expired" };

export class UserError extends Error {}
const need = (cond, msg) => { if (!cond) throw new UserError(msg); };

export const getRun = (db, id) => {
  const r = db.prepare("SELECT * FROM runs WHERE id=?").get(id);
  if (!r) return null;
  return { ...r, articles: r.articles_json ? JSON.parse(r.articles_json) : [], audited: !!r.audited, genai_ack: !!r.genai_ack };
};
export const log = (db, id, actor, text) => db.prepare("INSERT INTO events (run_id,ts,actor,text) VALUES (?,?,?,?)").run(id, now(), actor, text);
const set = (db, id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE runs SET ${keys.map(k => `${k}=?`).join(",")} WHERE id=?`).run(...keys.map(k => fields[k]), id);
};
const approverMail = (db, subject, html) => sendMail(db, cfg().approvers, subject, html);
const link = id => `${cfg().baseUrl}/#todo=${id}`;

export function createRun(db, input, user) {
  need(INDUSTRIES[input.industry], "Choose a valid Industry");
  need(INDUSTRIES[input.industry].includes(input.topic), "Choose a Topic that belongs to the selected Industry");
  need(AUDIENCES.includes(input.audience), "Choose a valid Audience");
  need(RECENCY_MONTHS.includes(Number(input.recency)), "Recency must be 1 to 6 months");
  need(STYLES.includes(input.style), "Choose a valid Management Style");
  const t = now();
  const r = db.prepare(`INSERT INTO runs (status,industry,topic,audience,recency_months,style,audited,publisher,notes,requested_by,created_at,run_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(ST.CURATING, input.industry, fullTopic(input.industry, input.topic), input.audience, Number(input.recency), input.style,
    input.audited === false ? 0 : 1, (input.publisher || "").slice(0, 255), (input.notes || "").slice(0, 2000), user, t, t);
  const id = Number(r.lastInsertRowid);
  log(db, id, user, "Request submitted");
  return id;
}

const failRun = async (db, id, reason) => {
  set(db, id, { status: ST.FAILED, failure_reason: reason });
  log(db, id, "system", `Failed: ${reason}`);
  await approverMail(db, `Workflow alert: RUN-${id} terminated`, `<p>RUN-${id} stopped.</p><p>${esc(reason)}</p>`);
};

export async function runCurate(db, id, comments = "") {
  const r = getRun(db, id);
  set(db, id, { status: ST.CURATING });
  let out;
  try {
    out = await curate({ mode: "Curation", requestId: `RUN-${id}`, runDate: now(), primaryIndustry: r.industry, topics: r.topic, audience: [r.audience],
      recencyMonths: r.recency_months, managementStyle: r.style, auditedSourcesOnly: r.audited, publisher: r.publisher || "", specialInstructions: r.notes || "", comments });
  } catch (e) { return failRun(db, id, `Agent error: ${e.message}`); }
  if (!out.ok) return failRun(db, id, out.errors.join("; "));
  set(db, id, { articles_json: JSON.stringify(out.articles), status: ST.G1, gate1_decision: "Pending", due_at: plusHours(cfg().approvalHours), selected_article: null });
  log(db, id, "agent", `Curated ${out.articles.length} article(s)`);
  const rows = out.articles.map(a => `<li><b>${esc(a.title)}</b> (${esc(a.publisher)}, ${esc(a.publish_date)})<br>${esc(a.summary)}<br><a href="${esc(a.url)}">${esc(a.url)}</a></li>`).join("");
  await approverMail(db, "Contingent Workforce Article Options for Review", `<p>RUN-${id}: choose an article within ${cfg().approvalHours} hours.</p><ol>${rows}</ol><p><a href="${link(id)}">Open My To-Do</a></p>`);
}

export async function runDraft(db, id, comments = "", currentDraft = "") {
  const r = getRun(db, id);
  const art = r.articles.find(a => a.articleNumber === r.selected_article);
  let out;
  try { out = await draftPost({ mode: "PostGeneration", requestId: `RUN-${id}`, selectedArticle: art, targetWordCount: 200, currentDraft, comments }); }
  catch (e) { return failRun(db, id, `Agent error: ${e.message}`); }
  if (!out.ok) return failRun(db, id, `Draft failed checks: ${out.errors.join("; ")}`);
  set(db, id, { draft: out.text, draft_version: r.draft_version + 1, status: ST.G2, gate2_decision: "Pending", due_at: plusHours(cfg().approvalHours) });
  log(db, id, "agent", `Draft v${r.draft_version + 1} ready`);
  await approverMail(db, "LinkedIn Post Draft for Approval", `<p>RUN-${id} draft v${r.draft_version + 1}.</p><pre style="white-space:pre-wrap">${esc(out.text)}</pre><p><a href="${link(id)}">Open My To-Do</a></p>`);
}

const guard = (r, status) => {
  need(r, "Run not found");
  need(r.status === status, `Already actioned. Current status: ${r?.status}`);
};

// Each gate function changes state right away and returns { status, message, after }.
// `after` is the slow agent work; the server runs it in the background, tests await it.
export function gate1(db, id, user, { decision, articleNumber, comments = "" }) {
  const r = getRun(db, id); guard(r, ST.G1);
  const base = { gate1_approver: user, gate1_at: now() };
  if (decision === "approve") {
    need(r.articles.some(a => a.articleNumber === Number(articleNumber)), "Choose one of the listed articles");
    set(db, id, { ...base, gate1_decision: "Approved", selected_article: Number(articleNumber), status: ST.DRAFTING });
    log(db, id, user, `Approved article ${articleNumber}`);
    return { status: ST.DRAFTING, message: "Article approved. Drafting the post.", after: () => runDraft(db, id) };
  }
  if (decision === "sendback") {
    need(comments.trim(), "Add a comment so the agent knows what to change");
    set(db, id, { ...base, gate1_decision: "Sent Back", gate1_comments: comments, status: ST.CURATING });
    log(db, id, user, `Sent back: ${comments}`);
    return { status: ST.CURATING, message: "Sent back. New options are being curated.", after: () => runCurate(db, id, comments) };
  }
  if (decision === "reject") {
    set(db, id, { ...base, gate1_decision: "Rejected", status: ST.R1 });
    log(db, id, user, "Rejected at Gate 1");
    return { status: ST.R1, message: "Rejected. The run is closed.", after: async () => approverMail(db, `Workflow alert: RUN-${id} rejected at Gate 1`, `<p>RUN-${id} was rejected by ${esc(user)}.</p>`) };
  }
  throw new UserError("Unknown decision");
}

export function gate2(db, id, user, { decision, draft, comments = "", genAiAck = false }) {
  const r = getRun(db, id); guard(r, ST.G2);
  const base = { gate2_approver: user, gate2_at: now() };
  if (decision === "save") {
    need(draft?.trim(), "Draft is empty");
    set(db, id, { draft });
    log(db, id, user, "Saved edits");
    return { status: ST.G2, message: "Edits saved.", after: async () => {} };
  }
  if (decision === "requestEdits") {
    need(comments.trim(), "Add feedback so the agent knows what to change");
    set(db, id, { ...base, draft: draft || r.draft, gate2_decision: "Edits Requested", gate2_comments: comments, status: ST.REVISING });
    log(db, id, user, `Requested edits: ${comments}`);
    return { status: ST.REVISING, message: "Revising the draft.", after: () => runDraft(db, id, comments, draft || r.draft) };
  }
  if (decision === "reject") {
    set(db, id, { ...base, gate2_decision: "Rejected", status: ST.R2 });
    log(db, id, user, "Rejected at Gate 2");
    return { status: ST.R2, message: "Rejected. Nothing was published.", after: async () => approverMail(db, `Workflow alert: RUN-${id} rejected at Gate 2`, `<p>RUN-${id} was rejected by ${esc(user)}.</p>`) };
  }
  if (decision === "publish") {
    need(genAiAck === true, "Acknowledge the GenAI disclaimer before publishing");
    const text = (draft ?? r.draft) || "";
    const v = validateDraft(text);
    need(v.ok, `Draft cannot be published: ${v.errors.join("; ")}`);
    const art = r.articles.find(a => a.articleNumber === r.selected_article);
    // Lock the run before the slow call so a second approver cannot publish twice.
    set(db, id, { ...base, draft: text, genai_ack: 1, gate2_decision: "Approved", status: ST.PUBLISHING });
    return { status: ST.PUBLISHING, message: "Approved. Publishing now.", after: async () => {
      try {
        const out = await publish({ text, sourceUrl: art.url, runId: id });
        set(db, id, { status: ST.PUBLISHED, published_url: out.url, published_at: now() });
        log(db, id, user, out.dryRun ? "Published (dry run, LinkedIn not contacted)" : "Published to LinkedIn");
        await approverMail(db, `Published: RUN-${id}`, `<p>RUN-${id} was ${out.dryRun ? "approved (dry run, nothing posted)" : "published"} at ${now()}.</p><p>${esc(out.url)}</p>`);
      } catch (e) {
        set(db, id, { status: ST.G2, gate2_decision: "Pending", failure_reason: e.message });
        log(db, id, "system", `Publish failed, back at Gate 2: ${e.message}`);
        await approverMail(db, `Workflow alert: RUN-${id} publish failed`, `<p>${esc(e.message)}</p><p>The run is back at Gate 2 so you can retry.</p>`);
      }
    } };
  }
  throw new UserError("Unknown decision");
}

export async function expireStale(db) {
  const rows = db.prepare("SELECT id FROM runs WHERE status IN (?,?) AND due_at < ?").all(ST.G1, ST.G2, now());
  for (const { id } of rows) {
    set(db, id, { status: ST.EXPIRED, failure_reason: `Gate window expired (${cfg().approvalHours} hours)` });
    log(db, id, "system", "Gate window expired");
    await approverMail(db, `Workflow alert: RUN-${id} expired`, `<p>RUN-${id} was not actioned within ${cfg().approvalHours} hours.</p>`);
  }
  return rows.length;
}
