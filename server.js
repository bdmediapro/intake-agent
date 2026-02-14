require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const OpenAI = require("openai");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Railway automatically provides DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Email transporter (Gmail example)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

let conversations = {};

// ==============================
// INIT TABLE
// ==============================
async function initDB() {
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
}
initDB();

// ==============================
// UI
// ==============================
app.get("/", (req, res) => {
  res.send("Intake Agent is running");
});

// ==============================
// START
// ==============================
app.post("/start", (req, res) => {
  const { sessionId, projectType } = req.body;

  conversations[sessionId] = {
    projectType,
    state: "ASK_BUDGET",
    data: {},
  };

  res.json({ success: true });
});

// ==============================
// CHAT
// ==============================
app.post("/chat", (req, res) => {
  const { sessionId, message } = req.body;
  const convo = conversations[sessionId];
  if (!convo) return res.status(400).json({ error: "No session" });

  if (convo.state === "ASK_BUDGET") {
    convo.data.budget = message;
    convo.state = "ASK_TIMELINE";
    return res.json({ success: true });
  }

  if (convo.state === "ASK_TIMELINE") {
    convo.data.timeline = message;
    convo.state = "COLLECT_CONTACT";
    return res.json({ success: true });
  }

  res.json({ success: true });
});

// ==============================
// COMPLETE
// ==============================
app.post("/complete", async (req, res) => {
  const { sessionId, name, email, phone, zip } = req.body;
  const convo = conversations[sessionId];
  if (!convo) return res.status(400).json({ error: "No session" });

  convo.data.name = name;
  convo.data.email = email;
  convo.data.phone = phone;
  convo.data.zip = zip;

  // Lead scoring
  let score = 0;
  if (convo.data.budget === "HIGH") score += 3;
  if (convo.data.budget === "MID") score += 2;
  if (convo.data.timeline === "ASAP") score += 3;
  if (convo.data.timeline === "SOON") score += 2;

  convo.data.score = score;

  // AI summary
  const summaryResponse = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: `
Generate a short internal contractor summary:

Project Type: ${convo.projectType}
Budget: ${convo.data.budget}
Timeline: ${convo.data.timeline}
Score: ${score}

Include:
- Overview
- Suggested sales angle
- Urgency note
    `,
  });

  let summary = "Summary unavailable";
  if (
    summaryResponse.output &&
    summaryResponse.output[0] &&
    summaryResponse.output[0].content &&
    summaryResponse.output[0].content[0]
  ) {
    summary = summaryResponse.output[0].content[0].text.trim();
  }

  convo.data.summary = summary;

  // Store in DB
  await pool.query(
    `INSERT INTO leads 
    (project_type, budget, timeline, name, email, phone, zip, score, summary)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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

  // Email contractor
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.CONTRACTOR_EMAIL,
    subject: "New Qualified Remodel Lead",
    text: `
New Lead:

Name: ${name}
Email: ${email}
Phone: ${phone}
Zip: ${zip}
Score: ${score}

${summary}
    `,
  });

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});
