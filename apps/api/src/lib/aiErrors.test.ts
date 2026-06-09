import { describe, expect, it } from "vitest";
import { getAiErrorMessage, isDefinitiveAiError, shouldRetryAiError } from "./aiErrors.js";

describe("shouldRetryAiError", () => {
  it.each([
    "Vertex AI REST 429 Too Many Requests",
    "Vertex AI REST 503 Service Unavailable",
    "UNAVAILABLE: upstream service unavailable",
    "RESOURCE_EXHAUSTED: quota exceeded temporarily",
    "ETIMEDOUT"
  ])("retries transient error: %s", (message) => {
    expect(shouldRetryAiError(new Error(message))).toBe(true);
  });

  it.each([
    "Vertex AI REST 403 Forbidden",
    "Vertex AI REST 404 Not Found: Publisher Model was not found",
    "BILLING_DISABLED",
    "SERVICE_DISABLED",
    "PERMISSION_DENIED",
    "INVALID_ARGUMENT",
    "UNAUTHENTICATED"
  ])("does not retry definitive error: %s", (message) => {
    expect(shouldRetryAiError(new Error(message))).toBe(false);
  });

  it("classifies invalid model errors as definitive", () => {
    expect(isDefinitiveAiError(new Error("Publisher Model gemini-test was not found"))).toBe(true);
  });
});

describe("getAiErrorMessage", () => {
  it("returns a clear billing message", () => {
    expect(getAiErrorMessage(new Error("BILLING_DISABLED"))).toBe(
      "Vertex AI requires billing to be enabled for this project."
    );
  });

  it("returns a clear API disabled message", () => {
    expect(getAiErrorMessage(new Error("SERVICE_DISABLED aiplatform.googleapis.com"))).toBe(
      "Vertex AI API is not enabled yet or is still propagating. Try again in a few minutes."
    );
  });

  it("returns a clear permissions message", () => {
    expect(getAiErrorMessage(new Error("403 PERMISSION_DENIED"))).toBe(
      "Vertex AI denied the request. Check billing, API status, and project permissions."
    );
  });

  it("returns a clear invalid model message", () => {
    expect(getAiErrorMessage(new Error("Vertex AI REST 404 Not Found: Publisher Model was not found"))).toBe(
      "Gemini model is not available."
    );
  });
});
