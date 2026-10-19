import express from "express";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { cfg, INDUSTRIES, AUDIENCES, STYLES, RECENCY_MONTHS } from "./config.js";
import { openDb } from "./db.js";
import { sendMail, esc } from "./mailer.js";
import { createRun, getRun, gate1, gate2, runCurate, expireStale, UserError, ST } from "./workflow.js";
import { wordCount } from "./validate.js";

const b64 = b => Buffer.from(b).toString("base64url");
const sign = (secret, data) => createHmac("sha256", secret).update(data).digest("base64url");
export function makeToken(secret, email, ttlMs, kind) {
  const body = b64(JSON.stringify({ e: email, x: Date.now() + ttlMs, k: kind }));
  return `${body}.${sign(secret, body)}`;
}
export function readToken(secret, token, kind) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const good = sign(secret, body);
  if (sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const t = JSON.parse(Buffer.from(body, "base64url").toString()); return t.k === kind && t.x > Date.now() ? t.e : null; } catch { return null; }
}
const cookies = req => Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(p => p[0]).map(([k, ...v]) => [k, v.join("=")]));

export function createApp(db) {
  const c = cfg();
  if (c.production && c.sessionSecret === "dev-only-secret-change-me") throw new Error("Set SESSION_SECRET in production");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => { res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" }); next(); });
  app.get("/healthz", (_q, r) => r.json({ ok: true }));

  // --- sign-in by emailed link (approvers only) ---
  const loginAttempts = new Map();
  app.post("/auth/request", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const key = `${req.ip}|${email}`; const n = (loginAttempts.get(key) || 0) + 1; loginAttempts.set(key, n);
    setTimeout(() => loginAttempts.delete(key), 15 * 60e3).unref();
    if (n > 5) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
    // Same answer whether or not the address is allowed, so addresses are not revealed.
    if (c.approvers.includes(email)) {
      const url = `${c.baseUrl}/auth/verify?token=${makeToken(c.sessionSecret, email, 15 * 60e3, "login")}`;
      await sendMail(db, email, "Your sign-in link", `<p>Sign in to LinkedIn Content Automation (valid 15 minutes):</p><p><a href="${esc(url)}">${esc(url)}</a></p>`);
      if (!c.smtpUrl && !c.production) return res.json({ ok: true, devLink: url });
      if (!c.smtpUrl) console.log(`[auth] SMTP_URL not set; sign-in link for ${email}: ${url}`);
    }
    res.json({ ok: true });
  });
  app.get("/auth/verify", (req, res) => {
    const email = readToken(c.sessionSecret, req.query.token, "login");
    if (!email) return res.status(400).send("This link is invalid or expired. Request a new one.");
    const session = makeToken(c.sessionSecret, email, 12 * 3600e3, "session");
    res.set("Set-Cookie", `session=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 3600}${c.production ? "; Secure" : ""}`);
    res.redirect("/");
  });
  app.post("/auth/logout", (_q, res) => { res.set("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0"); res.json({ ok: true }); });

  const requireUser = (req, res, next) => {
    const email = readToken(c.sessionSecret, cookies(req).session, "session");
    if (!email || !c.approvers.includes(email)) return res.status(401).json({ error: "Sign in required" });
    req.user = email; next();
  };
  const shape = r => r && ({ ...r, word_count: r.draft ? wordCount(r.draft) : 0 });
  const wrap = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { if (e instanceof UserError) return res.status(400).json({ error: e.message }); console.error(e); res.status(500).json({ error: "Something went wrong" }); }
  };
  const background = p => p.catch(e => console.error("background error", e));

  app.get("/api/me", requireUser, (req, res) => res.json({ email: req.user, publishMode: c.publishMode, mockAgent: c.mockAgent }));
  app.get("/api/config", requireUser, (_q, res) => res.json({ industries: INDUSTRIES, audiences: AUDIENCES, styles: STYLES, recencyMonths: RECENCY_MONTHS }));
  app.get("/api/runs", requireUser, (_q, res) => res.json(db.prepare("SELECT id FROM runs ORDER BY id DESC LIMIT 200").all().map(r => shape(getRun(db, r.id)))));
  app.get("/api/runs/:id", requireUser, (req, res) => {
    const r = getRun(db, Number(req.params.id)); if (!r) return res.status(404).json({ error: "Not found" });
    res.json({ ...shape(r), events: db.prepare("SELECT ts,actor,text FROM events WHERE run_id=? ORDER BY id").all(r.id) });
  });
  app.post("/api/runs", requireUser, wrap(req => {
    const id = createRun(db, req.body || {}, req.user);
    background(runCurate(db, id));
    return { id, message: `RUN-${id} submitted. Approvals appear in My To-Do.` };
  }));
  const act = fn => wrap(req => {
    const out = fn(db, Number(req.params.id), req.user, req.body || {});
    background(out.after());
    return { status: out.status, message: out.message };
  });
  app.post("/api/runs/:id/gate1", requireUser, act(gate1));
  app.post("/api/runs/:id/gate2", requireUser, act(gate2));
  app.get("/api/stats", requireUser, (_q, res) => {
    const by = db.prepare("SELECT status, COUNT(*) n FROM runs GROUP BY status").all();
    const weekly = db.prepare("SELECT strftime('%Y-%W', created_at) wk, COUNT(*) n FROM runs GROUP BY wk ORDER BY wk DESC LIMIT 12").all().reverse();
    res.json({ byStatus: by, weekly, total: by.reduce((s, r) => s + r.n, 0), published: by.find(r => r.status === ST.PUBLISHED)?.n || 0 });
  });
  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
  return app;
}

export function start() {
  const c = cfg();
  const db = openDb(c.dbPath);
  if (c.publishMode === "live" && (!c.liToken || !c.liAuthor)) throw new Error("PUBLISH_MODE=live needs LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN");
  if (!c.mockAgent && !c.anthropicKey) console.warn("[warn] ANTHROPIC_API_KEY not set: curation will fail until it is.");
  // Runs interrupted by a restart cannot resume on their own: mark them failed so they are visible.
  db.prepare("UPDATE runs SET status=?, failure_reason='Interrupted by a restart' WHERE status IN (?,?,?,?)").run(ST.FAILED, ST.CURATING, ST.DRAFTING, ST.REVISING, ST.PUBLISHING);
  setInterval(() => expireStale(db).catch(e => console.error(e)), 60 * 60e3).unref();
  createApp(db).listen(c.port, () => console.log(`Listening on ${c.port} (publish=${c.publishMode}, agent=${c.mockAgent ? "mock" : "live"})`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
