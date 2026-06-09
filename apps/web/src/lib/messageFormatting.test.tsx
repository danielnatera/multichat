import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatTenantLabel, getMessagePreview, renderMessageContent } from "./messageFormatting";

describe("getMessagePreview", () => {
  it("returns short messages unchanged", () => {
    expect(getMessagePreview("Short message")).toBe("Short message");
  });

  it("normalizes whitespace", () => {
    expect(getMessagePreview("  Hello    from\nSarah  ")).toBe("Hello from Sarah");
  });

  it("truncates long messages with an ellipsis", () => {
    const preview = getMessagePreview("a".repeat(130), 20);

    expect(preview).toHaveLength(20);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("renderMessageContent", () => {
  it("highlights @Gemini mentions", () => {
    const markup = renderToStaticMarkup(<p>{renderMessageContent("Ask @Gemini about caching")}</p>);

    expect(markup).toContain('<strong class="font-semibold text-cyan-600">@Gemini</strong>');
  });

  it("highlights @AI and @IA mentions case-insensitively", () => {
    const markup = renderToStaticMarkup(<p>{renderMessageContent("Ask @AI or @ia")}</p>);

    expect(markup).toContain('<strong class="font-semibold text-cyan-600">@AI</strong>');
    expect(markup).toContain('<strong class="font-semibold text-cyan-600">@ia</strong>');
  });

  it("leaves normal text untouched", () => {
    const markup = renderToStaticMarkup(<p>{renderMessageContent("No mention here")}</p>);

    expect(markup).toBe("<p>No mention here</p>");
  });
});

describe("formatTenantLabel", () => {
  it("formats known seeded tenants", () => {
    expect(formatTenantLabel("acme")).toBe("ACME");
    expect(formatTenantLabel("globex")).toBe("GLOBEX");
  });

  it("falls back to the raw tenant slug", () => {
    expect(formatTenantLabel("northstar")).toBe("northstar");
  });
});
