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

// Health route
app.get("/health", function (req, res) {
  res.status(200).send("OK");
});

// Simple Web UI (no template literals)
app.get("/", function (req, res) {
  res.send(
    '<!DOCTYPE html>' +
    '<html>' +
    '<head><title>Remodel Intake Agent</title></head>' +
    '<body style="font-family:Arial;max-width:600px;margin:40px auto;">' +
    '<h2>Remodel Intake Agent</h2>' +
    '<div id="chat" style="margin-bottom:20px;"></div>' +
    '<input id="input" style="width:80%;" placeholder="Type your message..." />' +
    '<button onclick="send()">Send</button>' +
    '<script>' +
    'let sessionId = "session-" + Math.random();' +
    'let started = false;' +
    'async function send() {' +
    '  const input = document.getElementById("input");' +
    '  const message = input.value;' +
    '  input.value = "";' +
    '  const chat = document.getElementById("chat");' +
    '  chat.innerHTML += "<div><b>You:</b> " + message + "</div>";' +
    '  let url = started ? "/chat" : "/start";' +
    '  let body = started ? { sessionId: sessionId, message: message } : { sessionId: sessionId, name: message, projectType: "Kitchen Remodel" };' +
    '  const res = await fetch(url, {' +
    '    method: "POST",' +
    '    headers: { "Content-Type": "application/json" },' +
    '    body: JSON.stringify(body)' +
    '  });' +
    '  const data = await res.json();' +
    '  chat.innerHTML += "<div><b>Agent:</b> " + data.message + "</div>";' +
    '  started = true;' +
    '}' +
    '</script>' +
    '</body>' +
    '</html>'
  );
});

// Start conversation
app.post("/start", function (req, res) {
  const sessionId = req.body.sessionId;
  const name = req.body.name;
  const projectType = req.body.projectType;

  conversations[sessionId] = {
    name: name,
    projectType: projectType,
    state: "ASK_BUDGET",
    data: {},
  };

  res.json({
    message:
      "Hi " +
      name +
      ", thanks for reaching out about your " +
      projectType +
      ". What budget range are you considering?",
  });
});

// Chat handler
app.post("/chat", async function (req, res) {
  const sessionId = req.body.sessionId;
  const message = req.body.message;
  const convo = conversations[sessionId];

  if (!convo) {
    return res.status(400).json({ error: "No session found" });
  }

  if (convo.state === "ASK_BUDGET") {
    const aiResponse = await openai.responses.create({
      model: "gpt-4.1-mini",
      input:
        'Extract a budget category from this message:\n"' +
        message +
        '"\n\nReturn one word:\nLOW (under 20k)\nMID (20k-50k)\nHIGH (50k+)\nUNKNOWN',
    });

    convo.data.budget = aiResponse.output_text.trim();
    convo.state = "ASK_TIMELINE";

    return res.json({
      message: "Thanks. When are you hoping to start the project?",
    });
  }

  if (convo.state === "ASK_TIMELINE") {
    convo.data.timeline = message;
    convo.state = "DONE";

    return res.json({
      message: "Great. A team member will reach out shortly.",
      summary: convo.data,
    });
  }

  res.json({ message: "Conversation complete." });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", function () {
  console.log("Server running on port " + PORT);
});
