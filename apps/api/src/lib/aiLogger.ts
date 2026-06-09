import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const aiDebugLogs = process.env.AI_DEBUG_LOGS === "true";
const aiDebugLogFile = process.env.AI_DEBUG_LOG_FILE ?? "logs/ai-debug.log";

export async function logAiDebug(event: string, details: Record<string, unknown>) {
  if (!aiDebugLogs) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...details
  };

  console.info(`[ai-debug] ${event}`, JSON.stringify(entry, null, 2));

  try {
    // File logging is for local observability; it should never break the chat flow.
    const logPath = path.resolve(process.cwd(), aiDebugLogFile);
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.warn("[ai-debug] Could not write AI debug log file.", error);
  }
}
