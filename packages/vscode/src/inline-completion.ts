import * as vscode from "vscode";
import type { ModelConfiguration } from "./contracts.js";
import type { InlineResponseBuffer } from "./inline-responses.js";
import type { RuntimeService } from "./runtime-service.js";

export interface InlineCompletionControllerOptions {
  readonly configuration: () => ModelConfiguration;
  readonly service: () => Promise<RuntimeService>;
  readonly responses: InlineResponseBuffer;
}

export class InlineCompletionController {
  constructor(private readonly options: InlineCompletionControllerOptions) {}

  register(): vscode.Disposable {
    return vscode.languages.registerInlineCompletionItemProvider(
      { pattern: "**" },
      {
        provideInlineCompletionItems: (document, position, context, token) =>
          this.provide(document, position, context, token),
      },
    );
  }

  private async provide(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    cancellationToken: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (
      !this.options.configuration().model ||
      cancellationToken.isCancellationRequested
    ) {
      return undefined;
    }
    const prefixStart = new vscode.Position(Math.max(0, position.line - 16), 0);
    const prefix = document.getText(new vscode.Range(prefixStart, position));
    const suffixLine = Math.min(document.lineCount - 1, position.line + 6);
    const suffixEnd = new vscode.Position(
      suffixLine,
      document.lineAt(suffixLine).range.end.character,
    );
    const suffix = document.getText(new vscode.Range(position, suffixEnd));
    const prompt = `Complete the code at <cursor>. Return only code to insert, with no markdown or explanation.\n\n${prefix}<cursor>${suffix}`;
    let requestId: string | undefined;
    try {
      const current = await this.options.service();
      const run = current.run(prompt);
      requestId = run.requestId;
      this.options.responses.begin(run.requestId);
      await run.result;
      const completion = this.options.responses.value(run.requestId)?.trim();
      this.options.responses.end(run.requestId);
      if (!completion || cancellationToken.isCancellationRequested)
        return undefined;
      return [
        new vscode.InlineCompletionItem(
          completion,
          new vscode.Range(position, position),
        ),
      ];
    } catch {
      if (requestId) this.options.responses.end(requestId);
      return undefined;
    }
  }
}
