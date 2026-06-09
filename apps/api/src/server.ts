import cors from "cors";
import "dotenv/config";
import express from "express";
import { aiRouter } from "./routes/ai.js";

const app = express();
const port = Number(process.env.PORT ?? 8080);

app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    ai: {
      mock: process.env.MOCK_GEMINI === "true",
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
      debugLogs: process.env.AI_DEBUG_LOGS === "true"
    }
  });
});

app.use("/api/ai", aiRouter);

app.listen(port, () => {
  console.log(`API listening on ${port}`);
});
