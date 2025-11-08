// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { nanoid } from "nanoid";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
  })
);

// SMTP transporter (Gmail app password recommended)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 465),
  secure: (process.env.SMTP_SECURE ?? "true") === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter
  .verify()
  .then(() => console.log(`✅ Connected to SMTP as ${process.env.SMTP_USER}`))
  .catch((err) => console.error("❌ SMTP verify failed:", err));

// In-memory invites store
// projectId -> [ { id, projectId, projectTitle, sellerId, sellerName, sellerEmail, score, overlap, status, createdAt, offeredPrice?, offerNote?, offeredAt?, messageId? } ]
const invitesByProject = new Map();

function findInvite(inviteId) {
  for (const [projectId, list] of invitesByProject.entries()) {
    const idx = list.findIndex((i) => i.id === inviteId);
    if (idx !== -1) return { projectId, idx, invite: list[idx] };
  }
  return null;
}

// Admin notify/create invites (draft toggle supported)
app.post("/api/notify-sellers", async (req, res) => {
  try {
    const { project, rankedSellers, draft } = req.body || {};
    if (!project || !Array.isArray(rankedSellers)) {
      return res.status(400).send("Invalid payload: { project, rankedSellers[] } required");
    }

    const N = Number(process.env.TOP_N || 5);
    const picks = rankedSellers
      .filter((s) => s?.email)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, N);

    const baseServer = process.env.SERVER_URL || `http://localhost:${PORT}`;
    const invites = [];

    for (const pick of picks) {
      const inviteId = nanoid(10);
      const acceptUrl = `${baseServer}/api/invite/${inviteId}/accept`;
      const rejectUrl = `${baseServer}/api/invite/${inviteId}/reject`;

      const invite = {
        id: inviteId,
        projectId: project.id,
        projectTitle: project.title || "",
        sellerId: pick.sellerId,
        sellerName: pick.name,
        sellerEmail: pick.email,
        score: pick.score ?? 0,
        overlap: Array.isArray(pick.overlap) ? pick.overlap : [],
        createdAt: new Date().toISOString(),
        status: draft ? "draft" : "sent",
      };

      const list = invitesByProject.get(project.id) || [];
      list.unshift(invite);
      invitesByProject.set(project.id, list);
      invites.push(invite);

      // If not draft, send initial invite email (without price)
      if (!draft) {
        const plain = [
          `Hi ${pick.name},`,
          ``,
          `You match a new project "${project.title}" (score ${pick.score || 0}).`,
          `Category: ${project.category || "—"}`,
          `Overlap skills: ${(pick.overlap || []).join(", ") || "—"}`,
          `Deadline: ${project.deadline || "—"}`,
          ``,
          `Accept: ${acceptUrl}`,
          `Reject: ${rejectUrl}`,
          ``,
          `— IdeaMarket`,
        ].join("\n");

        const html = `
          <div style="font-family:system-ui,Segoe UI,Roboto,Arial;line-height:1.4;color:#0b1222">
            <p>Hi ${pick.name},</p>
            <p>You match a new project "<strong>${escapeHtml(project.title)}</strong>" (score ${pick.score || 0}).</p>
            <p>Category: ${escapeHtml(project.category || "—")}<br/>
               Overlap skills: ${escapeHtml((pick.overlap || []).join(", ") || "—")}<br/>
               Deadline: ${escapeHtml(project.deadline || "—")}</p>
            <p>
              <a href="${acceptUrl}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#4ade80;color:#081226;text-decoration:none;margin-right:8px;">Accept</a>
              <a href="${rejectUrl}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#fb7185;color:#081226;text-decoration:none;">Reject</a>
            </p>
            <hr/>
            <p style="color:#6b7280">If buttons don't work, use these links:<br/>
              Accept: <a href="${acceptUrl}">${acceptUrl}</a><br/>
              Reject: <a href="${rejectUrl}">${rejectUrl}</a>
            </p>
            <p>— IdeaMarket</p>
          </div>
        `;

        try {
          const info = await transporter.sendMail({
            from: process.env.FROM_EMAIL || process.env.SMTP_USER,
            to: pick.email,
            subject: `[IdeaMarket] ${project.title} — Invitation to propose`,
            text: plain,
            html,
          });
          invite.messageId = info.messageId;
        } catch (e) {
          invite.status = "error";
          invite.error = e?.message || String(e);
        }
      }
    }

    return res.json({
      ok: true,
      invites,
      sent: invites.filter((i) => i.status === "sent").length,
      draft: !!draft,
    });
  } catch (err) {
    console.error("notify-sellers error:", err);
    return res.status(500).send(err?.message || "Server error");
  }
});

