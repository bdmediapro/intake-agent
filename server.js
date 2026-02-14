const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const app = express();
app.use(express.json());
app.use(express.static("public"));

/* ==============================
   DATABASE
============================== */
console.log("DATABASE_URL AT START:", process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/* ==============================
   SIMPLE SESSION STORE
============================== */
const sessions = {};

/* ==============================
   REGISTER CONTRACTOR
============================== */
app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO contractors (name, email, password) VALUES ($1,$2,$3) RETURNING id",
      [name, email, hashedPassword]
    );

    res.json({
      success: true,
      contractorId: result.rows[0].id
    });

  } catch (err) {
    console.error("Register error:", err.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

/* ==============================
   LOGIN
============================== */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM contractors WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const contractor = result.rows[0];

    const valid = await bcrypt.compare(password, contractor.password);

    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = "sess_" + Math.random().toString(36).substring(2);

    sessions[token] = contractor.id;

    res.json({ success: true, token });

  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Login failed" });
  }
});

/* ==============================
   COMPLETE (STATELESS INTAKE)
============================== */
app.post("/complete", async (req, res) => {
  try {
    const {
      projectType,
      budget,
      timeline,
      name,
      email,
      phone,
      zip,
      contractorId
    } = req.body;

    if (!projectType || !budget || !timeline || !name || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

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
You are an AI assistant helping contractors evaluate new remodeling leads.

Generate a short structured summary with:

1. Lead Quality Score Explanation
2. Urgency Level
3. Estimated Project Value Tier
4. Recommended Sales Angle

Project Type: ${projectType}
Budget: ${budget}
Timeline: ${timeline}
ZIP: ${zip}
Score: ${score}

Keep it concise but actionable.
    `
  });

  if (
    aiResponse.output &&
    aiResponse.output[0] &&
    aiResponse.output[0].content &&
    aiResponse.output[0].content[0]
  ) {
    summary = aiResponse.output[0].content[0].text.trim();
  }

} catch (err) {
  console.error("AI summary error:", err.message);
}

    await pool.query(
      `INSERT INTO leads 
      (project_type, budget, timeline, name, email, phone, zip, score, summary, contractor_id) 
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
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
        contractorId || 1
      ]
    );

    console.log("Lead saved");

    res.json({ success: true });

  } catch (err) {
    console.error("Complete route error:", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

/* ==============================
   PROTECTED DASHBOARD
============================== */
app.get("/dashboard", async (req, res) => {
  try {
    const token = req.headers.authorization;

    if (!token || !sessions[token]) {
      return res.status(401).send("Unauthorized");
    }

    const contractorId = sessions[token];

    const result = await pool.query(
      "SELECT * FROM leads WHERE contractor_id = $1 ORDER BY created_at DESC",
      [contractorId]
    );

    const leads = result.rows;

    let rowsHtml = leads.map(lead => `
      <tr>
        <td>${lead.created_at ? lead.created_at.toISOString().slice(0,10) : ''}</td>
        <td>${lead.project_type || ''}</td>
        <td>${lead.budget || ''}</td>
        <td>${lead.timeline || ''}</td>
        <td>${lead.name || ''}</td>
        <td>${lead.email || ''}</td>
        <td>${lead.phone || ''}</td>
        <td>${lead.zip || ''}</td>
        <td>${lead.score || 0}</td>
      </tr>
    `).join("");

    res.send(`
      <html>
      <head>
        <title>Your Leads</title>
        <style>
          body { font-family: Arial; padding:40px; background:#f5f3ef; }
          table { width:100%; border-collapse:collapse; background:white; }
          th, td { padding:10px; border:1px solid #ddd; font-size:14px; }
          th { background:#2e3d34; color:white; }
        </style>
      </head>
      <body>
        <h1>Your Leads</h1>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Project</th>
              <th>Budget</th>
              <th>Timeline</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>ZIP</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
      </html>
    `);

  } catch (err) {
    console.error("Dashboard error:", err.message);
    res.status(500).send("Dashboard failed");
  }
});

/* ==============================
   START SERVER + DB INIT
============================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", async () => {
  console.log("Server running on port " + PORT);

  try {

    await pool.query(`
      CREATE TABLE IF NOT EXISTS contractors (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS contractor_id INT REFERENCES contractors(id);
    `);

    console.log("Database ready");

  } catch (err) {
    console.error("Database init failed:", err.message);
  }
});

app.get("/dashboard-data", async (req, res) => {
  try {
    const token = req.headers.authorization;

    if (!token || !sessions[token]) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const contractorId = sessions[token];

    const result = await pool.query(
      "SELECT * FROM leads WHERE contractor_id = $1 ORDER BY created_at DESC",
      [contractorId]
    );

    res.json({
      contractorId,
      leads: result.rows
    });

  } catch (err) {
    console.error("Dashboard data error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});
