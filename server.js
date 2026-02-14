require("dotenv").config();

const express = require("express");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const OpenAI = require("openai");

const app = express();
app.use(express.json());
app.use(express.static("public"));

/* ==============================
   ENV CHECK
============================== */
console.log("DATABASE_URL:", process.env.DATABASE_URL);

/* ==============================
   DATABASE
============================== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/* ==============================
   OPENAI
============================== */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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
   SIMPLE SESSION STORE
============================== */
const sessions = {};

/* ==============================
   REGISTER
============================== */
app.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const hashed = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO contractors (email, password) VALUES ($1,$2)",
      [email, hashed]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("Register error:", err.message);
    res.status(500).json({ error: "Register failed" });
  }
});

/* ==============================
   LOGIN
============================== */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM contractors WHERE email=$1",
      [email]
    );

    if (result.rows.length === 0)
      return res.status(401).json({ error: "Invalid credentials" });

    const contractor = result.rows[0];
    const valid = await bcrypt.compare(password, contractor.password);

    if (!valid)
      return res.status(401).json({ error: "Invalid credentials" });

    const token = "sess_" + Math.random().toString(36).substring(2);
    sessions[token] = contractor.id;

    res.json({ success: true, token });

  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Login failed" });
  }
});

/* ==============================
   AI INTAKE
============================== */
app.post("/ai-intake", async (req, res) => {
  try {
    const { messages } = req.body;

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `
You are an AI intake assistant for remodeling contractors.

Collect:
- projectType
- budgetRange (LOW, MID, HIGH)
- timeline (ASAP, SOON, LATER, EXPLORING)
- zipCode
- fullName
- email
- phoneNumber

Ask one question at a time.

When complete, respond ONLY with:

FINAL_JSON:
{
  "projectType": "...",
  "budgetRange": "...",
  "timeline": "...",
  "zipCode": "...",
  "fullName": "...",
  "email": "...",
  "phoneNumber": "..."
}
`
        },
        ...messages
      ]
    });

    const reply =
      response.output?.[0]?.content?.[0]?.text ||
      "Something went wrong.";

    res.json({ reply });

  } catch (err) {
    console.error("AI error:", err.message);
    res.status(500).json({ error: "AI failed" });
  }
});

/* ==============================
   COMPLETE LEAD
============================== */
app.post("/complete", async (req, res) => {
  try {
    const {
      projectType,
      budget,
      timeline,
      zip,
      name,
      email,
      phone,
      contractorId,
      transcript
    } = req.body;

    let score = 0;
    if (budget === "HIGH") score += 3;
    if (budget === "MID") score += 2;
    if (timeline === "ASAP") score += 3;
    if (timeline === "SOON") score += 2;

    let summary = "Summary unavailable.";

    try {
      const aiResponse = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: `
Analyze this remodeling lead and provide:
1. Lead Quality
2. Urgency
3. Estimated Value Tier
4. Sales Strategy

Project: ${projectType}
Budget: ${budget}
Timeline: ${timeline}
ZIP: ${zip}
Transcript: ${transcript}
`
      });

      summary =
        aiResponse.output?.[0]?.content?.[0]?.text || summary;

    } catch (err) {
      console.error("AI summary error:", err.message);
    }

    await pool.query(
      `INSERT INTO leads 
      (contractor_id, project_type, budget, timeline, name, email, phone, zip, score, summary, transcript)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        contractorId,
        projectType,
        budget,
        timeline,
        name,
        email,
        phone,
        zip,
        score,
        summary,
        transcript
      ]
    );

    // Email Alert
    const contractorResult = await pool.query(
      "SELECT email FROM contractors WHERE id=$1",
      [contractorId]
    );

    const contractorEmail = contractorResult.rows[0]?.email;

    let subject = "New Lead";
    if (score >= 5) subject = "🔥 High-Intent Lead";
    else if (score >= 3) subject = "🟡 Warm Lead";

    if (contractorEmail) {
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: contractorEmail,
          subject,
          text: `
New Lead Received

Project: ${projectType}
Budget: ${budget}
Timeline: ${timeline}

Name: ${name}
Email: ${email}
Phone: ${phone}

AI Analysis:
${summary}
`
        });
        console.log("Email sent");
      } catch (err) {
        console.error("Email error:", err.message);
      }
    }

    res.json({ success: true });

  } catch (err) {
    console.error("Complete error:", err.message);
    res.status(500).json({ error: "Complete failed" });
  }
});

/* ==============================
   DASHBOARD DATA
============================== */
app.get("/dashboard-data", async (req, res) => {
  try {
    const token = req.headers.authorization;

    if (!token || !sessions[token])
      return res.status(401).json({ error: "Unauthorized" });

    const contractorId = sessions[token];

    const result = await pool.query(
      "SELECT * FROM leads WHERE contractor_id=$1 ORDER BY created_at DESC",
      [contractorId]
    );

    res.json({
      contractorId,
      leads: result.rows
    });

  } catch (err) {
    console.error("Dashboard error:", err.message);
    res.status(500).json({ error: "Dashboard failed" });
  }
});

/* ==============================
   SERVER START
============================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", async () => {
  console.log("Server running on port " + PORT);

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contractors (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        contractor_id INT,
        project_type TEXT,
        budget TEXT,
        timeline TEXT,
        name TEXT,
        email TEXT,
        phone TEXT,
        zip TEXT,
        score INT,
        summary TEXT,
        transcript TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Database ready");

  } catch (err) {
    console.error("DB init error:", err.message);
  }
});
