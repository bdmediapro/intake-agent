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
   POSTGRES (Railway)
============================== */
console.log("DATABASE_URL AT START:", process.env.DATABASE_URL);

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
   SESSION STORE
============================== */
let conversations = {};

/* ==============================
   HEALTH
============================== */
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/* ==============================
   TEST OPENAI
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
   ROOT (INTAKE UI)
============================== */
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Remodel Consultation</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: Arial; background:#f5f3ef; margin:0; padding:0; }
    .container { max-width:600px; margin:60px auto; background:white; padding:40px; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.08);}
    h1 { margin-top:0; }
    p { color:#555; }
    .step { margin-top:30px; }
    button { display:block; width:100%; padding:14px; margin:10px 0; font-size:16px; border-radius:6px; border:none; background:#2e3d34; color:white; cursor:pointer;}
    button:hover { opacity:0.9; }
    input { width:100%; padding:12px; margin:8px 0; border-radius:6px; border:1px solid #ccc; }
    .hidden { display:none; }
  </style>
</head>
<body>
<div class="container">
  <h1>Start Your Remodeling Consultation</h1>
  <p>We’ll ask a few quick questions to understand your project.</p>

  <div id="step1" class="step">
    <h3>What type of project are you planning?</h3>
    <button onclick="selectProject('Kitchen Remodel')">Kitchen Remodel</button>
    <button onclick="selectProject('Bathroom Remodel')">Bathroom Remodel</button>
    <button onclick="selectProject('Full Home Remodel')">Full Home Remodel</button>
    <button onclick="selectProject('Home Addition')">Home Addition</button>
  </div>

  <div id="step2" class="step hidden">
    <h3>What budget range are you considering?</h3>
    <button onclick="selectBudget('LOW')">Under $20,000</button>
    <button onclick="selectBudget('MID')">$20,000 – $50,000</button>
    <button onclick="selectBudget('HIGH')">$50,000+</button>
  </div>

  <div id="step3" class="step hidden">
    <h3>When are you hoping to start?</h3>
    <button onclick="selectTimeline('ASAP')">Within 3 Months</button>
    <button onclick="selectTimeline('SOON')">3–6 Months</button>
    <button onclick="selectTimeline('LATER')">6+ Months</button>
    <button onclick="selectTimeline('EXPLORING')">Just Exploring</button>
  </div>

  <div id="step4" class="step hidden">
    <h3>Where should we send next steps?</h3>
    <input id="name" placeholder="Full Name" />
    <input id="email" placeholder="Email Address" />
    <input id="phone" placeholder="Phone Number" />
    <input id="zip" placeholder="ZIP Code" />
    <button onclick="submitContact()">Submit</button>
  </div>

  <div id="complete" class="step hidden">
    <h3>Thank you.</h3>
    <p>Our team will review your project and reach out shortly.</p>
  </div>
</div>

<script>
let sessionId = "session-" + Math.random();

function selectProject(project) {
  fetch("/start", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ sessionId, projectType:project })
  });
  document.getElementById("step1").classList.add("hidden");
  document.getElementById("step2").classList.remove("hidden");
}

function selectBudget(budget) {
  fetch("/chat", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ sessionId, message:budget })
  });
  document.getElementById("step2").classList.add("hidden");
  document.getElementById("step3").classList.remove("hidden");
}

function selectTimeline(timeline) {
  fetch("/chat", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ sessionId, message:timeline })
  });
  document.getElementById("step3").classList.add("hidden");
  document.getElementById("step4").classList.remove("hidden");
}

function submitContact() {
  const name = document.getElementById("name").value;
  const email = document.getElementById("email").value;
  const phone = document.getElementById("phone").value;
  const zip = document.getElementById("zip").value;

  fetch("/complete", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ sessionId, name, email, phone, zip })
  });

  document.getElementById("step4").classList.add("hidden");
  document.getElementById("complete").classList.remove("hidden");
}
</script>
</body>
</html>
  `);
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
   CHAT
============================== */
app.post("/chat", (req, res) => {
  const { sessionId, message } = req.body;
  const convo = conversations[sessionId];

  if (!convo) return res.status(400).json({ error: "No session found" });

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
   COMPLETE
============================== */
app.post("/complete", async (req, res) => {
  try {
    const { sessionId, name, email, phone, zip } = req.body;
    const convo = conversations[sessionId];

    if (!convo) return res.status(400).json({ error: "No session found" });

    convo.data.name = name;
    convo.data.email = email;
    convo.data.phone = phone;
    convo.data.zip = zip;

    let score = 0;
    if (convo.data.budget === "HIGH") score += 3;
    if (convo.data.budget === "MID") score += 2;
    if (convo.data.timeline === "ASAP") score += 3;
    if (convo.data.timeline === "SOON") score += 2;

    convo.data.score = score;

    let summary = "Summary unavailable";

    try {
      const aiResponse = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: `
Generate a short contractor summary:

Project Type: ${convo.projectType}
Budget: ${convo.data.budget}
Timeline: ${convo.data.timeline}
Score: ${score}

Include overview, urgency, and suggested sales angle.
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

    } catch (aiErr) {
      console.error("OpenAI summary error:", aiErr);
    }

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

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.CONTRACTOR_EMAIL,
      subject: "New Qualified Remodel Lead",
      text: `
Name: ${name}
Email: ${email}
Phone: ${phone}
ZIP: ${zip}
Score: ${score}

${summary}
      `,
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
