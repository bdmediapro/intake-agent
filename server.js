require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const OpenAI = require("openai");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");

const app = express();
app.use(bodyParser.json());

/* ==============================
   OPENAI
============================== */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ==============================
   POSTGRES (Railway internal)
============================== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/* ==============================
   EMAIL (Gmail App Password)
============================== */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/* ==============================
   INIT DATABASE TABLE
============================== */
async function initDB() {
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
    console.error("Database init error:", err);
  }
}
initDB();

/* ==============================
   TEMP SESSION STORE
============================== */
let conversations = {};

/* ==============================
   HEALTH
============================== */
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/* ==============================
   OPENAI TEST ROUTE
============================== */
app.get("/test-ai", async (req, res) => {
  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: "Say hello."
    });

    let output = "No response";

    if (
      response.output &&
      response.output[0] &&
      response.output[0].content &&
      response.output[0].content[0]
    ) {
      output = response.output[0].content[0].text;
    }

    res.json({ message: output });

  } catch (err) {
    console.error("AI test failed:", err);
    res.status(500).send("AI failed");
  }
});

/* ==============================
   ROOT
============================== */
app.get("/", (req, res) => {
  res.send("Intake Agent is running");
});

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

  res.json({ success: true });
});

/* ==============================
   CHAT (Budget + Timeline)
============================== */
app.post("/chat", (req, res) => {
  const { sessionId, message } = req.body;
  const convo = conversations[sessionId];

  if (!convo) {
    return res.status(400).json({ error: "No session found" });
  }

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

/* ==============================
   COMPLETE (Score + AI + DB + Email)
============================== */
app.post("/complete", async (req, res) => {
  try {
    const { sessionId, name, email, phone, zip } = req.body;
    const convo = conversations[sessionId];

    if (!convo) {
      return res.status(400).json({ error: "No session found" });
    }

    convo.data.name = name;
    convo.data.email = email;
    convo.data.phone = phone;
    convo.data.zip = zip;

    /* -------- LEAD SCORING -------- */
    let score = 0;

    if (convo.data.budget === "HIGH") score += 3;
    if (convo.data.budget === "MID") score += 2;

    if (convo.data.timeline === "ASAP") score += 3;
    if (convo.data.timeline === "SOON") score += 2;

    convo.data.score = score;

    /* -------- AI SUMMARY -------- */
    let summary = "Summary unavailable";

    try {
      const aiResponse = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: `
Generate a short internal contractor summary.

Project Type: ${convo.projectType}
Budget: ${convo.data.budget}
Timeline: ${convo.data.timeline}
Score: ${score}

Include:
- Quick overview
- Suggested sales angle
- Urgency assessment
        `,
      });

      if (
        aiResponse.output &&
        aiResponse.output[0] &&
        aiResponse.output[0].content &&
        aiResponse.output[0].content[0]
      ) {
        summary = aiResponse.output[0].content[0].text.trim();
      }

    } catch (aiError) {
      console.error("OpenAI summary error:", aiError);
    }

    convo.data.summary = summary;

    /* -------- STORE IN DATABASE -------- */
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

    console.log("Lead stored successfully");

    /* -------- EMAIL NOTIFICATION -------- */
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.CONTRACTOR_EMAIL,
      subject: "New Qualified Remodel Lead",
      text: `
New Lead:

Name: ${name}
Email: ${email}
Phone: ${phone}
ZIP: ${zip}
Score: ${score}

Summary:
${summary}
      `,
    });

    console.log("Email sent");

    res.json({ success: true });

  } catch (err) {
    console.error("Complete route error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ==============================
   START SERVER
============================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});
