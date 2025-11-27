// server.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const sqlite3 = require("sqlite3").verbose();
const { open } = require("sqlite");
const { v4: uuidv4 } = require("uuid");

const ADMIN_KEY = process.env.BV_ADMIN_KEY || "change_this_secret_to_env_var"; // задавай в env в проде
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.BV_DB_FILE || "bandvopros.sqlite";

(async () => {
  const db = await open({ filename: DB_FILE, driver: sqlite3.Database });

  // Инициализация схемы
  await db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS likes (
      question_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (question_id, user_id),
      FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
    );
  `);

  const app = express();

  app.use(helmet());
  app.use(cors()); // на проде ограничь origin по необходимости
  app.use(express.json({ limit: "10kb" })); // ограничение размера тела

  // rate limit (простая защита от спама)
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300
  });
  app.use(limiter);

  // --- API ---

  // GET /health
  app.get("/health", (req, res) => res.json({ ok: true }));

  // GET /questions
  // Возвращает все вопросы, их ответы и countLikes, а также информация, лайкнул ли текущий userId (если передан query userId)
  app.get("/questions", async (req, res) => {
    try {
      const rows = await db.all(`SELECT id, text, created_at FROM questions ORDER BY created_at DESC`);
      const result = [];
      const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : null;

      for (const q of rows) {
        const answers = await db.all(
          `SELECT id, text, created_at FROM answers WHERE question_id = ? ORDER BY created_at ASC`,
          q.id
        );
        const likeCountRow = await db.get(
          `SELECT COUNT(*) as cnt FROM likes WHERE question_id = ?`,
          q.id
        );
        const likedRow = userId ? await db.get(
          `SELECT 1 FROM likes WHERE question_id = ? AND user_id = ?`,
          q.id, userId
        ) : null;

        result.push({
          id: q.id,
          text: q.text,
          createdAt: q.created_at,
          answers: answers.map(a => ({ id: a.id, text: a.text, createdAt: a.created_at })),
          likes: likeCountRow ? likeCountRow.cnt : 0,
          likedByMe: !!likedRow
        });
      }

      res.json({ ok: true, questions: result });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  // POST /questions
  // body: { text, userId? }
  app.post("/questions", async (req, res) => {
    try {
      const text = (req.body.text || "").toString().trim();
      if (!text || text.length > 1000) return res.status(400).json({ ok: false, error: "invalid_text" });

      const id = uuidv4();
      const ts = Date.now();
      await db.run(`INSERT INTO questions (id, text, created_at) VALUES (?, ?, ?)`, id, text, ts);
      res.json({ ok: true, question: { id, text, createdAt: ts } });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  // POST /questions/:id/answers
  // body: { text, userId? }
  app.post("/questions/:id/answers", async (req, res) => {
    try {
      const qid = req.params.id;
      const text = (req.body.text || "").toString().trim();
      if (!text || text.length > 1000) return res.status(400).json({ ok: false, error: "invalid_text" });

      // Проверка существования вопроса
      const q = await db.get(`SELECT id FROM questions WHERE id = ?`, qid);
      if (!q) return res.status(404).json({ ok: false, error: "question_not_found" });

      const id = uuidv4();
      const ts = Date.now();
      await db.run(`INSERT INTO answers (id, question_id, text, created_at) VALUES (?, ?, ?, ?)`, id, qid, text, ts);
      res.json({ ok: true, answer: { id, text, createdAt: ts } });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  // POST /questions/:id/toggle-like
  // body: { userId }  (userId обязателен; клиент должен сохранить свой userId)
  app.post("/questions/:id/toggle-like", async (req, res) => {
    try {
      const qid = req.params.id;
      const userId = (req.body.userId || "").toString().trim();
      if (!userId) return res.status(400).json({ ok: false, error: "userId_required" });

      // убедимся, что вопрос существует
      const q = await db.get(`SELECT id FROM questions WHERE id = ?`, qid);
      if (!q) return res.status(404).json({ ok: false, error: "question_not_found" });

      const exists = await db.get(`SELECT 1 FROM likes WHERE question_id = ? AND user_id = ?`, qid, userId);
      if (exists) {
        await db.run(`DELETE FROM likes WHERE question_id = ? AND user_id = ?`, qid, userId);
        return res.json({ ok: true, toggled: "removed" });
      } else {
        const ts = Date.now();
        await db.run(`INSERT INTO likes (question_id, user_id, created_at) VALUES (?, ?, ?)`, qid, userId, ts);
        return res.json({ ok: true, toggled: "added" });
      }
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  // --- Admin routes (требуют x-admin-key header) ---

  function requireAdmin(req, res) {
    const key = req.headers["x-admin-key"];
    if (!key || key !== ADMIN_KEY) {
      res.status(403).json({ ok: false, error: "forbidden" });
      return false;
    }
    return true;
  }

  // DELETE /questions/:id  (удалить вопрос и все ответы/лайки)
  app.delete("/questions/:id", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const qid = req.params.id;
      await db.run(`DELETE FROM questions WHERE id = ?`, qid);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  // DELETE /answers/:id
  app.delete("/answers/:id", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const aid = req.params.id;
      await db.run(`DELETE FROM answers WHERE id = ?`, aid);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  // Простая страница корня
  app.get("/", (req, res) => {
    res.send("Band Vopros backend is running.");
  });

  app.listen(PORT, () => {
    console.log(`Band Vopros backend listening at http://localhost:${PORT}`);
  });
})();
