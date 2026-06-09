export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause
    };
  }

  return {
    message: String(error),
    value: error
  };
}

export function getAiErrorMessage(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : "AI request failed.";

  if (rawMessage.includes("404") || rawMessage.includes("NOT_FOUND") || rawMessage.includes("was not found")) {
    return "Gemini model is not available or is misconfigured. Check the configured model name.";
  }

  if (rawMessage.includes("BILLING_DISABLED")) {
    return "Vertex AI requires billing to be enabled for this project.";
  }

  if (rawMessage.includes("SERVICE_DISABLED") || rawMessage.includes("aiplatform.googleapis.com")) {
    return "Vertex AI API is not enabled yet or is still propagating. Try again in a few minutes.";
  }

  if (rawMessage.includes("PERMISSION_DENIED") || rawMessage.includes("403")) {
    return "Vertex AI denied the request. Check billing, API status, and project permissions.";
  }

  return rawMessage;
}

export function isDefinitiveAiError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalizedMessage = rawMessage.toLowerCase();

  return [
    "400",
    "401",
    "403",
    "404",
    "billing_disabled",
    "failed_precondition",
    "invalid_argument",
    "not_found",
    "permission_denied",
    "service_disabled",
    "unauthenticated",
    "was not found"
  ].some((pattern) => normalizedMessage.includes(pattern));
}

export function shouldRetryAiError(error: unknown) {
  if (isDefinitiveAiError(error)) {
    return false;
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalizedMessage = rawMessage.toLowerCase();

  return [
    "408",
    "429",
    "500",
    "502",
    "503",
    "504",
    "ECONNRESET",
    "ETIMEDOUT",
    "fetch failed",
    "rate limit",
    "RESOURCE_EXHAUSTED",
    "UNAVAILABLE",
    "Service Unavailable"
  ].some((pattern) => normalizedMessage.includes(pattern.toLowerCase()));
}
