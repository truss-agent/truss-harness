const localUrlPattern = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:\/[^\s'"\])>]*)?/gi;
const serverAnnouncementPattern = /\b(?:accepting connections|listening|server\s+(?:is\s+)?running|available|serving http)\b|\blocal:/i;

function withoutAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

/**
 * Returns the most recent local URL emitted as a server-start announcement.
 * Plain URLs are deliberately ignored so terminal commands such as curl do
 * not unexpectedly take over the Preview pane.
 */
export function previewServerUrlFromOutput(output: string): string | undefined {
  const normalized = withoutAnsi(output);
  let detected: string | undefined;
  for (const match of normalized.matchAll(localUrlPattern)) {
    const index = match.index ?? 0;
    const lineStart = normalized.lastIndexOf("\n", index) + 1;
    const lineEnd = normalized.indexOf("\n", index);
    const line = normalized.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    if (!serverAnnouncementPattern.test(line))
      continue;
    try {
      const url = new URL(match[0]);
      if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
      detected = url.toString();
    } catch {
      // A malformed terminal fragment is not a preview target.
    }
  }
  return detected;
}
