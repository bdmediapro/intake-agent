require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// In-memory conversation store (temporary for V1)
let conversations = {};

// ==============================
// Health Check Route
// ==============================
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// ==============================
// Root Route
// ==============================
app.get("/", (req, res) => {
  res.send("Intake Agent is running");
});

// ==============================
// Start Conversation
// ==============================
app.post("/start", (req, res) => {
  const { sessionId, name, projectType } = req.body;

  if (!sessionId || !name || !projectType) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  conversations[sessionId] = {
    name,
    projectType,
    state: "ASK_BUDGET",
    data: {},
  };

  res.json({
    message: `Hi ${name}, thanks for reaching out about your ${projectType}. What budget range are you considering?`,
  });
});

// ==============================
// Chat Handler
// ==============================
app.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const convo = conversations[sessionId];

  if (!convo) {
    return res.status(400).json({ error: "No session found" });
  }

  try {
    // Step 1: Budget Qualification
    if (convo.state === "ASK_BUDGET") {
      const aiResponse = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: `
Extract a budget category from this message:
"${message}"

Return one word:
LOW (under 20k)
MID (20k-50k)
HIGH (50k+)
UNKNOWN
        `,
      });

      const budgetCategory = aiResponse.output_text.trim();

      convo.data.budget = budgetCategory;
      convo.state = "ASK_TIMELINE";

      return res.json({
        message: "Thanks. When are you hoping to start the project?",
      });
    }

    // Step 2: Timeline
    if (convo.state === "ASK_TIMELINE") {
      convo.data.timeline = message;
      convo.state = "DONE";

      return res.json({
        message:
          "Great. A team member will review your project and reach out shortly.",
        summary: {
          name: convo.name,
          projectType: convo.projectType,
          budget: convo.data.budget,
          timeline: convo.data.timeline,
        },
      });
    }

    return res.json({ message: "Conversation complete." });
  } catch (error) {
    console.error("Error in /chat:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ==============================
// Start Server (IMPORTANT)
// ==============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
