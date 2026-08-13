import type { ModelRetryAttempt } from "../retry.js";

export function retryProgress(retry: ModelRetryAttempt): string {
  const seconds = Math.max(1, Math.ceil(retry.delayMs / 1_000));
  const reason =
    retry.message ||
    (retry.reason === "rate_limited"
      ? "Provider rate limit reached."
      : "Provider temporarily unavailable.");
  return `${reason} Retrying in ${seconds} second${seconds === 1 ? "" : "s"} (attempt ${retry.attempt} of ${retry.maxAttempts}).`;
}

export class ProgressStreamParser {
  private buffer = "";
  private inProgress = false;

  push(chunk: string): { readonly content: string; readonly progress: string } {
    this.buffer += chunk;
    let content = "";
    let progress = "";
    while (this.buffer) {
      if (!this.inProgress) {
        const start = this.buffer.toLowerCase().indexOf("<progress>");
        if (start >= 0) {
          content += this.buffer.slice(0, start);
          this.buffer = this.buffer.slice(start + "<progress>".length);
          this.inProgress = true;
          continue;
        }
        const keep = trailingTagPrefixLength(this.buffer, "<progress>");
        const safeLength = this.buffer.length - keep;
        if (safeLength <= 0) break;
        content += this.buffer.slice(0, safeLength);
        this.buffer = this.buffer.slice(safeLength);
        continue;
      }
      const end = this.buffer.toLowerCase().indexOf("</progress>");
      if (end >= 0) {
        progress += this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + "</progress>".length);
        this.inProgress = false;
        continue;
      }
      const keep = trailingTagPrefixLength(this.buffer, "</progress>");
      const safeLength = this.buffer.length - keep;
      if (safeLength <= 0) break;
      progress += this.buffer.slice(0, safeLength);
      this.buffer = this.buffer.slice(safeLength);
    }
    return { content, progress };
  }

  finish(): { readonly content: string; readonly progress: string } {
    const tail = this.buffer;
    this.buffer = "";
    return this.inProgress
      ? { content: "", progress: tail }
      : { content: tail, progress: "" };
  }
}

function trailingTagPrefixLength(value: string, tag: string): number {
  const normalized = value.toLowerCase();
  for (
    let length = Math.min(tag.length - 1, normalized.length);
    length > 0;
    length--
  ) {
    if (normalized.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}
