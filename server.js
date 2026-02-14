require("dotenv").config();
const express = require("express");
const OpenAI = require("openai");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());
app.use(express.static("public"));

/* ==============================
   OPENAI
============================== */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ==============================
   POSTGRES
============================== */
console.log("DATABASE_URL AT START:", process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/* ==============================
   EMAIL
============================== */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/* ==============================
   MEMORY STORE
============================== */
let conversations = {};

/* ==============================
   START SESSION
============================== */
app.post("/start", (req, res) => {
  const { sessionId, projectType } = req.body;

  conversations[sessionId] = {
    projectType,
    state: "ASK_BUDGET",
    data: {},
  };

  console.log("Session started:", sessionId);
  res.json({ success: true });
});

/* ==============================
   CHAT
============================== */
app.post("/chat", (req, res) => {
  const { sessionId, message } = req.body;
  const convo = conversations[sessionId];

  if (!convo) return res.status(400).json({ error: "No session found" });

  if (convo.state === "ASK_BUDGET") {
    convo.data.budget = message;
    convo.state = "ASK_TIMELINE";
  } else if (convo.state === "ASK_TIMELINE") {
    convo.data.timeline = message;
    convo.state = "COLLECT_CONTACT";
  }

  res.json({ success: true });
});

/* ==============================
   COMPLETE
============================== */
app.post("/complete", async (req, res) => {
  try {
    const { sessionId, name, email, phone, zip } = req.body;
    console.log("COMPLETE endpoint hit:", sessionId);

    const convo = conversations[sessionId];
    if (!convo) return res.status(400).json({ error: "No session found" });

    let score = 0;
    if (convo.data.budget === "HIGH") score += 3;
    if (convo.data.budget === "MID") score += 2;
    if (convo.data.timeline === "ASAP") score += 3;
    if (convo.data.timeline === "SOON") score += 2;

    const summary = "AI temporarily disabled.";

    await pool.query(
      "INSERT INTO leads (project_type, budget, timeline, name, email, phone, zip, score, summary) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        convo.projectType,
        convo.data.budget,
        convo.data.timeline,
        name,
        email,
        phone,
        zip,
        score,
        summary,
      ]
    );

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.CONTRACTOR_EMAIL,
      subject: "New Qualified Remodel Lead",
      text:
        "Name: " + name +
        "\nEmail: " + email +
        "\nPhone: " + phone +
        "\nZIP: " + zip +
        "\nScore: " + score +
        "\n\n" + summary
    });

    res.json({ success: true });

  } catch (err) {
    console.error("Complete route error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});


/* ==============================
   START SERVER
============================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", async () => {
  console.log("Server running on port " + PORT);

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        project_type TEXT,
        budget TEXT,
        timeline TEXT,
        name TEXT,
        email TEXT,
        phone TEXT,
        zip TEXT,
        score INT,
        summary TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Database initialized");
  } catch (err) {
    console.error("Database connection failed:", err.message);
  }
});
