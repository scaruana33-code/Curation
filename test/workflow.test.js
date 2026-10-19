import test from "node:test";
import assert from "node:assert/strict";
process.env.MOCK_AGENT = "true"; process.env.PUBLISH_MODE = "dry-run"; process.env.SESSION_SECRET = "test-secret";
const { openDb } = await import("../src/db.js");
const W = await import("../src/workflow.js");
const V = await import("../src/validate.js");
const { makeToken, readToken } = await import("../src/server.js");

const input = { industry: "Contingent Workforce", topic: "Vendor Management", audience: "Buyers / Client-Side Decision Makers", recency: 1, style: "Strategic", audited: true };
const U = "scaruana33@gmail.com";
const fresh = () => openDb(":memory:");

test("intake rejects a topic from another industry", () => {
  assert.throws(() => W.createRun(fresh(), { ...input, industry: "Healthcare" }, U), /Topic/);
});
test("topic is stored with the list's prefix", () => {
  const db = fresh(); const id = W.createRun(db, input, U);
  assert.equal(W.getRun(db, id).topic, "Contingent Staffing | Vendor Management");
});
test("full path: curate, gate 1, draft, gate 2, publish (dry run)", async () => {
  const db = fresh(); const id = W.createRun(db, input, U);
  await W.runCurate(db, id);
  assert.equal(W.getRun(db, id).status, W.ST.G1);
  assert.equal(W.getRun(db, id).articles.length, 3);
  await W.gate1(db, id, U, { decision: "approve", articleNumber: 2 }).after();
  const r = W.getRun(db, id);
  assert.equal(r.status, W.ST.G2); assert.equal(r.selected_article, 2);
  assert.ok(V.validateDraft(r.draft).ok);
  await assert.rejects(async () => W.gate2(db, id, U, { decision: "publish", genAiAck: false }), /Acknowledge/);
  await W.gate2(db, id, U, { decision: "publish", genAiAck: true }).after();
  const done = W.getRun(db, id);
  assert.equal(done.status, W.ST.PUBLISHED); assert.match(done.published_url, /^dry-run:/);
});
test("a second action on the same gate is refused", async () => {
  const db = fresh(); const id = W.createRun(db, input, U); await W.runCurate(db, id);
  W.gate1(db, id, U, { decision: "reject" });
  assert.throws(() => W.gate1(db, id, U, { decision: "approve", articleNumber: 1 }), /Already actioned/);
});
test("send back needs a comment and re-curates", async () => {
  const db = fresh(); const id = W.createRun(db, input, U); await W.runCurate(db, id);
  assert.throws(() => W.gate1(db, id, U, { decision: "sendback", comments: " " }), /comment/);
  await W.gate1(db, id, U, { decision: "sendback", comments: "More MSP angle" }).after();
  assert.equal(W.getRun(db, id).status, W.ST.G1);
});
test("request edits bumps the draft version", async () => {
  const db = fresh(); const id = W.createRun(db, input, U); await W.runCurate(db, id);
  await W.gate1(db, id, U, { decision: "approve", articleNumber: 1 }).after();
  assert.throws(() => W.gate2(db, id, U, { decision: "requestEdits", comments: "" }), /feedback/);
  await W.gate2(db, id, U, { decision: "requestEdits", comments: "Shorter hook" }).after();
  assert.equal(W.getRun(db, id).draft_version, 2);
});
test("publish refuses a draft missing a footer", async () => {
  const db = fresh(); const id = W.createRun(db, input, U); await W.runCurate(db, id);
  await W.gate1(db, id, U, { decision: "approve", articleNumber: 1 }).after();
  const bad = W.getRun(db, id).draft.replace("Forward-Looking Statement:", "FLS:");
  assert.throws(() => W.gate2(db, id, U, { decision: "publish", genAiAck: true, draft: bad }), /footer/);
});
test("stale gates expire", async () => {
  const db = fresh(); const id = W.createRun(db, input, U); await W.runCurate(db, id);
  db.prepare("UPDATE runs SET due_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z", id);
  assert.equal(await W.expireStale(db), 1);
  assert.equal(W.getRun(db, id).status, W.ST.EXPIRED);
});
test("curation validator enforces count, https, window", () => {
  const o = { runDate: "2026-10-18T12:00:00Z", recencyMonths: 1 };
  const art = (d, u = "https://x.com/a") => ({ title: "t", publisher: "p", publish_date: d, summary: "s", url: u });
  assert.ok(V.validateCuration({ status: "ok", results: [art("2026-10-01")] }, o).ok);
  assert.ok(!V.validateCuration({ status: "ok", results: [art("2026-08-01")] }, o).ok);
  assert.ok(!V.validateCuration({ status: "ok", results: [art("2026-10-30")] }, o).ok);
  assert.ok(!V.validateCuration({ status: "ok", results: [art("2026-10-01", "http://x.com")] }, o).ok);
  assert.ok(!V.validateCuration({ status: "ok", results: [] }, o).ok);
  assert.ok(!V.validateCuration({ status: "ok", results: [1, 2, 3, 4].map(() => art("2026-10-01")) }, o).ok);
});
test("tokens expire, tamper and kind-mix are rejected", () => {
  const t = makeToken("s", "a@b.c", 1000, "login");
  assert.equal(readToken("s", t, "login"), "a@b.c");
  assert.equal(readToken("s", t, "session"), null);
  assert.equal(readToken("other", t, "login"), null);
  assert.equal(readToken("s", makeToken("s", "a@b.c", -1, "login"), "login"), null);
});
