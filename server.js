const express = require("express");
const fs = require("fs");
const path = require("path");
const sanitizeHtml = require("sanitize-html");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const DB_PATH = path.join(__dirname, "db.json");

// Load DB safely
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ questions: [] }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (e) {
    // if corrupted, reset
    const empty = { questions: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
}

// Save DB (atomic-ish via writeFileSync)
function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Simple id generator
function genId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,8);
}

// GET all questions
app.get("/api/questions", (req, res) => {
  const db = loadDB();
  // return newest first
  const out = db.questions.slice().sort((a,b) => b.createdAt - a.createdAt);
  res.json({ ok: true, questions: out });
});

// POST create question
app.post("/api/questions", (req, res) => {
  const raw = (req.body.text || "").toString().trim();
  if (!raw) return res.status(400).json({ ok: false, error: "empty" });
  // sanitize (allow no tags)
  const text = sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} });
  const db = loadDB();
  const q = {
    id: genId(),
    text,
    answers: [],
    likes: 0,
    likedBy: [],
    createdAt: Date.now()
  };
  db.questions.push(q);
  saveDB(db);
  res.json({ ok: true, question: q });
});

// POST answer
app.post("/api/questions/:id/answers", (req, res) => {
  const qid = req.params.id;
  const raw = (req.body.text || "").toString().trim();
  if (!raw) return res.status(400).json({ ok: false, error: "empty" });
  const text = sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} });
  const db = loadDB();
  const q = db.questions.find(x => x.id === qid);
  if (!q) return res.status(404).json({ ok: false, error: "not_found" });
  const ans = { id: genId(), text, createdAt: Date.now() };
  q.answers.push(ans);
  saveDB(db);
  res.json({ ok: true, answer: ans });
});

// POST like toggle
app.post("/api/questions/:id/toggle-like", (req, res) => {
  const qid = req.params.id;
  const userId = (req.body.userId || "").toString().trim();
  if (!userId) return res.status(400).json({ ok: false, error: "userId_required" });
  const db = loadDB();
  const q = db.questions.find(x => x.id === qid);
  if (!q) return res.status(404).json({ ok: false, error: "not_found" });
  const idx = q.likedBy.indexOf(userId);
  if (idx !== -1) {
    q.likedBy.splice(idx, 1);
    q.likes = Math.max(0, q.likes - 1);
    saveDB(db);
    return res.json({ ok: true, toggled: "removed", likes: q.likes });
  } else {
    q.likedBy.push(userId);
    q.likes = (q.likes || 0) + 1;
    saveDB(db);
    return res.json({ ok: true, toggled: "added", likes: q.likes });
  }
});

// simple health
app.get("/health", (req, res) => res.json({ ok: true }));

// fallback to index.html for SPA routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Band Vopros backend listening on port", PORT));
