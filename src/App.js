// src/App.jsx
import React, { useEffect, useMemo, useState, createContext, useContext, useCallback } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, Navigate } from "react-router-dom";

/* ===================================================================
   Full CSS (paste your styling — this is the full CSS used previously)
   =================================================================== */
const baseCss = ` ...your existing CSS... `; // keep the same CSS string you had

/* ===================================================================
   Mock API (LocalStorage) + Real mailer base
   =================================================================== */
const LS_KEY = "idea_market_db_v2";
const EMAIL_BASE = process.env.REACT_APP_EMAIL_BASE || "http://localhost:4000";

const seedDB = () => ({
  users: [
    { id: "u-admin", role: "admin", name: "Admin", email: "admin@local", password: "admin123", quals:{skills:[],categories:[]} },
    { id: "u-1", role: "user", name: "Hari", email: "hari@local", password: "hari123", quals:{skills:[],categories:[]} },
    { id: "s-1", role: "seller", name: "DevCraft Studio", email: "dev@local", password: "dev123", quals:{skills:["react","node","postgres"],categories:["web"]} },
    { id: "s-2", role: "seller", name: "MobileMint", email: "mobile@local", password: "mobile123", quals:{skills:["flutter","android","ios"],categories:["mobile"]} },
    { id: "s-3", role: "seller", name: "AIML Works", email: "aiml@local", password: "aiml123", quals:{skills:["python","ml","nlp"],categories:["ai","ml"]} },
  ],
  projects: [],
  reviews: [],
  follows: {},
  outbox: []
});

function migrateDB(db) {
  if (!db || typeof db !== "object") db = {};
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.projects)) db.projects = [];
  if (!Array.isArray(db.reviews)) db.reviews = [];
  if (!db.follows || typeof db.follows !== "object") db.follows = {};
  if (!Array.isArray(db.outbox)) db.outbox = [];

  db.projects = db.projects.map((p) => ({
    ...p,
    skills: Array.isArray(p.skills) ? p.skills : [],
    status: p.status || "pending",
    history: Array.isArray(p.history) ? p.history : [{ at: p.createdAt || new Date().toISOString(), by: p.userId || "system", action: "created", note: "" }]
  }));

  return db;
}

const readDB = () => {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) {
    const seeded = seedDB();
    localStorage.setItem(LS_KEY, JSON.stringify(seeded));
    return seeded;
  }
  const parsed = JSON.parse(raw);
  const migrated = migrateDB(parsed);
  localStorage.setItem(LS_KEY, JSON.stringify(migrated));
  return migrated;
};
const writeDB = (db) => localStorage.setItem(LS_KEY, JSON.stringify(db));

