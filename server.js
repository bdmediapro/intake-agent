require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");

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
   COMPLETE (STATELESS)
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

    const summary = "AI disabled for now.";

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

    console.log("Lead saved (stateless mode)");

    res.json({ success: true });

  } catch (err) {
    console.error("Complete route error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

/* ==============================
   DASHBOARD (TEMP CONTRACTOR 1)
============================== */
app.get("/dashboard", async (req, res) => {
  try {
    const contractorId = 1; // temporary until login system

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
        <title>Contractor Dashboard</title>
        <style>
          body { font-family: Arial; padding:40px; background:#f5f3ef; }
          table { width:100%; border-collapse:collapse; background:white; }
          th, td { padding:10px; border:1px solid #ddd; font-size:14px; }
          th { background:#2e3d34; color:white; }
          tr:nth-child(even) { background:#f9f9f9; }
        </style>
      </head>
      <body>
        <h1>Lead Dashboard</h1>
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
    console.error("Dashboard error:", err);
    res.status(500).send("Dashboard failed");
  }
});

/* ==============================
   START SERVER
============================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", async () => {
  console.log("Server running on port " + PORT);

  try {

    /* CONTRACTORS TABLE */
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contractors (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        password TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    /* LEADS TABLE */
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

    /* ENSURE contractor_id COLUMN EXISTS */
    await pool.query(`
      ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS contractor_id INT REFERENCES contractors(id);
    `);

    /* SEED DEMO CONTRACTOR */
    await pool.query(`
      INSERT INTO contractors (name, email, password)
      VALUES ('Demo Contractor', 'demo@contractor.com', 'password123')
      ON CONFLICT (email) DO NOTHING;
    `);

    console.log("Database initialized (multi-contractor ready)");

  } catch (err) {
    console.error("Database init failed:", err.message);
  }
});