// GET accept (clicked in email by user opening in browser)
app.get("/api/invite/:id/accept", (req, res) => {
  const inviteId = req.params.id;
  const found = findInvite(inviteId);
  if (!found) return res.status(404).send("Invite not found");

  const { projectId, idx } = found;
  const list = invitesByProject.get(projectId);
  list[idx].status = "accepted";
  list[idx].acceptedAt = new Date().toISOString();
  invitesByProject.set(projectId, list);

  res.send(`
    <html>
      <body style="font-family: ui-sans-serif; padding: 24px;">
        <h2>Thanks, ${list[idx].sellerName}!</h2>
        <p>Your acceptance for project <b>${escapeHtml(list[idx].projectTitle || projectId)}</b> has been recorded.</p>
        <p>You can reply to the email to discuss next steps.</p>
      </body>
    </html>
  `);
});

// GET reject (clicked in email)
app.get("/api/invite/:id/reject", (req, res) => {
  const inviteId = req.params.id;
  const found = findInvite(inviteId);
  if (!found) return res.status(404).send("Invite not found");

  const { projectId, idx } = found;
  const list = invitesByProject.get(projectId);
  list[idx].status = "rejected";
  list[idx].rejectedAt = new Date().toISOString();
  invitesByProject.set(projectId, list);

  res.send(`
    <html>
      <body style="font-family: ui-sans-serif; padding: 24px;">
        <h2>Thanks, ${list[idx].sellerName}.</h2>
        <p>Your rejection for project <b>${escapeHtml(list[idx].projectTitle || projectId)}</b> has been recorded.</p>
        <p>Thanks for the quick response — we'll notify the admin.</p>
      </body>
    </html>
  `);
});

// Programmatic accept (from seller dashboard)
app.post("/api/invite/:id/accept", (req, res) => {
  const inviteId = req.params.id;
  const found = findInvite(inviteId);
  if (!found) return res.status(404).send("Invite not found");

  const { projectId, idx } = found;
  const list = invitesByProject.get(projectId);
  list[idx].status = "accepted";
  list[idx].acceptedAt = new Date().toISOString();
  invitesByProject.set(projectId, list);

  res.json({ ok: true, invite: list[idx] });
});

// Programmatic reject (from seller dashboard)
app.post("/api/invite/:id/reject", (req, res) => {
  const inviteId = req.params.id;
  const found = findInvite(inviteId);
  if (!found) return res.status(404).send("Invite not found");

  const { projectId, idx } = found;
  const list = invitesByProject.get(projectId);
  list[idx].status = "rejected";
  list[idx].rejectedAt = new Date().toISOString();
  invitesByProject.set(projectId, list);

  res.json({ ok: true, invite: list[idx] });
});

