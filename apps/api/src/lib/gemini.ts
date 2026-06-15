import { GoogleAuth } from "google-auth-library";

const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION ?? "global";
const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";
const mockGemini = process.env.MOCK_GEMINI === "true";
const maxOutputTokens = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 512);

async function* streamMockGeminiResponse(prompt: string) {
  // The mock keeps local development moving when billing or Vertex access is unavailable.
  const participants = [...prompt.matchAll(/\[([^\]]+)\]/g)]
    .map((match) => match[1])
    .filter((name, index, names) => names.indexOf(name) === index && name !== "Gemini AI")
    .slice(0, 4);

  const addressedParticipants = participants.length > 0 ? participants.join(", ") : "team";
  const response = [
    `Based on the discussion from ${addressedParticipants}, I would start with Cloud Memorystore for Redis if the API needs low-latency shared caching.`,
    "Keep the first version simple: cache only expensive read-heavy endpoints, define short TTLs, and add metrics for hit rate, latency, and eviction pressure.",
    "If cost becomes a concern, add per-route cache policies before scaling the Redis tier."
  ].join(" ");

  const words = response.split(" ");

  for (const word of words) {
    await new Promise((resolve) => setTimeout(resolve, 35));
    yield {
      candidates: [
        {
          content: {
            parts: [{ text: `${word} ` }]
          }
        }
      ]
    };
  }
}

async function getAccessToken() {
  // In local dev this comes from gcloud ADC; in Cloud Run it will come from the service account.
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  if (!token.token) {
    throw new Error("Could not get Google Cloud access token.");
  }

  return token.token;
}

async function* streamVertexRestResponse(prompt: string) {
  if (!project) {
    throw new Error("GOOGLE_CLOUD_PROJECT is required.");
  }

  const accessToken = await getAccessToken();
  // REST gives us clearer errors than the SDK did when Vertex returned non-JSON responses.
  const url = [
    "https://aiplatform.googleapis.com/v1",
    `projects/${project}`,
    `locations/${location}`,
    "publishers/google",
    `models/${model}:streamGenerateContent?alt=sse`
  ].join("/");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        maxOutputTokens,
        temperature: 0.4
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Vertex AI REST ${response.status} ${response.statusText}: ${body.slice(0, 1000)}`);
  }

  if (!response.body) {
    throw new Error("Vertex AI response body is empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function parseEvents(rawBuffer: string, flush = false) {
    // Vertex streams Server-Sent Events. Normalize line endings so Windows-style CRLF does not break parsing.
    const normalizedBuffer = rawBuffer.replace(/\r\n/g, "\n");
    const rawEvents = normalizedBuffer.split("\n\n");
    const completeEvents = flush ? rawEvents : rawEvents.slice(0, -1);
    const events: unknown[] = [];

    for (const event of completeEvents) {
      const dataLines = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s?/, ""));

      if (dataLines.length === 0) {
        continue;
      }

      const data = dataLines.join("\n").trim();

      if (!data || data === "[DONE]") {
        continue;
      }

      events.push(JSON.parse(data));
    }

    return {
      events,
      remainder: flush ? "" : rawEvents.at(-1) ?? ""
    };
  }

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsedEvents = parseEvents(buffer);

    for (const event of parsedEvents.events) {
      yield event;
    }

    buffer = parsedEvents.remainder;
  }

  buffer += decoder.decode();

  for (const event of parseEvents(buffer, true).events) {
    yield event;
  }
}

export async function streamGeminiResponse(prompt: string) {
  if (mockGemini) {
    return { stream: streamMockGeminiResponse(prompt) };
  }

  // Keep the public contract the same for mock and real Vertex streams.
  return { stream: streamVertexRestResponse(prompt) };
}

export async function generateGeminiText(prompt: string) {
  const response = await streamGeminiResponse(prompt);
  let content = "";

  for await (const chunk of response.stream as AsyncIterable<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>) {
    content += chunk.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  }

  return content.trim();
}
