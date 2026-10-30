import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./markdown.js";
import { inlineMath, mathFenceRenderer, texToUnicode } from "./math.js";
import { createStyle } from "./renderer.js";

const plain = createStyle(false);

function render(markdown: string, width = 60): string[] {
  const renderer = new MarkdownRenderer({
    style: plain,
    width: () => width,
    fences: [mathFenceRenderer],
    inlineMath,
  });
  return [
    ...markdown.split("\n").flatMap((line) => renderer.push(line)),
    ...renderer.end(),
  ];
}

describe("texToUnicode", () => {
  it.each([
    ["\\alpha + \\beta \\leq \\Omega", "α + β ≤ Ω"],
    ["x^2 + y^{10} = z_n", "x² + y¹⁰ = zₙ"],
    ["e^{i\\pi} + 1 = 0", "e^(iπ) + 1 = 0"],
    ["x^{a+b}", "xᵃ⁺ᵇ"],
    ["x^{\\alpha}", "x^α"],
    ["\\frac{1}{2} + \\frac{a}{b} + \\frac{x+1}{y}", "½ + a/b + (x+1)/y"],
    ["\\sqrt{x} + \\sqrt{x+1} + \\sqrt[3]{8}", "√x + √(x+1) + ∛8"],
    ["\\sum_{i=1}^{n} i", "∑ᵢ₌₁ⁿ i"],
    ["\\int_0^\\infty f(x)\\,dx", "∫₀^∞ f(x) dx"],
    ["\\forall x \\in \\mathbb{R}", "∀ x ∈ ℝ"],
    ["\\text{speed} = \\mathrm{d}x/\\mathrm{d}t", "speed = dx/dt"],
    ["\\hat{x} \\vec{v} \\bar{y}", "x\u0302 v\u20d7 y\u0304"],
    ["\\left( \\frac{a}{b} \\right)", "( a/b )"],
    ["a \\cdot b \\times c \\neq d", "a · b × c ≠ d"],
    ["\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", "(a b; c d)"],
    ["\\unknown{x}", "unknown x"],
  ])("%s → %s", (tex, expected) => {
    expect(texToUnicode(tex)).toBe(expected);
  });
});

describe("math in markdown", () => {
  it("renders inline math but leaves prices alone", () => {
    expect(render("Energy is $E = mc^2$ and \\(a_1\\).")).toEqual([
      "Energy is E = mc² and a₁.",
    ]);
    expect(render("It costs $5 and $10 today.")).toEqual([
      "It costs $5 and $10 today.",
    ]);
    expect(render("Keep `$x^2$` literal.")).toEqual(["Keep $x^2$ literal."]);
  });

  it("renders display blocks, one-line display math and math fences", () => {
    expect(render("$$\n\\frac{a}{b} \\\\\nx^2\n$$\nafter")).toEqual([
      "    a/b",
      "    x²",
      "after",
    ]);
    expect(render("$$ \\sqrt{2} $$")).toEqual(["    √2"]);
    expect(render("\\[\n\\pi r^2\n\\]")).toEqual(["    π r²"]);
    expect(render("```math\n\\alpha\n```")).toEqual(["    α"]);
  });
});
