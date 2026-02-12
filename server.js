require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Intake Agent is running");
});


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


let leads = {};

app.post("/api/new-lead", async (req, res) => {
  const { name, phone, projectType } = req.body;

  leads[phone] = {
    name,
    phone,
    projectType,
    state: "ASK_BUDGET",
    data: {}
  };

  await twilioClient.messages.create({
    body: `Hi ${name}, thanks for reaching out about your ${projectType}. What budget range are you considering?`,
    from: process.env.TWILIO_PHONE,
    to: phone,
  });

  res.json({ success: true });
});

app.post("/sms-reply", async (req, res) => {
  const incomingMsg = req.body.Body;
  const fromNumber = req.body.From;

  const lead = leads[fromNumber];
  if (!lead) return res.sendStatus(200);

  if (lead.state === "ASK_BUDGET") {
    const aiResponse = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
        Extract a budget category from this message:
        "${incomingMsg}"

        Return only one word:
        LOW (under 20k)
        MID (20k-50k)
        HIGH (50k+)
        UNKNOWN
      `,
    });

    const budgetCategory = aiResponse.output_text.trim();

    lead.data.budget = budgetCategory;
    lead.state = "ASK_TIMELINE";

    await twilioClient.messages.create({
      body: `Thanks. And when are you hoping to start the project?`,
      from: process.env.TWILIO_PHONE,
      to: fromNumber,
    });
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
