require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const OpenAI = require("openai");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let conversations = {};

app.get("/", (req, res) => {
  res.send("Intake Agent is running");
});

// Start new conversation
app.post("/start", (req, res) => {
  const { sessionId, name, projectType } = req.body;

  conversations[sessionId] = {
    name,
    projectType,
    state: "ASK_BUDGET",
    data: {}
  };

  res.json({
    message: `Hi ${name}, thanks for reaching out about your ${projectType}. What budget range are you considering?`
  });
});

// Handle conversation step
app.post("/chat", async (req, res) => {
  const { sessionId, message } = req.body;

  const convo = conversations[sessionId];
  if (!convo) return res.status(400).json({ error: "No session found" });

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
      `
    });

    convo.data.budget = aiResponse.output_text.trim();
    convo.state = "ASK_TIMELINE";

    return res.json({
      message: "Thanks. When are you hoping to start the project?"
    });
  }

  if (convo.state === "ASK_TIMELINE") {
    convo.data.timeline = message;
    convo.state = "DONE";

    return res.json({
      message: "Great. A team member will review your project and reach out shortly.",
      summary: convo.data
    });
  }

  res.json({ message: "Conversation complete." });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});


app.get("/start", (req, res) => {
  res.send("Use POST to start a session.");
});

