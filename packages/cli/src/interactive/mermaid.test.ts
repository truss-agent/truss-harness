import { describe, expect, it } from "vitest";
import { mermaidFenceRenderer, parseFlowchart } from "./mermaid.js";
import { createStyle } from "./renderer.js";
import { displayWidth } from "./text.js";

const plain = createStyle(false);
const draw = (source: string, width = 80) =>
  mermaidFenceRenderer.render(source, width, plain).join("\n");
const rowOf = (diagram: string, text: string) =>
  diagram.split("\n").findIndex((row) => row.includes(text));
const columnOf = (diagram: string, text: string) =>
  diagram.split("\n")[rowOf(diagram, text)]?.indexOf(text) ?? -1;

describe("flowchart parsing", () => {
  it("reads shapes, chains, fan-in and edge labels", () => {
    const graph = parseFlowchart(
      [
        "flowchart LR",
        "  A[Start] --> B{OK?}",
        "  B -->|yes| C(Done) --> D",
        "  B -- no --> A",
        "  X & Y -.-> D",
        "  classDef red fill:#f00",
        "  subgraph inner",
        "  end",
      ].join("\n"),
    );
    expect(graph.direction).toBe("LR");
    expect(graph.nodes.get("A")).toEqual({
      id: "A",
      label: "Start",
      shape: "rect",
    });
    expect(graph.nodes.get("B")?.shape).toBe("decision");
    expect(graph.nodes.get("C")?.shape).toBe("round");
    expect(graph.nodes.get("D")?.label).toBe("D");
    expect(
      graph.edges.map((edge) => `${edge.from}>${edge.to}:${edge.label ?? ""}`),
    ).toEqual(["A>B:", "B>C:yes", "C>D:", "B>A:no", "X>D:", "Y>D:"]);
    expect(graph.edges.at(-1)?.style).toBe("dotted");
  });

  it("reads state diagram transitions", () => {
    const graph = parseFlowchart(
      "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy : start\n  Busy --> [*]",
    );
    expect(
      graph.edges.map((edge) => `${edge.from}>${edge.to}:${edge.label ?? ""}`),
    ).toEqual(["[*]start>Idle:", "Idle>Busy:start", "Busy>[*]end:"]);
    expect(graph.nodes.get("[*]start")?.label).toBe("●");
  });
});

describe("flowchart drawing", () => {
  it("draws a top-down chain with boxes and arrows in order", () => {
    const diagram = draw("graph TD\n  A[Plan] --> B[Build] --> C[Ship]");
    expect(diagram).toContain("│ Plan │");
    expect(diagram).toContain("▼");
    expect(rowOf(diagram, "Plan")).toBeLessThan(rowOf(diagram, "Build"));
    expect(rowOf(diagram, "Build")).toBeLessThan(rowOf(diagram, "Ship"));
  });

  it("branches side by side with edge labels", () => {
    const diagram = draw(
      "flowchart TD\n  Q{Ready?} -->|yes| Go\n  Q -->|no| Wait",
    );
    expect(rowOf(diagram, "Go")).toBe(rowOf(diagram, "Wait"));
    expect(diagram).toContain("yes");
    expect(diagram).toContain("no");
  });

  it("draws left to right", () => {
    const diagram = draw("flowchart LR\n  A[In] --> B[Out]");
    expect(rowOf(diagram, "In")).toBe(rowOf(diagram, "Out"));
    expect(columnOf(diagram, "In")).toBeLessThan(columnOf(diagram, "Out"));
    expect(diagram).toContain("▶");
  });

  it("routes an edge that skips a layer and lists back edges", () => {
    const diagram = draw("graph TD\n  A --> B --> C\n  A --> C\n  C --> A");
    expect(diagram.split("▼").length - 1).toBe(3);
    expect(diagram).toContain("↺ C → A");
  });

  it("fits the width, falling back to a list of edges", () => {
    const wide = Array.from(
      { length: 8 },
      (_, index) => `  Root --> N${index}[Node number ${index}]`,
    );
    const fitted = mermaidFenceRenderer.render(
      `graph TD\n${wide.join("\n")}`,
      50,
      plain,
    );
    for (const row of fitted) expect(displayWidth(row)).toBeLessThanOrEqual(50);
    const listed = draw(`graph TD\n${wide.join("\n")}`, 20);
    expect(listed).toContain("Root → Node number 0");
  });
});

describe("other diagrams", () => {
  it("draws a sequence diagram with lifelines and messages", () => {
    const diagram = draw(
      [
        "sequenceDiagram",
        "  participant A as Alice",
        "  participant B as Bob",
        "  A->>B: Hello",
        "  B-->>A: Hi back",
        "  A->>A: think",
        "  loop Every minute",
        "  Note over A: waiting",
        "  end",
      ].join("\n"),
    );
    expect(rowOf(diagram, "Alice")).toBe(rowOf(diagram, "Bob"));
    expect(columnOf(diagram, "Alice")).toBeLessThan(columnOf(diagram, "Bob"));
    expect(rowOf(diagram, "Hello")).toBeLessThan(rowOf(diagram, "Hi back"));
    expect(diagram).toContain("▶");
    expect(diagram).toContain("◀");
    expect(diagram).toContain("┄");
    expect(diagram).toContain("think");
    expect(diagram).toContain("loop Every minute");
    expect(diagram).toContain("waiting");
  });

  it("draws a pie chart as bars with percentages", () => {
    const diagram = draw('pie title Pets\n  "Dogs" : 3\n  "Cats" : 1');
    expect(diagram).toContain("Pets");
    expect(diagram).toMatch(/Dogs\s+█+\s+75\.0%/);
    expect(diagram).toMatch(/Cats\s+█+\s+25\.0%/);
  });

  it("shows other diagram types as labeled source", () => {
    const diagram = draw("gantt\n  title Plan");
    expect(diagram).toContain("mermaid");
    expect(diagram).toContain("│ gantt");
  });
});
