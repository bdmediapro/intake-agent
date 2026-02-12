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

// Health check
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Simple Web UI
app.get("/", (req, res) => {
  res.send(`
    <html>
      <body style="font-family: Arial; max-width:600px; margin:40px auto;">
        <h2>Remodel Intake Agent</h2>
        <div id="chat"></div>
        <input id="input" style="width:80%" placeholder="Type your message..." />
        <button onclick="send()">Send</button>

        <script>
          let sessionId = "session-" + Math.random();
          let started = false;

          async function send() {
            const input = document.getElementById("input");
            const message = input.value;
            input.value = "";

            const chat = document.getElementById("chat");
            chat.innerHTML += "<div><b>You:</b> " + message + "</div>";

            let url = started ? "/chat" : "/start";
            let body = started
              ? { sessionId, message }
              : { sessionId, name: message, projectType: "Kitchen Remodel" };

            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            });

            const data = await res.json();
            chat.innerHTML += "<div><b>Agent:</b> " + data.message + "</div>";

            started = true;
          }
        </script>
      </body>
    </html>
  `);
});

app.post("/start", (req, res) => {
  const { sessionId, name, projectType } = req.body;

  conversations[sessionId] = {
    name,
    projectType,
    state: "ASK_BUDGET",
    data: {},
  };

  res.json({
    message: `Hi ${name}, thanks for reaching out about your ${projectType}. What budget range are you considering?`
  });
});

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
MID (20k-
