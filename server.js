require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
app.use(express.static("public"));

/* ==============================
   POSTGRES
============================== */
console.log("DATABASE_URL AT START:", process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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

    const summary = "AI disabled for now.";

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

    console.log("Lead saved to database");

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

/* ==============================
   BASIC AUTH MIDDLEWARE
============================== */
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Dashboard"');
    return res.status(401).send("Authentication required.");
  }

  const base64Credentials = auth.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString("ascii");
  const [username, password] = credentials.split(":");

  if (
    username === process.env.DASHBOARD_USER &&
    password === process.env.DASHBOARD_PASS
  ) {
    return next();
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="Dashboard"');
  return res.status(401).send("Invalid credentials.");
}


/* ==============================
   DASHBOARD
============================== */
app.get("/dashboard", requireAuth, async (req, res) => {
   try {
    const result = await pool.query(
      "SELECT * FROM leads ORDER BY created_at DESC"
    );

    const leads = result.rows;

    let rowsHtml = leads.map(lead => `
      <tr>
        <td>${lead.created_at.toISOString().slice(0,10)}</td>
        <td>${lead.project_type}</td>
        <td>${lead.budget}</td>
        <td>${lead.timeline}</td>
        <td>${lead.name}</td>
        <td>${lead.email}</td>
        <td>${lead.phone}</td>
        <td>${lead.zip}</td>
        <td>${lead.score}</td>
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