// Admin sets an offer on an invite (and optionally emails the offer with accept/reject links)
app.post("/api/invite/:id/offer", async (req, res) => {
  try {
    const inviteId = req.params.id;
    const { price, note, sendEmail } = req.body || {};
    const found = findInvite(inviteId);
    if (!found) return res.status(404).send("Invite not found");

    const { projectId, idx } = found;
    const list = invitesByProject.get(projectId);
    list[idx].offeredPrice = price;
    list[idx].offerNote = note || "";
    list[idx].offeredAt = new Date().toISOString();
    list[idx].status = "offered";
    invitesByProject.set(projectId, list);

    if (sendEmail) {
      const acceptUrl = `${process.env.SERVER_URL || `http://localhost:${PORT}`}/api/invite/${inviteId}/accept`;
      const rejectUrl = `${process.env.SERVER_URL || `http://localhost:${PORT}`}/api/invite/${inviteId}/reject`;

      const plain = [
        `Hi ${list[idx].sellerName},`,
        ``,
        `Admin has sent an offer for the project "${list[idx].projectTitle || projectId}".`,
        `Project details: ${list[idx].projectTitle ? "" : ""}`, // you can include more fields if you stored them
        `Offered Price: ${price || "—"}`,
        `Note: ${note || "—"}`,
        ``,
        `If you accept, click: ${acceptUrl}`,
        `If you reject, click: ${rejectUrl}`,
        ``,
        `— IdeaMarket`,
      ].join("\n");

      const html = `
        <div style="font-family:system-ui,Segoe UI,Roboto,Arial;color:#0b1222;line-height:1.4">
          <p>Hi ${escapeHtml(list[idx].sellerName)},</p>
          <p>Admin has sent an offer for the project "<strong>${escapeHtml(list[idx].projectTitle || projectId)}</strong>".</p>
          <p>Offered Price: <strong>${escapeHtml(String(price || "—"))}</strong><br/>
             Note: ${escapeHtml(note || "—")}</p>
          <p>
            <a href="${acceptUrl}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#4ade80;color:#081226;text-decoration:none;margin-right:8px;">Accept</a>
            <a href="${rejectUrl}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#fb7185;color:#081226;text-decoration:none;">Reject</a>
          </p>
          <hr/>
          <p style="color:#6b7280">If buttons don't work, use these links:<br/>
             Accept: <a href="${acceptUrl}">${acceptUrl}</a><br/>
             Reject: <a href="${rejectUrl}">${rejectUrl}</a>
          </p>
          <p>— IdeaMarket</p>
        </div>
      `;

      try {
        const info = await transporter.sendMail({
          from: process.env.FROM_EMAIL || process.env.SMTP_USER,
          to: list[idx].sellerEmail,
          subject: `[IdeaMarket] Offer for "${list[idx].projectTitle || projectId}"`,
          text: plain,
          html,
        });
        list[idx].messageId = info.messageId;
        invitesByProject.set(projectId, list);
      } catch (e) {
        list[idx].status = "error";
        list[idx].error = e?.message || String(e);
        invitesByProject.set(projectId, list);
      }
    }

    return res.json({ ok: true, invite: list[idx] });
  } catch (err) {
    console.error("offer error:", err);
    return res.status(500).send(err?.message || "Server error");
  }
});

// fetch invites for a project (admin UI uses this)
app.get("/api/project/:id/invites", (req, res) => {
  const invites = invitesByProject.get(req.params.id) || [];
  res.json({ invites });
});

// fetch invites for a seller (seller dashboard)
app.get("/api/seller/:sellerId/invites", (req, res) => {
  const sellerId = req.params.sellerId;
  const all = [];
  for (const list of invitesByProject.values()) {
    for (const inv of list) {
      if (inv.sellerId === sellerId) all.push(inv);
    }
  }
  all.sort((a, b) => new Date(b.acceptedAt || b.offeredAt || b.createdAt) - new Date(a.acceptedAt || a.offeredAt || a.createdAt));
  res.json({ invites: all });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/test-email", (req, res) => res.json({ ok: true, msg: "server up" }));
// Root route (fixes "Cannot GET /")
app.get("/", (req, res) => {
  res.send(`
    <html>
      <body style="font-family: ui-sans-serif; padding: 24px;">
        <h2>IdeaMatch Mailer</h2>
        <p>Mailer running at <b>${process.env.SERVER_URL || `http://localhost:${PORT}`}</b></p>
        <ul>
          <li><a href="/api/health">/api/health</a> — health check</li>
          <li><a href="/api/test-email">/api/test-email</a> — test endpoint</li>
        </ul>
        <p>Use the <code>/api/</code> routes for invites, offers, accept/reject.</p>
      </body>
    </html>
  `);
});


app.listen(PORT, () => {
  console.log(`📨 Mailer running at http://localhost:${PORT}`);
});

// small helper to escape HTML
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
