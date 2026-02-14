require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const OpenAI = require("openai");

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
   DATABASE
============================== */
console.log("DATABASE_URL:", process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
    const { name, email, password } = req.body;

    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO contractors (name, email, password) VALUES ($1,$2,$3) RETURNING id",
      [name, email, hashed]
    );

    res.json({ success: true, contractorId: result.rows[0].id });
  } catch (err) {
    console.error(err.message);
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
    console.error(err.message);
    res.status(500).json({ error: "Login failed" });
  }
});

/* ==============================
   AI INTAKE (HYBRID)
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

Only request contact info after project details.

When finished, respond ONLY with:

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
    console.error(err.message);
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
You are an AI sales assistant helping a contractor evaluate a remodeling lead.

Provide:
1. Lead Quality Analysis
2. Urgency Level
3. Estimated Project Value Tier
4. Psychological Sales Angle
5. Suggested First Call Strategy

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
      console.error("Summary error:", err.message);
    }

    await pool.query(
      `INSERT INTO leads 
      (project_type, budget, timeline, name, email, phone, zip, score, summary, contractor_id, transcript)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        projectType,
        budget,
        timeline,
        name,
        email,
        phone,
        zip,
        score,
        summary,
        contractorId,
        transcript
      ]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err.message);
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
    console.error(err.message);
    res.status(500).json({ error: "Dashboard failed" });
  }
});

/* ==============================
   SERVER + DB INIT
============================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", async () => {
  console.log("Server running on port", PORT);

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
    contractor_id INT,
    transcript TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

await pool.query(`
  ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS transcript TEXT;
`);


    console.log("Database ready");
  } catch (err) {
    console.error("DB init error:", err.message);
  }
});
