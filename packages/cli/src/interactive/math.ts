import type { FenceRenderer } from "./markdown.js";
import { graphemes } from "./text.js";

const symbols: Readonly<Record<string, string>> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  times: "×",
  cdot: "·",
  pm: "±",
  mp: "∓",
  div: "÷",
  ast: "∗",
  star: "⋆",
  circ: "∘",
  bullet: "•",
  oplus: "⊕",
  otimes: "⊗",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  simeq: "≃",
  cong: "≅",
  propto: "∝",
  ll: "≪",
  gg: "≫",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  sum: "∑",
  prod: "∏",
  coprod: "∐",
  int: "∫",
  iint: "∬",
  iiint: "∭",
  oint: "∮",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  setminus: "∖",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  nexists: "∄",
  neg: "¬",
  lnot: "¬",
  land: "∧",
  wedge: "∧",
  lor: "∨",
  vee: "∨",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  gets: "←",
  Rightarrow: "⇒",
  implies: "⇒",
  Leftarrow: "⇐",
  iff: "⇔",
  Leftrightarrow: "⇔",
  leftrightarrow: "↔",
  mapsto: "↦",
  uparrow: "↑",
  downarrow: "↓",
  ldots: "…",
  dots: "…",
  cdots: "⋯",
  vdots: "⋮",
  ddots: "⋱",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  mid: "∣",
  degree: "°",
  prime: "′",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  aleph: "ℵ",
  langle: "⟨",
  rangle: "⟩",
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  vert: "|",
  Vert: "‖",
  lvert: "|",
  rvert: "|",
  quad: "  ",
  qquad: "    ",
  therefore: "∴",
  because: "∵",
  top: "⊤",
  bot: "⊥",
  vdash: "⊢",
  models: "⊨",
  checkmark: "✓",
};

const operators = new Set(
  "sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln lg exp lim liminf limsup max min sup inf det dim ker gcd lcm arg deg mod Pr".split(
    " ",
  ),
);
const dropped = new Set(
  "left right big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr middle displaystyle textstyle scriptstyle limits nolimits nonumber notag".split(
    " ",
  ),
);
const textCommands = new Set(["text", "textrm", "textit", "textbf", "mbox"]);
const fontCommands = new Set(
  "mathrm mathit mathbf mathsf mathtt mathcal mathscr mathfrak boldsymbol operatorname bm".split(
    " ",
  ),
);
const accents: Readonly<Record<string, string>> = {
  hat: "̂",
  widehat: "̂",
  bar: "̄",
  overline: "̄",
  vec: "⃗",
  dot: "̇",
  ddot: "̈",
  tilde: "̃",
  widetilde: "̃",
};
const doubleStruck: Readonly<Record<string, string>> = {
  R: "ℝ",
  N: "ℕ",
  Z: "ℤ",
  Q: "ℚ",
  C: "ℂ",
  P: "ℙ",
  H: "ℍ",
  E: "𝔼",
  "1": "𝟙",
};
const fractions: Readonly<Record<string, string>> = {
  "1/2": "½",
  "1/3": "⅓",
  "2/3": "⅔",
  "1/4": "¼",
  "3/4": "¾",
  "1/5": "⅕",
  "1/6": "⅙",
  "1/8": "⅛",
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
};

function table(from: string, to: string): Map<string, string> {
  const source = graphemes(from);
  const target = graphemes(to);
  return new Map(
    source.map((character, index) => [character, target[index] ?? ""]),
  );
}

const superscripts = table(
  "0123456789+-=()abcdefghijklmnoprstuvwxyzABDEGHIJKLMNOPRTUW",
  "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁᵂ",
);
const subscripts = table(
  "0123456789+-=()aehijklmnoprstuvxβγρφχ",
  "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓᵦᵧᵨᵩᵪ",
);

function script(text: string, map: Map<string, string>, mark: string): string {
  const characters = graphemes(text);
  if (characters.length && characters.every((character) => map.has(character)))
    return characters.map((character) => map.get(character)).join("");
  return characters.length === 1 ? `${mark}${text}` : `${mark}(${text})`;
}

/** Parenthesizes anything that is not a single word or number. */
function atom(text: string): string {
  return /^[\p{L}\p{N}.]+$/u.test(text) || graphemes(text).length === 1
    ? text
    : `(${text})`;
}

const environments: Readonly<
  Record<string, readonly [string, string, string]>
> = {
  pmatrix: ["(", "; ", ")"],
  bmatrix: ["[", "; ", "]"],
  Bmatrix: ["{", "; ", "}"],
  vmatrix: ["|", "; ", "|"],
  Vmatrix: ["‖", "; ", "‖"],
  matrix: ["", "; ", ""],
  smallmatrix: ["", "; ", ""],
  cases: ["{ ", "; ", ""],
};

/** A small TeX reader: one pass over commands, groups and scripts. */
class Reader {
  private index = 0;