const api = {
  async register({ role, name, email, password }) {
    const db = readDB();
    if (db.users.find(u => u.email === email && u.role === role)) throw new Error("Account already exists");
    const u = { id: crypto.randomUUID(), role, name, email, password, quals:{skills:[],categories:[]} };
    db.users.push(u); writeDB(db); return u;
  },
  async login({ role, email, password }) {
    const db = readDB();
    const u = db.users.find(x => x.email === email && x.role === role);
    if (!u || u.password !== password) throw new Error("Invalid credentials");
    return u;
  },

  // Accept/Reject invite (POST endpoints)
  async acceptInvite(inviteId) {
    const res = await fetch(`${EMAIL_BASE}/api/invite/${inviteId}/accept`, { method: "POST" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Server ${res.status} ${res.statusText}`);
    }
    return res.json();
  },
  async rejectInvite(inviteId) {
    const res = await fetch(`${EMAIL_BASE}/api/invite/${inviteId}/reject`, { method: "POST" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Server ${res.status} ${res.statusText}`);
    }
    return res.json();
  },

  // projects & users local storage operations unchanged
  async listUsers() { return readDB().users; },
  async listSellers() { return readDB().users.filter(u => u.role === "seller"); },
  async submitProject({ userId, title, description, category, skills, budget, deadline }) {
    const db = readDB();
    const p = {
      id: crypto.randomUUID(),
      userId, title, description, category, skills: Array.isArray(skills)?skills:[],
      budget, deadline, createdAt: new Date().toISOString(),
      status: "pending",
      history: [{ at: new Date().toISOString(), by: userId, action: "created", note: "" }]
    };
    db.projects.unshift(p); writeDB(db); return p;
  },
  async myProjects(userId) { return readDB().projects.filter(p => p.userId === userId); },
  async listProjects() { return readDB().projects; },

  async upsertSellerQuals({ sellerId, skills, categories }) {
    const db = readDB();
    const s = db.users.find(x => x.id === sellerId && x.role === "seller");
    if (!s) throw new Error("Seller not found");
    s.quals = { skills, categories }; writeDB(db); return s;
  },

  async getFollows(userId) { return new Set(readDB().follows[userId] || []); },
  async toggleFollow(userId, sellerId) {
    const db = readDB();
    const set = new Set(db.follows[userId] || []);
    set.has(sellerId) ? set.delete(sellerId) : set.add(sellerId);
    db.follows[userId] = Array.from(set); writeDB(db); return db.follows[userId];
  },

  async addReview({ userId, sellerId, rating, text }) {
    const db = readDB();
    const r = { id: crypto.randomUUID(), userId, sellerId, rating, text, createdAt: new Date().toISOString() };
    db.reviews.unshift(r); writeDB(db); return r;
  },
  async myReviews(userId) { return readDB().reviews.filter(r => r.userId === userId); },
  async deleteReview(reviewId, userId) {
    const db = readDB();
    db.reviews = db.reviews.filter(r => !(r.id === reviewId && r.userId === userId));
    writeDB(db);
  },

  async setProjectStatus({ projectId, byUserId, status, note }) {
    const db = readDB();
    const p = db.projects.find(x => x.id === projectId);
    if (!p) throw new Error("Project not found");
    p.status = status;
    p.history = Array.isArray(p.history) ? p.history : [];
    p.history.push({ at: new Date().toISOString(), by: byUserId, action: status, note: note || "" });
    writeDB(db); return p;
  },

  // Local outbox simulation
  async listOutbox() {
    const db = readDB();
    return Array.isArray(db.outbox) ? db.outbox : [];
  },
  async clearOutbox() {
    const db = readDB();
    db.outbox = [];
    writeDB(db);
  },
  async sendEmailSim({ to, subject, body }) {
    const db = readDB();
    if (!Array.isArray(db.outbox)) db.outbox = [];
    db.outbox.unshift({
      id: crypto.randomUUID(),
      to, subject, body,
      at: new Date().toISOString()
    });
    writeDB(db);
  },

  // Real email service (Node server)
  async emailNotifyTopSellers(project, rankedSellers, draft = false) {
    const res = await fetch(`${EMAIL_BASE}/api/notify-sellers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, rankedSellers, draft }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Server ${res.status} ${res.statusText}`);
    }
    return res.json(); // { ok, invites, sent, draft }
  },

  async getProjectInvites(projectId) {
    const res = await fetch(`${EMAIL_BASE}/api/project/${projectId}/invites`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Server ${res.status} ${res.statusText}`);
    }
    return res.json(); // { invites: [...] }
  },

  async getSellerInvites(sellerId) {
    const res = await fetch(`${EMAIL_BASE}/api/seller/${sellerId}/invites`);
    if (!res.ok) throw new Error("Failed to load seller invites");
    return res.json();
  },

  async offerInvite(inviteId, price, note = "", sendEmail = false) {
    const res = await fetch(`${EMAIL_BASE}/api/invite/${inviteId}/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price, note, sendEmail }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Server ${res.status} ${res.statusText}`);
    }
    return res.json();
  },
};

/* ===================================================================
   Auth Context (unchanged)
   =================================================================== */
const AuthCtx = createContext(null);
const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }) {
  const [account, setAccount] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("auth_account") || "null"); } catch { return null; }
  });
  useEffect(() => {
    if (account) sessionStorage.setItem("auth_account", JSON.stringify(account));
    else sessionStorage.removeItem("auth_account");
  }, [account]);
  const value = useMemo(() => ({ account, setAccount }), [account]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

/* ===================================================================
   Small UI components (Nav, Hero, FancyButton, Section, etc.)
   (These are lightweight copies of the components you used previously)
   =================================================================== */

/* eslint-disable no-unused-vars */
/* eslint-disable-next-line no-unused-vars */
function FancyButton({ children, onClick, kind="primary" }) {
  const base = "btn neon-btn sparkle-btn";
  const cls = kind==="primary" ? base : base+" ghost";
  return (
    <button className={cls} onClick={onClick} style={{position:"relative"}}>
      <span className="shimmer" />
      {children}
    </button>
  );
}

/* eslint-disable-next-line no-unused-vars */
function Section({ title, subtitle, right, children }) {
  return (
    <div className="card glass-heavy tilt-card" style={{marginTop:16}}>
      ...
    </div>
  );
}

/* eslint-enable no-unused-vars */

function Nav() {
  const { account, setAccount } = useAuth();
  const nav = useNavigate();
  return (
    <div className="nav">
      <div className="brand"><span className="dot"/><Link to="/">IdeaMarket.in</Link></div>
      <div className="navlinks">
        <Link className="pill" to="/">Home</Link>
        <Link className="pill" to="/projects">Projects</Link>
        {account?.role === "user" && <Link className="pill" to="/user">My Dashboard</Link>}
        {account?.role === "seller" && <Link className="pill" to="/seller">Seller</Link>}
        <Link className="pill" to="/admin">Admin</Link>
      </div>
      <div className="search"><input placeholder="Search services, skills, projects…" /></div>
      {account ? (
        <div className="row">
          <span className="pill">{account.role}: {account.name}</span>
          <button className="btn ghost" onClick={() => { setAccount(null); nav("/"); }}>Logout</button>
        </div>
      ) : (
        <div className="row">
          <Link className="btn ghost" to="/login/user">User</Link>
          <Link className="btn ghost" to="/login/seller">Seller</Link>
          <Link className="btn ghost" to="/login/admin">Admin</Link>
        </div>
      )}
    </div>
  );
}

function Hero(){
  return (
    <section className="hero">
      <div className="hero-inner">
        <h1>Turn your idea into a product</h1>
        <p>Post a project and get matched with qualified sellers. Or browse ready-made service packs.</p>
        <div className="hero-cta">
          <Link className="btn primary" to="/login/user">Post an Idea</Link>
          <Link className="btn ghost" to="/projects">Browse Projects</Link>
        </div>
      </div>
    </section>
  );
}

/* ===================================================================
   Projects page + forms (kept minimal for brevity)
   =================================================================== */

function BrowseProjects() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.listProjects().then(setItems); }, []);
  return (
    <div className="grid" style={{marginTop:16}}>
      <div className="row" style={{alignItems:"center"}}>
        <h2 style={{margin:0}}>Recent Project Ideas</h2>
        <span className="right pill">{items.length} total</span>
      </div>
      <div className="grid cols-3">
        {items.map(p => (
          <div key={p.id} className="card">
            <div className="row" style={{alignItems:"center"}}>
              <h3 style={{margin:0}}>{p.title}</h3>
              <span className="right pill">{new Date(p.createdAt).toLocaleString()}</span>
            </div>
            <p className="muted">Category: {p.category || '—'} • Skills: {(p.skills||[]).join(", ") || '—'}</p>
            <p style={{whiteSpace:'pre-wrap'}}>{p.description}</p>
            <div className="row">
              <span className="pill">Budget: {p.budget || '—'}</span>
              <span className="pill">Deadline: {p.deadline || '—'}</span>
              <span className="right"/>
              <button className="btn ghost">Save</button>
              <button className="btn">Contact</button>
            </div>
          </div>
        ))}
      </div>
      {!items.length && <p className="muted">No projects yet.</p>}
    </div>
  );
}

/* ===================================================================
   Auth Screens (Login/Register) - minimal for demo
   =================================================================== */
function Login({ role }) {
  const { setAccount } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const from = (useLocation().state || {}).from?.pathname;

  const doLogin = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      const u = await api.login({ role, email, password });
      setAccount(u);
      if (role === "user") nav("/user");
      else if (role === "seller") nav("/seller");
      else if (role === "admin") nav("/admin");
      else nav(from || "/");
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="grid cols-2" style={{marginTop:16}}>
      <div className="card">
        <h2>{role[0].toUpperCase()+role.slice(1)} Login</h2>
        <form onSubmit={doLogin} className="grid" style={{gap:10}}>
          <div><label>Email</label><input value={email} onChange={e=>setEmail(e.target.value)} type="email" required placeholder={role==='user'?'hari@local':''}/></div>
          <div><label>Password</label><input value={password} onChange={e=>setPassword(e.target.value)} type="password" required placeholder={role==='user'?'hari123':''}/></div>
          {err && <p className="danger">{err}</p>}
          <button className="btn primary" type="submit">Login</button>
        </form>
      </div>
      {role !== 'admin' && (
        <div className="card">
          <h3>New here?</h3>
          <p className="muted">Create a {role} account.</p>
          <Link className="btn ghost" to={`/register/${role}`}>Go to Registration</Link>
        </div>
      )}
    </div>
  );
}

function Register({ role }) {
  const { setAccount } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const doRegister = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      const u = await api.register({ role, name, email, password });
      setAccount(u);
      if (role === "user") nav("/user");
      else if (role === "seller") nav("/seller");
      else nav("/");
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="card" style={{marginTop:16}}>
      <h2>Register as {role}</h2>
      <form onSubmit={doRegister} className="grid" style={{gap:10}}>
        <div><label>Name</label><input value={name} onChange={e=>setName(e.target.value)} required/></div>
        <div><label>Email</label><input value={email} onChange={e=>setEmail(e.target.value)} type="email" required/></div>
        <div><label>Password</label><input value={password} onChange={e=>setPassword(e.target.value)} type="password" required/></div>
        {err && <p className="danger">{err}</p>}
        <button className="btn primary" type="submit">Create account</button>
      </form>
    </div>
  );
}

/* ===================================================================
   Seller Dashboard (uses mailer endpoints)
   - refreshInvites wrapped in useCallback -> included in useEffect deps
   =================================================================== */
function SellerDashboard() {
  const { account, setAccount } = useAuth();
  const [skillsText, setSkillsText] = useState(account?.quals?.skills?.join(", ") || "");
  const [catsText, setCatsText] = useState(account?.quals?.categories?.join(", ") || "");
  const [saving, setSaving] = useState(false);

  const [projects, setProjects] = useState([]);
  const [myInvites, setMyInvites] = useState([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [acceptingId, setAcceptingId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);

  useEffect(() => { api.listProjects().then(setProjects); }, []);

  const refreshInvites = useCallback(async () => {
    if (!account) return;
    setLoadingInvites(true);
    try {
      const { invites } = await api.getSellerInvites(account.id);
      invites.sort((a,b)=> new Date(b.createdAt || b.offeredAt || b.acceptedAt) - new Date(a.createdAt || a.offeredAt || a.acceptedAt));
      setMyInvites(invites);
    } catch (e) {
      console.error("refreshInvites", e);
    } finally {
      setLoadingInvites(false);
    }
  }, [account]);

  useEffect(()=> { if (account) refreshInvites(); }, [account, refreshInvites]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const skills = skillsText.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
    const categories = catsText.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
    const u = await api.upsertSellerQuals({ sellerId: account.id, skills, categories });
    setAccount(u);
    setSaving(false);
  };

  const acceptInvite = async (inviteId) => {
    try {
      setAcceptingId(inviteId);
      await api.acceptInvite(inviteId);
      await refreshInvites();
    } catch (e) { alert(e.message || e); }
    finally { setAcceptingId(null); }
  };

  const rejectInvite = async (inviteId) => {
    try {
      setRejectingId(inviteId);
      await api.rejectInvite(inviteId);
      await refreshInvites();
    } catch (e) { alert(e.message || e); }
    finally { setRejectingId(null); }
  };

  const acceptedProjectIds = new Set(myInvites.filter(i=>i.status==="accepted").map(i => i.projectId));

  return (
    <div style={{marginTop:16}} className="grid cols-2">
      <div className="card">
        <h2>Your Qualifications</h2>
        <form onSubmit={save} className="grid" style={{gap:10}}>
          <div><label>Skills</label><input value={skillsText} onChange={e=>setSkillsText(e.target.value)} /></div>
          <div><label>Categories</label><input value={catsText} onChange={e=>setCatsText(e.target.value)} /></div>
          <button className="btn primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>

        <div className="card" style={{marginTop:16}}>
          <div className="row" style={{alignItems:"center"}}>
            <h3 style={{margin:0}}>Invitations</h3>
            <span className="right"/>
            <button className="btn ghost" onClick={refreshInvites} disabled={loadingInvites}>
              {loadingInvites ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {!myInvites.length && <p className="muted">No invitations yet.</p>}

          {!!myInvites.length && (
            <table className="table">
              <thead><tr><th>Project</th><th>Score</th><th>Status</th><th>Action</th><th>When</th></tr></thead>
              <tbody>
                {myInvites.map(inv => {
                  return (
                    <tr key={inv.id}>
                      <td>{inv.projectTitle || inv.projectId}</td>
                      <td>{inv.score ?? "-"}</td>
                      <td>{inv.status}</td>
                      <td>
                        {inv.status === "accepted" ? <span className="pill ok">Accepted</span> : (
                          <>
                            <button className="btn primary" disabled={acceptingId===inv.id} onClick={()=>acceptInvite(inv.id)}>
                              {acceptingId===inv.id ? "Accepting…" : "Accept"}
                            </button>
                            <button className="btn ghost" style={{marginLeft:8}} disabled={rejectingId===inv.id} onClick={()=>rejectInvite(inv.id)}>
                              {rejectingId===inv.id ? "Rejecting…" : "Reject"}
                            </button>
                          </>
                        )}
                      </td>
                      <td className="muted">{new Date(inv.createdAt || inv.offeredAt || inv.acceptedAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Matched Projects</h2>
        {projects.map(p => (
          <div key={p.id} className="card" style={{marginBottom:10}}>
            <div className="row" style={{alignItems:"center"}}>
              <h3 style={{margin:0}}>{p.title}</h3>
              <span className="right pill"> {acceptedProjectIds.has(p.id) ? "You accepted" : ""}</span>
            </div>
            <p className="muted">Category: {p.category} • Skills: {(p.skills||[]).join(", ")}</p>
            <p style={{whiteSpace:"pre-wrap"}}>{p.description}</p>
            <div className="row">
              <span className="pill">Budget: {p.budget}</span>
              <span className="pill">Deadline: {p.deadline}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===================================================================
   Admin (prepare invites + set offers + send) — full code
   =================================================================== */
function Admin() {
  const { account } = useAuth();
  const adminId = account?.id || "u-admin";

  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [outbox, setOutbox] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [invitesByProject, setInvitesByProject] = useState({});
  const [sendingId, setSendingId] = useState(null);
  const [offerInputs, setOfferInputs] = useState({}); // inviteId -> { price, note, sending }

  useEffect(() => {
    (async ()=>{
      const dbProjects = await api.listProjects();
      const dbUsers = await api.listUsers();
      const mails = await api.listOutbox();
      setProjects(Array.isArray(dbProjects)?dbProjects:[]);
      setUsers(Array.isArray(dbUsers)?dbUsers:[]);
      setOutbox(Array.isArray(mails)?mails:[]);
    })();
  }, []);

  const byId = useMemo(() => Object.fromEntries((users||[]).map(u=>[u.id,u])), [users]);

  const matchInfo = (p) => {
    const skills = new Set(((p && p.skills) || []).map(s=>String(s).toLowerCase()));
    const cat = p?.category?.toLowerCase();
    return (users||[]).filter(u=>u.role==='seller').map(s => {
      const sSkills = new Set(((s.quals?.skills)||[]).map(x=>String(x).toLowerCase()));
      const sCats = new Set(((s.quals?.categories)||[]).map(x=>String(x).toLowerCase()));
      const skillOverlap = [...skills].filter(x => sSkills.has(x));
      const catMatch = !!(cat && sCats.has(cat));
      const score = skillOverlap.length + (catMatch?1:0);
      return { seller: s, score, skillOverlap, catMatch };
    }).sort((a,b)=>b.score-a.score);
  };

  const reload = async () => {
    const dbProjects = await api.listProjects();
    const mails = await api.listOutbox();
    setProjects(Array.isArray(dbProjects)?dbProjects:[]);
    setOutbox(Array.isArray(mails)?mails:[]);
  };

  async function refreshInvites(projectId) {
    try {
      const { invites } = await api.getProjectInvites(projectId);
      setInvitesByProject(prev => ({ ...prev, [projectId]: invites }));
      // initialize offer inputs for invites
      const map = {};
      (invites||[]).forEach(inv => { map[inv.id] = { price: inv.offeredPrice || "", note: inv.offerNote || "", sending:false }; });
      setOfferInputs(prev => ({ ...prev, ...map }));
    } catch (e) {
      console.error(e); alert(e.message || "Failed to load invites");
    }
  }

  const prepareInvitesDraft = async (project) => {
    try {
      setSendingId(project.id);
      const ranked = matchInfo(project).map(m => ({
        sellerId: m.seller.id,
        name: m.seller.name,
        email: m.seller.email,
        score: m.score,
        overlap: m.skillOverlap,
      }));
      const res = await api.emailNotifyTopSellers(project, ranked, true); // draft=true
      // fetch invites to show local offer form
      await refreshInvites(project.id);
      alert(`Prepared ${res.invites?.length || 0} draft invites. Set offers and click Send/Update Offer for each.`);
    } catch (e) {
      alert(e.message || "Prepare failed");
    } finally {
      setSendingId(null);
    }
  };

  const handleOfferInputChange = (inviteId, field, value) => {
    setOfferInputs(prev => ({ ...prev, [inviteId]: { ...(prev[inviteId]||{}), [field]: value } }));
  };

  const sendOfferForInvite = async (project, invite) => {
    const id = invite.id;
    const input = offerInputs[id] || {};
    const price = input.price;
    const note = input.note || "";
    setOfferInputs(prev => ({ ...prev, [id]: { ...(prev[id]||{}), sending:true } }));
    try {
      const { invite: updated } = await api.offerInvite(id, price, note, true); // sendEmail:true
      // update invites list locally
      await refreshInvites(project.id);
      await reload();
      alert(`Offer sent to ${updated.sellerName}`);
    } catch (e) {
      alert(e.message || "Failed to send offer");
    } finally {
      setOfferInputs(prev => ({ ...prev, [id]: { ...(prev[id]||{}), sending:false } }));
    }
  };

  return (
    <div className="grid" style={{marginTop:16}}>
      <div className="card">
        <div className="row" style={{alignItems:"center"}}>
          <h2 style={{margin:0}}>Admin: All Project Submissions</h2>
          <span className="right"/>
        </div>
      </div>

      {!projects.length && <p className="muted">No projects yet.</p>}

      {(projects||[]).map(p => (
        <div key={p.id} className="card">
          <div className="row" style={{alignItems:"center"}}>
            <h3 style={{margin:0}}>{p.title}</h3>
            <span className="pill" style={{marginLeft:8}}>Status: {p.status || "pending"} {p.winnerSellerName ? `• Winner: ${p.winnerSellerName}` : ""}</span>
            <span className="right pill">{new Date(p.createdAt).toLocaleString()}</span>
          </div>

          <p className="muted">From: {byId[p.userId]?.name || "Unknown"} • Category: {p.category || "—"} • Skills: {(p.skills||[]).join(", ") || "—"}</p>
          <p style={{whiteSpace:'pre-wrap'}}>{p.description}</p>

          <div className="row" style={{gap:8}}>
            <button className="btn ghost" disabled={busyId===p.id} onClick={()=>setProjectStatus(p.id,"approved")}>Approve</button>
            <button className="btn ghost" disabled={busyId===p.id} onClick={()=>setProjectStatus(p.id,"rejected")}>Reject</button>
            <button className="btn ghost" disabled={busyId===p.id} onClick={()=>setProjectStatus(p.id,"shortlisted")}>Shortlist</button>
            <button className="btn primary" disabled={busyId===p.id} onClick={()=>setProjectStatus(p.id,"accepted","Accepted by admin")}>Accept</button>

            <button className="btn primary" disabled={sendingId===p.id} onClick={()=>prepareInvitesDraft(p)}>
              {sendingId===p.id ? "Preparing…" : "Prepare invites (set offer first)"}
            </button>

            <button className="btn ghost" onClick={()=>refreshInvites(p.id)}>Refresh invites</button>
          </div>

          <details style={{marginTop:10}}>
            <summary>Matching sellers</summary>
            <table className="table">
              <thead><tr><th>Seller</th><th>Score</th><th>Overlap</th><th>Categories</th><th>Email</th></tr></thead>
              <tbody>
                {matchInfo(p).map(m => (
                  <tr key={m.seller.id}>
                    <td>{m.seller.name}</td>
                    <td>{m.score}</td>
                    <td>{m.skillOverlap.join(", ") || '—'}</td>
                    <td>{(m.seller.quals?.categories||[]).join(", ")||'—'}</td>
                    <td className="muted">{m.seller.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          <div className="card" style={{marginTop:10}}>
            <h4 style={{marginTop:0}}>Invites & Acceptances</h4>
            <table className="table">
              <thead><tr><th>Seller</th><th>Email</th><th>Score</th><th>Status</th><th>When</th><th>Action</th></tr></thead>
              <tbody>
                {(invitesByProject[p.id]||[]).map(inv => {
                  const input = offerInputs[inv.id] || { price: inv.offeredPrice || "", note: inv.offerNote || "", sending:false };
                  return (
                    <tr key={inv.id}>
                      <td>{inv.sellerName}</td>
                      <td className="muted">{inv.sellerEmail}</td>
                      <td>{inv.score}</td>
                      <td>{inv.status === 'accepted' ? "✅ accepted" : inv.status}</td>
                      <td className="muted">{inv.offeredAt ? new Date(inv.offeredAt).toLocaleString() : new Date(inv.createdAt).toLocaleString()}</td>
                      <td>
                        {inv.status === "accepted" ? (
                          <span className="pill ok">Accepted</span>
                        ) : (
                          <>
                            <div style={{display:"flex",gap:8,alignItems:"center"}}>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <span className="pill">{inv.sellerName}</span>
                                <input style={{width:120}} placeholder="Offer price" value={input.price} onChange={e=>handleOfferInputChange(inv.id,"price",e.target.value)} />
                                <input style={{width:320}} placeholder="Note (optional)" value={input.note} onChange={e=>handleOfferInputChange(inv.id,"note",e.target.value)} />
                                <button className="btn primary" disabled={input.sending} onClick={()=>sendOfferForInvite(p, inv)}>
                                  {input.sending ? "Sending…" : "Send/Update Offer"}
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!((invitesByProject[p.id]||[]).length) && (
                  <tr><td colSpan="6" className="muted">No invites yet. Click “Prepare invites (set offer first)” to create drafts, then set offers and click Send/Update Offer.</td></tr>
                )}
              </tbody>
            </table>
          </div>

        </div>
      ))}

      {/* Outbox table (using outbox state so it's not unused) */}
      <div className="card" style={{marginTop:16}}>
        <div className="row" style={{alignItems:"center"}}>
          <h3 style={{margin:0}}>Admin Outbox (email simulation)</h3>
          <span className="right"/>
          <button className="btn ghost" onClick={async ()=>{ await api.clearOutbox(); setOutbox([]); }}>Clear</button>
        </div>

        {!outbox.length && <p className="muted">No emails yet.</p>}
        {!!outbox.length && (
          <table className="table">
            <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Body</th></tr></thead>
            <tbody>
              {outbox.map(m => (
                <tr key={m.id}>
                  <td>{new Date(m.at).toLocaleString()}</td>
                  <td>{m.to}</td>
                  <td>{m.subject}</td>
                  <td className="muted" style={{whiteSpace:"pre-wrap"}}>{m.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );

  async function setProjectStatus(projectId, status, note) {
    try {
      setBusyId(projectId);
      await api.setProjectStatus({ projectId, byUserId: adminId, status, note });
      await reload();
    } finally {
      setBusyId(null);
    }
  }
}

/* ===================================================================
   Main App (Routing)
   =================================================================== */
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<div style={{marginTop:16}}><Hero/><BrowseProjects/></div>} />
      <Route path="/projects" element={<BrowseProjects/>} />
      <Route path="/login/user" element={<Login role="user"/>} />
      <Route path="/login/seller" element={<Login role="seller"/>} />
      <Route path="/login/admin" element={<Login role="admin"/>} />
      <Route path="/register/user" element={<Register role="user"/>} />
      <Route path="/register/seller" element={<Register role="seller"/>} />
      <Route path="/user" element={<RequireRole role="user"><div style={{padding:16}}>User dashboard placeholder</div></RequireRole>} />
      <Route path="/seller" element={<RequireRole role="seller"><SellerDashboard/></RequireRole>} />
      <Route path="/admin" element={<RequireRole role="admin"><Admin/></RequireRole>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RequireRole({ role, children }) {
  const { account } = useAuth();
  const location = useLocation();
  if (!account || account.role !== role) {
    return <Navigate to={`/login/${role}`} state={{ from: location }} replace />;
  }
  return children;
}

export default function App() {
  return (
    <div className="app">
      <style>{baseCss}</style>
      <div className="bg"></div>
      <BrowserRouter>
        <AuthProvider>
          <Nav/>
          <div style={{padding:12}}>
            <AppRoutes/>
          </div>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}
