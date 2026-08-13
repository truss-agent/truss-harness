import type {
  DesktopTerminalView,
  TerminalPromptSegment,
  TerminalViewActions,
} from "./terminal-controller.js";

export interface DesktopTerminalElements {
  readonly document: Document;
  readonly panel: HTMLElement;
  readonly output: HTMLElement;
  readonly form: HTMLFormElement;
  readonly prompt: HTMLElement;
  readonly input: HTMLInputElement;
}

export function desktopTerminalElements(
  document: Document,
): DesktopTerminalElements {
  const element = <T extends HTMLElement>(id: string): T =>
    document.getElementById(id) as T;
  return {
    document,
    panel: document.querySelector<HTMLElement>(".terminal") as HTMLElement,
    output: element<HTMLElement>("terminalOutput"),
    form: element<HTMLFormElement>("terminalForm"),
    prompt: element<HTMLElement>("terminalPrompt"),
    input: element<HTMLInputElement>("terminalInput"),
  };
}

/** Owns the Desktop terminal form, output, keyboard handling, and prompt DOM. */
export class DesktopTerminalDomView implements DesktopTerminalView {
  constructor(readonly elements: DesktopTerminalElements) {}

  bind(actions: TerminalViewActions): void {
    this.elements.form.onsubmit = (event) => {
      event.preventDefault();
      actions.submit(this.elements.input.value);
    };
    this.elements.input.onkeydown = (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "c" &&
        this.elements.input.selectionStart === this.elements.input.selectionEnd
      ) {
        event.preventDefault();
        actions.interrupt();
      }
    };
  }

  appendOutput(text: string, maximumCharacters: number): void {
    this.elements.output.textContent =
      `${this.elements.output.textContent}${text}`.slice(-maximumCharacters);
    this.elements.output.scrollTop = this.elements.output.scrollHeight;
  }

  clearInput(): void {
    this.elements.input.value = "";
  }

  renderPrompt(segments: readonly TerminalPromptSegment[]): void {
    this.elements.prompt.replaceChildren(
      ...segments.map(({ className, text }) => {
        const segment = this.elements.document.createElement("span");
        segment.className = `terminal-prompt-segment ${className}`;
        segment.textContent = text;
        return segment;
      }),
    );
  }
}
