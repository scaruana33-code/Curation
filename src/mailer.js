import nodemailer from "nodemailer";
import { cfg } from "./config.js";

let transport;
export async function sendMail(db, to, subject, html) {
  const c = cfg();
  const rows = (Array.isArray(to) ? to : [to]);
  for (const addr of rows) {
    const r = db.prepare("INSERT INTO outbox (ts,to_addr,subject,body) VALUES (?,?,?,?)").run(new Date().toISOString(), addr, subject, html);
    if (!c.smtpUrl) { console.log(`[mail:not-sent] to=${addr} subject=${subject}`); continue; }
    try {
      transport ||= nodemailer.createTransport(c.smtpUrl);
      await transport.sendMail({ from: c.mailFrom, to: addr, subject, html });
      db.prepare("UPDATE outbox SET sent=1 WHERE id=?").run(r.lastInsertRowid);
    } catch (e) {
      db.prepare("UPDATE outbox SET error=? WHERE id=?").run(String(e.message).slice(0, 300), r.lastInsertRowid);
      console.error("mail error", e.message);
    }
  }
}
export const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
