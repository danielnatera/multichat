export function formatTenantLabel(orgId: string) {
  const labels: Record<string, string> = {
    acme: "ACME",
    globex: "GLOBEX"
  };

  return labels[orgId] ?? orgId;
}

export function getMessagePreview(content: string, maxLength = 120) {
  const normalizedContent = content.trim().replace(/\s+/g, " ");

  if (normalizedContent.length <= maxLength) {
    return normalizedContent;
  }

  return `${normalizedContent.slice(0, maxLength - 1)}…`;
}

export function renderMessageContent(content: string) {
  const mentionPattern = /(@(?:gemini|ai|ia)\b)/gi;
  const exactMentionPattern = /^@(?:gemini|ai|ia)$/i;

  return content.split(mentionPattern).map((part, index) => {
    if (!exactMentionPattern.test(part)) {
      return part;
    }

    return (
      <strong className="font-semibold text-cyan-600" key={`${part}-${index}`}>
        {part}
      </strong>
    );
  });
}
