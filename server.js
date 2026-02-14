require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let conversations = {};

// ==============================
// HEALTH
// ==============================
app.get("/health", function (req, res) {
  res.status(200).send("OK");
});

// ==============================
// UI
// ==============================
app.get("/", function (req, res) {
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
    body:JSON.stringify({ sessionId, name:"Website Visitor", projectType:project })
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

// ==============================
// START
// ==============================
app.post("/start", function (req, res) {
  const { sessionId, projectType } = req.body;

  conversations[sessionId] = {
    projectType,
    state: "ASK_BUDGET",
    data: {}
  };

  res.json({ success:true });
});

// ==============================
// CHAT (budget + timeline)
// ==============================
app.post("/chat", function (req, res) {
  const { sessionId, message } = req.body;
  const convo = conversations[sessionId];

  if (!convo) return res.status(400).json({ error:"No session" });

  if (convo.state === "ASK_BUDGET") {
    convo.data.budget = message;
    convo.state = "ASK_TIMELINE";
    return res.json({ success:true });
  }

  if (convo.state === "ASK_TIMELINE") {
    convo.data.timeline = message;
    convo.state = "COLLECT_CONTACT";
    return res.json({ success:true });
  }

  res.json({ success:true });
});

// ==============================
// COMPLETE
// ==============================
app.post("/complete", function (req, res) {
  const { sessionId, name, email, phone, zip } = req.body;
  const convo = conversations[sessionId];

  if (!convo) return res.status(400).json({ error:"No session" });

  convo.data.name = name;
  convo.data.email = email;
  convo.data.phone = phone;
  convo.data.zip = zip;

  // Lead Scoring
  let score = 0;
  if (convo.data.budget === "HIGH") score += 3;
  if (convo.data.budget === "MID") score += 2;
  if (convo.data.timeline === "ASAP") score += 3;
  if (convo.data.timeline === "SOON") score += 2;

  convo.data.score = score;

  console.log("NEW LEAD:", convo.data);

  res.json({ success:true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", function () {
  console.log("Server running on port " + PORT);
});