  constructor(private readonly source: string) {}

  read(): string {
    let output = "";
    while (this.index < this.source.length) {
      const character = this.source[this.index++] ?? "";
      if (character === "\\") output += this.command();
      else if (character === "^" || character === "_") {
        const argument = convert(this.argument());
        output +=
          character === "^"
            ? script(argument, superscripts, "^")
            : script(argument, subscripts, "_");
      } else if (character === "{") output += convert(this.group());
      else if (character === "}") continue;
      else if (character === "~") output += " ";
      else if (character === "&") output += " ";
      else output += character;
    }
    return output;
  }

  private command(): string {
    const name =
      this.source.slice(this.index).match(/^[a-zA-Z]+/)?.[0] ??
      this.source[this.index] ??
      "";
    this.index += name.length;
    if (name === "\\") return "\n";
    if (name === "," || name === ";" || name === ":" || name === " ")
      return " ";
    if (name === "!") return "";
    if (name.length === 1 && !/[a-zA-Z]/.test(name))
      return name === "|" ? "‖" : name;
    if (dropped.has(name)) {
      if (this.source[this.index] === ".") this.index++;
      return "";
    }
    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      const top = convert(this.argument());
      const bottom = convert(this.argument());
      return fractions[`${top}/${bottom}`] ?? `${atom(top)}/${atom(bottom)}`;
    }
    if (name === "sqrt") {
      const degree = this.optional();
      const body = atom(convert(this.argument()));
      if (degree === "3") return `∛${body}`;
      if (degree === "4") return `∜${body}`;
      return degree
        ? `${script(convert(degree), superscripts, "")}√${body}`
        : `√${body}`;
    }
    if (textCommands.has(name)) return this.argument();
    if (fontCommands.has(name)) return convert(this.argument());
    if (name === "mathbb") {
      const letters = convert(this.argument());
      return graphemes(letters)
        .map((letter) => doubleStruck[letter] ?? letter)
        .join("");
    }
    const accent = accents[name];
    if (accent) return `${convert(this.argument())}${accent}`;
    const symbol = symbols[name];
    if (symbol) return symbol;
    if (operators.has(name)) return name;
    return this.source[this.index] === "{" ? `${name} ` : name;
  }

  /** One argument: a braced group, a command, or a single character. */
  private argument(): string {
    while (this.source[this.index] === " ") this.index++;
    const character = this.source[this.index];
    if (character === "{") {
      this.index++;
      return this.group();
    }
    if (character === "\\") {
      const name =
        this.source.slice(this.index + 1).match(/^[a-zA-Z]+/)?.[0] ??
        this.source[this.index + 1] ??
        "";
      this.index += 1 + name.length;
      return `\\${name}`;
    }
    const [next = ""] = graphemes(
      this.source.slice(this.index, this.index + 4),
    );
    this.index += next.length;
    return next;
  }

  /** The rest of a braced group whose "{" was already read. */
  private group(): string {
    let depth = 1;
    const start = this.index;
    while (this.index < this.source.length) {
      const character = this.source[this.index++];
      if (character === "\\") this.index++;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0)
        return this.source.slice(start, this.index - 1);
    }
    return this.source.slice(start);
  }

  private optional(): string | undefined {
    if (this.source[this.index] !== "[") return undefined;
    const end = this.source.indexOf("]", this.index);
    if (end < 0) return undefined;
    const value = this.source.slice(this.index + 1, end);
    this.index = end + 1;
    return value;
  }
}

function convert(tex: string): string {
  const held: string[] = [];
  const prepared = tex.replace(
    /\\begin\{(\w+)\*?\}([\s\S]*?)\\end\{\1\*?\}/g,
    (_, name: string, body: string) => {
      const rows = body
        .split(/\\\\/)
        .map((row) =>
          row
            .split("&")
            .map((cell) => convert(cell).trim())
            .filter(Boolean)
            .join(" "),
        )
        .filter(Boolean);
      const [open, separator, close] = environments[name] ?? ["", "\n", ""];
      held.push(`${open}${rows.join(separator)}${close}`);
      return `${held.length - 1}`;
    },
  );
  return new Reader(prepared)
    .read()
    .replace(/(\d+)/g, (_, index: string) => held[Number(index)] ?? "");
}

/** TeX math as Unicode text. Line breaks (`\\`) become newlines. */
export function texToUnicode(tex: string): string {
  return convert(tex.replace(/\s+/g, " "))
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .trim();
}

/** Inline math stays on one line. */
export function inlineMath(tex: string): string {
  return texToUnicode(tex).replace(/\n/g, " ");
}

/** Display math, ```math fences and $$ blocks, indented on their own rows. */
export const mathFenceRenderer: FenceRenderer = {
  languages: ["math", "latex", "tex", "katex"],
  render(source, _width, style) {
    return texToUnicode(source)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `    ${style.accent(line)}`);
  },
};
