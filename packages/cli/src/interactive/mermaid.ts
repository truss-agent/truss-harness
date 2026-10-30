import type { FenceRenderer } from "./markdown.js";
import type { Style } from "./renderer.js";
import { displayWidth, graphemes, truncate } from "./text.js";

export type NodeShape = "rect" | "round" | "decision";
export type EdgeStyle = "solid" | "dotted" | "thick";

export interface FlowNode {
  readonly id: string;
  readonly label: string;
  readonly shape: NodeShape;
}

export interface FlowEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly style: EdgeStyle;
  readonly arrow: boolean;
}

export interface Flowchart {
  readonly direction: "TD" | "LR";
  readonly nodes: Map<string, FlowNode>;
  readonly edges: FlowEdge[];
}

const indent = "  ";

// ── Parsing ────────────────────────────────────────────────────────────────

const shapes: readonly [RegExp, NodeShape][] = [
  [/^\(\((.*?)\)\)/, "round"],
  [/^\(\[(.*?)\]\)/, "round"],
  [/^\[\((.*?)\)\]/, "round"],
  [/^\[\[(.*?)\]\]/, "rect"],
  [/^\{\{(.*?)\}\}/, "decision"],
  [/^\[(.*?)\]/, "rect"],
  [/^\((.*?)\)/, "round"],
  [/^\{(.*?)\}/, "decision"],
  [/^>(.*?)\]/, "rect"],
];

const edgePattern =
  /^\s*(?:(--|==|-\.)\s+([^|>]+?)\s+)?(<?(?:-{2,}>|-{3,}|={2,}>|={3,}|-?\.+-*>|-\.+-|--[xo]|\.-+>))\s*(?:\|([^|]*)\|)?\s*/;

const ignored =
  /^\s*(?:%%|classDef\b|class\b|style\b|linkStyle\b|click\b|subgraph\b|end\b|direction\b|note\b|state\b.*\{|\}|accTitle|accDescr)/i;

function unquote(text: string): string {
  return text
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/<br\s*\/?>/gi, " ");
}

function edgeStyle(operator: string): EdgeStyle {
  if (operator.includes(".")) return "dotted";
  return operator.includes("=") ? "thick" : "solid";
}

/** Flowchart, graph and state diagram source as nodes and edges. */
export function parseFlowchart(source: string): Flowchart {
  const lines = source.split("\n");
  const header = lines[0]?.trim() ?? "";
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const direction = /\b(LR|RL)\b/.test(header) ? "LR" : "TD";
  const define = (id: string, label?: string, shape: NodeShape = "rect") => {
    const known = nodes.get(id);
    if (!known || (label !== undefined && known.label === known.id))
      nodes.set(id, { id, label: label ?? known?.label ?? id, shape });
  };
  const state = /^stateDiagram/.test(header);
  for (const line of lines.slice(1)) {
    if (!line.trim() || ignored.test(line)) continue;
    if (state) {
      const transition = line.match(/^\s*(\S+)\s*-->\s*(\S+)\s*(?::\s*(.*))?$/);
      if (!transition) continue;
      const from = transition[1] === "[*]" ? "[*]start" : (transition[1] ?? "");
      const to = transition[2] === "[*]" ? "[*]end" : (transition[2] ?? "");
      for (const id of [from, to])
        define(
          id,
          id === "[*]start" ? "●" : id === "[*]end" ? "◉" : undefined,
          "round",
        );
      const label = transition[3]?.trim();
      edges.push({
        from,
        to,
        ...(label ? { label } : {}),
        style: "solid",
        arrow: true,
      });
      continue;
    }
    let rest = line.replace(/;\s*$/, "");
    const group = (): string[] | undefined => {
      const ids: string[] = [];
      for (;;) {
        const id = rest.match(/^\s*([\w.:-]+?)(?=[\s[({>&-]|=|$)/)?.[1];
        if (!id) return ids.length ? ids : undefined;
        rest = rest.slice((rest.match(/^\s*/)?.[0].length ?? 0) + id.length);
        let defined = false;
        for (const [pattern, shape] of shapes) {
          const match = rest.match(pattern);
          if (!match) continue;
          define(id, unquote(match[1] ?? id), shape);
          rest = rest.slice(match[0].length);
          defined = true;
          break;
        }
        if (!defined) define(id);
        ids.push(id);
        const and = rest.match(/^\s*&\s*/);
        if (!and) return ids;
        rest = rest.slice(and[0].length);
      }
    };
    let sources = group();
    while (sources) {
      const edge = rest.match(edgePattern);
      if (!edge) break;
      rest = rest.slice(edge[0].length);
      const targets = group();
      if (!targets) break;
      const label = unquote(edge[4] ?? edge[2] ?? "");
      const operator = edge[3] ?? "-->";
      for (const from of sources)
        for (const to of targets)
          edges.push({
            from,
            to,
            ...(label ? { label } : {}),
            style: edgeStyle(`${edge[1] ?? ""}${operator}`),
            arrow: /[>xo]$/.test(operator),
          });
      sources = targets;
    }
  }
  return { direction, nodes, edges };
}

// ── Canvas ─────────────────────────────────────────────────────────────────

const up = 1;
const down = 2;
const left = 4;
const right = 8;
const junctions: Readonly<Record<number, string>> = {
  [up]: "│",
  [down]: "│",
  [up | down]: "│",
  [left]: "─",
  [right]: "─",
  [left | right]: "─",
  [down | right]: "┌",
  [down | left]: "┐",
  [up | right]: "└",
  [up | left]: "┘",
  [up | down | right]: "├",
  [up | down | left]: "┤",
  [down | left | right]: "┬",
  [up | left | right]: "┴",
  [up | down | left | right]: "┼",
};
const vertical: Record<EdgeStyle, string> = {
  solid: "│",
  dotted: "┊",
  thick: "┃",
};
const horizontal: Record<EdgeStyle, string> = {
  solid: "─",
  dotted: "┄",
  thick: "━",
};

/**
 * Text cells plus line connections. Lines record which neighbors they join,
 * so meeting lines become tees and corners instead of overwriting each other.
 */
class Canvas {
  private readonly cells: string[][] = [];
  private readonly links = new Map<string, number>();
  private readonly styles = new Map<string, EdgeStyle>();

  get(x: number, y: number): string {
    const text = this.cells[y]?.[x] ?? " ";
    if (text !== " ") return text;
    const link = this.links.get(`${x},${y}`);
    return link ? this.lineCharacter(link, this.styles.get(`${x},${y}`)) : " ";
  }

  /** An orthogonal polyline through the given points. */
  path(
    points: readonly (readonly [number, number])[],
    style: EdgeStyle = "solid",
  ) {
    for (let index = 1; index < points.length; index++) {
      let [x, y] = points[index - 1] as readonly [number, number];
      const [toX, toY] = points[index] as readonly [number, number];
      while (x !== toX || y !== toY) {
        const step: [number, number, number, number] =
          x < toX
            ? [1, 0, right, left]
            : x > toX
              ? [-1, 0, left, right]
              : y < toY
                ? [0, 1, down, up]
                : [0, -1, up, down];
        this.link(x, y, step[2], style);
        x += step[0];
        y += step[1];
        this.link(x, y, step[3], style);
      }
    }
  }

  /** A lifeline-style vertical piece at one cell. */
  line(x: number, y: number, character: string): void {
    this.link(x, y, character === "─" ? left | right : up | down, "solid");
  }

  put(x: number, y: number, character: string): void {
    if (x < 0 || y < 0) return;
    while (this.cells.length <= y) this.cells.push([]);
    const row = this.cells[y] as string[];
    while (row.length <= x) row.push(" ");
    row[x] = character;
  }

  text(x: number, y: number, text: string): void {
    graphemes(text).forEach((character, offset) => {
      this.put(x + offset, y, character);
    });
  }

  /** Writes only into blank cells, stopping at the first occupied one. */
  label(x: number, y: number, text: string, room: number): void {
    let written = 0;
    for (const character of graphemes(truncate(text, Math.max(1, room)))) {
      if (this.get(x + written, y) !== " ") return;
      this.put(x + written, y, character);
      written++;
    }
  }

  box(x: number, y: number, width: number, label: string, shape: NodeShape) {
    const [topLeft, topRight, bottomLeft, bottomRight] =
      shape === "round"
        ? ["╭", "╮", "╰", "╯"]
        : shape === "decision"
          ? ["◇", "◇", "◇", "◇"]
          : ["┌", "┐", "└", "┘"];
    const rule = "─".repeat(width - 2);
    this.text(x, y, `${topLeft}${rule}${topRight}`);
    this.text(
      x,
      y + 1,
      `│ ${label}${" ".repeat(width - 4 - displayWidth(label))} │`,
    );
    this.text(x, y + 2, `${bottomLeft}${rule}${bottomRight}`);
  }

  /** Rows without trailing spaces or blank rows above and below. */
  rows(): string[] {
    let height = this.cells.length;
    let width = Math.max(0, ...this.cells.map((row) => row.length));
    for (const key of this.links.keys()) {
      const [x = 0, y = 0] = key.split(",").map(Number);
      height = Math.max(height, y + 1);
      width = Math.max(width, x + 1);
    }
    return Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => this.get(x, y))
        .join("")
        .trimEnd(),
    ).filter(
      (row, index, all) =>
        row ||
        (all.slice(0, index).some(Boolean) &&
          all.slice(index + 1).some(Boolean)),
    );
  }

  private link(x: number, y: number, direction: number, style: EdgeStyle) {
    if (x < 0 || y < 0) return;
    const key = `${x},${y}`;
    this.links.set(key, (this.links.get(key) ?? 0) | direction);
    if (style !== "solid" || !this.styles.has(key)) this.styles.set(key, style);
  }

  private lineCharacter(link: number, style: EdgeStyle = "solid"): string {
    if (!(link & (left | right))) return vertical[style];
    if (!(link & (up | down))) return horizontal[style];
    return junctions[link] ?? "┼";
  }
}

// ── Layered layout ─────────────────────────────────────────────────────────

interface Placed {
  readonly id: string;
  readonly label: string;
  readonly shape: NodeShape;
  readonly dummy: boolean;
  layer: number;
  order: number;
  x: number;
  y: number;
  width: number;
}

interface Segment {
  readonly from: Placed;
  readonly to: Placed;
  readonly label?: string;
  readonly style: EdgeStyle;
  readonly arrow: boolean;
}

interface Layout {
  readonly layers: Placed[][];
  readonly segments: Segment[];
  readonly back: FlowEdge[];
}

function layout(graph: Flowchart): Layout {
  const ids = [...graph.nodes.keys()];
  const outgoing = new Map(ids.map((id) => [id, [] as FlowEdge[]]));
  const incoming = new Map(ids.map((id) => [id, 0]));
  for (const edge of graph.edges) {
    outgoing.get(edge.from)?.push(edge);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  // Depth-first from the roots: an edge back onto the path is a cycle.
  const back = new Set<FlowEdge>();
  const state = new Map<string, "open" | "done">();
  const visit = (id: string) => {
    state.set(id, "open");
    for (const edge of outgoing.get(id) ?? []) {
      const next = state.get(edge.to);
      if (next === "open") back.add(edge);
      else if (!next) visit(edge.to);
    }
    state.set(id, "done");
  };
  for (const id of ids) if (!incoming.get(id) && !state.has(id)) visit(id);
  for (const id of ids) if (!state.has(id)) visit(id);
  const forward = graph.edges.filter((edge) => !back.has(edge));
  // Longest path layering over the acyclic edges.
  const layer = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const edge of forward) {
      const next = (layer.get(edge.from) ?? 0) + 1;
      if (next > (layer.get(edge.to) ?? 0)) {
        layer.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const placed = new Map<string, Placed>();
  const layers: Placed[][] = [];
  const add = (node: Placed) => {
    while (layers.length <= node.layer) layers.push([]);
    node.order = (layers[node.layer] as Placed[]).length;
    (layers[node.layer] as Placed[]).push(node);
    return node;
  };
  for (const id of ids) {
    const node = graph.nodes.get(id) as FlowNode;
    placed.set(
      id,
      add({
        ...node,
        dummy: false,
        layer: layer.get(id) ?? 0,
        order: 0,
        x: 0,
        y: 0,
        width: displayWidth(node.label) + 4,
      }),
    );
  }
  // Edges that skip layers pass through invisible one-column nodes.
  const segments: Segment[] = [];
  let dummies = 0;
  for (const edge of forward) {
    let from = placed.get(edge.from) as Placed;
    const to = placed.get(edge.to) as Placed;
    for (let level = from.layer + 1; level < to.layer; level++) {
      const dummy = add({
        id: `\u0000${dummies++}`,
        label: "",
        shape: "rect",
        dummy: true,
        layer: level,
        order: 0,
        x: 0,
        y: 0,
        width: 1,
      });
      segments.push({ from, to: dummy, style: edge.style, arrow: false });
      from = dummy;
    }
    segments.push({
      from,
      to,
      ...(edge.label ? { label: edge.label } : {}),
      style: edge.style,
      arrow: edge.arrow,
    });
  }
  // Two barycenter sweeps to reduce crossings.
  for (let sweep = 0; sweep < 2; sweep++)
    for (const row of layers.slice(1)) {
      const center = (node: Placed) => {
        const parents = segments.filter((segment) => segment.to === node);
        return parents.length
          ? parents.reduce((sum, segment) => sum + segment.from.order, 0) /
              parents.length
          : node.order;
      };
      const keyed = row.map((node) => [center(node), node] as const);
      keyed.sort((left, right) => left[0] - right[0]);
      keyed.forEach(([, node], index) => {
        node.order = index;
        row[index] = node;
      });
    }
  return {
    layers,
    segments,
    back: graph.edges.filter((edge) => back.has(edge)),
  };
}

/** Spreads `count` attachment points across a box edge. */
function spread(start: number, size: number, count: number, index: number) {
  if (size <= 2) return start;
  return start + Math.round(((index + 1) * size) / (count + 1));
}

function drawDown({ layers, segments }: Layout): string[] {
  const canvas = new Canvas();
  const gap = 3;
  const widths = layers.map(
    (row) =>
      row.reduce((sum, node) => sum + node.width, 0) + gap * (row.length - 1),
  );
  const total = Math.max(...widths);
  // Columns first: routing into a layer needs its boxes' positions.
  layers.forEach((row, level) => {
    let x = Math.floor((total - (widths[level] ?? 0)) / 2);
    for (const node of row) {
      node.x = x;
      x += node.width + gap;
    }
  });
  let y = 0;
  layers.forEach((row, level) => {
    for (const node of row) {
      node.y = y;
      if (node.dummy)
        canvas.path([
          [node.x, y],
          [node.x, y + 2],
        ]);
      else canvas.box(node.x, y, node.width, node.label, node.shape);
    }
    const below = segments.filter((segment) => segment.from.layer === level);
    if (!below.length) {
      y += 3;
      return;
    }
    const exits = new Map<Segment, number>();
    const entries = new Map<Segment, number>();
    for (const node of row) {
      const out = below
        .filter((segment) => segment.from === node)
        .sort((left, right) => left.to.x - right.to.x);
      out.forEach((segment, index) => {
        exits.set(
          segment,
          node.dummy
            ? node.x
            : spread(node.x, node.width - 1, out.length, index),
        );
      });
    }
    for (const node of layers[level + 1] ?? []) {
      const into = below
        .filter((segment) => segment.to === node)
        .sort((left, right) => left.from.x - right.from.x);
      into.forEach((segment, index) => {
        entries.set(
          segment,
          node.dummy
            ? node.x
            : spread(node.x, node.width - 1, into.length, index),
        );
      });
    }
    const bent = below.filter(
      (segment) => exits.get(segment) !== entries.get(segment),
    );
    const labelled = below.some((segment) => segment.label);
    const top = y + 3;
    const arrowRow = top + 1 + bent.length + (labelled ? 1 : 0);
    for (const segment of below) {
      const from = exits.get(segment) ?? 0;
      const to = entries.get(segment) ?? 0;
      const bus = top + 1 + bent.indexOf(segment);
      const head = !segment.to.dummy && segment.arrow;
      const end = arrowRow;
      canvas.path(
        from === to
          ? [
              [from, top],
              [to, end],
            ]
          : [
              [from, top],
              [from, bus],
              [to, bus],
              [to, end],
            ],
        segment.style,
      );
      if (head) canvas.put(to, arrowRow, "▼");
      if (segment.label) canvas.label(to + 2, arrowRow - 1, segment.label, 24);
    }
    y = arrowRow + 1;
  });
  return canvas.rows();
}

function drawRight({ layers, segments }: Layout): string[] {
  const canvas = new Canvas();
  const columns = layers.map((row) =>
    Math.max(...row.map((node) => (node.dummy ? 1 : node.width))),
  );
  const heights = layers.map(
    (row) =>
      row.reduce((sum, node) => sum + (node.dummy ? 1 : 3), 0) +
      (row.length - 1),
  );
  const labelled = segments.some((segment) => segment.label);
  const total = Math.max(...heights) + (labelled ? 1 : 0);
  // Rows first: routing into a layer needs its boxes' positions.
  layers.forEach((row, level) => {
    let y =
      Math.floor((total - (heights[level] ?? 0)) / 2) + (labelled ? 1 : 0);
    for (const node of row) {
      node.y = node.dummy ? y : y + 1;
      y += (node.dummy ? 1 : 3) + 1;
    }
  });
  let x = 0;
  layers.forEach((row, level) => {
    const width = columns[level] ?? 1;
    for (const node of row) {
      node.x = x;
      if (node.dummy)
        canvas.path([
          [x, node.y],
          [x + width - 1, node.y],
        ]);
      else canvas.box(x, node.y - 1, node.width, node.label, node.shape);
    }
    const out = segments.filter((segment) => segment.from.layer === level);
    if (!out.length) return;
    // Edges leaving one box turn down or up together, in one column.
    const turning = row.filter((node) =>
      out.some((segment) => segment.from === node && segment.to.y !== node.y),
    );
    const labelWidth = Math.max(
      0,
      ...out.map((segment) =>
        segment.label ? Math.min(24, displayWidth(segment.label)) + 1 : 0,
      ),
    );
    const start = x + width;
    const arrowColumn = start + 1 + turning.length + labelWidth + 1;
    for (const segment of out) {
      const exit = x + (segment.from.dummy ? width : segment.from.width);
      const bus = start + 1 + turning.indexOf(segment.from);
      const head = !segment.to.dummy && segment.arrow;
      const end = arrowColumn;
      canvas.path(
        segment.from.y === segment.to.y
          ? [
              [exit, segment.from.y],
              [end, segment.to.y],
            ]
          : [
              [exit, segment.from.y],
              [bus, segment.from.y],
              [bus, segment.to.y],
              [end, segment.to.y],
            ],
        segment.style,
      );
      if (head) canvas.put(arrowColumn, segment.to.y, "▶");
      if (segment.label)
        canvas.label(
          start + 1 + turning.length,
          segment.to.y - 1,
          segment.label,
          labelWidth,
        );
    }
    x = arrowColumn + 1;
  });
  return canvas.rows();
}

function fits(rows: readonly string[], width: number): boolean {
  return rows.every((row) => displayWidth(row) <= width);
}

function drawFlowchart(source: string, width: number, style: Style): string[] {
  const graph = parseFlowchart(source);
  if (!graph.nodes.size) return [];
  const label = (id: string) => graph.nodes.get(id)?.label ?? id;
  const room = width - indent.length;
  const directions =
    graph.direction === "LR" ? [drawRight, drawDown] : [drawDown, drawRight];
  let rows: string[] | undefined;
  let back: FlowEdge[] = [];
  for (const draw of directions) {
    const result = layout(graph);
    const drawn = draw(result);
    if (fits(drawn, room)) {
      rows = drawn;
      back = result.back;
      break;
    }
  }
  const note = (edge: FlowEdge) =>
    `${label(edge.from)} → ${label(edge.to)}${edge.label ? ` (${edge.label})` : ""}`;
  if (!rows)
    return graph.edges.length
      ? graph.edges.map((edge) => `${indent}${note(edge)}`)
      : [...graph.nodes.values()].map((node) => `${indent}${node.label}`);
  return [
    ...rows.map((row) => `${indent}${row}`),
    ...back.map((edge) => style.dim(`${indent}↺ ${note(edge)}`)),
  ];
}

// ── Sequence diagrams ──────────────────────────────────────────────────────

type SequenceEvent =
  | { kind: "message"; from: number; to: number; text: string; dashed: boolean }
  | { kind: "note"; at: number; until: number; text: string }
  | { kind: "block"; text: string };

function drawSequence(source: string, width: number): string[] {
  const names: string[] = [];
  const labels: string[] = [];
  const index = (name: string) => {
    let found = names.indexOf(name);
    if (found < 0) {
      found = names.push(name) - 1;
      labels.push(name);
    }
    return found;
  };
  const events: SequenceEvent[] = [];
  for (const line of source.split("\n").slice(1)) {
    const participant = line.match(
      /^\s*(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/,
    );
    if (participant) {
      const at = index(participant[1] ?? "");
      labels[at] = (participant[2] ?? participant[1] ?? "").trim();
      continue;
    }
    const message = line.match(
      /^\s*([^\s:>-]+?)\s*(--?>>?|--?[x)])\s*[+-]?\s*([^\s:]+?)\s*:\s*(.*)$/,
    );
    if (message) {
      events.push({
        kind: "message",
        from: index(message[1] ?? ""),
        to: index(message[3] ?? ""),
        text: (message[4] ?? "").trim(),
        dashed: (message[2] ?? "").startsWith("--"),
      });
      continue;
    }
    const note = line.match(
      /^\s*note\s+(?:right of|left of|over)\s+([^,:]+?)(?:\s*,\s*([^:]+?))?\s*:\s*(.*)$/i,
    );
    if (note) {
      const at = index(note[1]?.trim() ?? "");
      events.push({
        kind: "note",
        at,
        until: note[2] ? index(note[2].trim()) : at,
        text: (note[3] ?? "").trim(),
      });
      continue;
    }
    const block = line.match(
      /^\s*(loop|alt|else|opt|par|and|critical|break|rect|end)\b\s*(.*)$/,
    );
    if (block)
      events.push({
        kind: "block",
        text: `${block[1]} ${block[2] ?? ""}`.trim(),
      });
  }
  if (!names.length) return [];
  // Lifeline positions: wide enough for names and the messages between them.
  const half = labels.map((label) => Math.ceil((displayWidth(label) + 4) / 2));
  const gaps = names
    .slice(1)
    .map((_, at) => (half[at] ?? 0) + (half[at + 1] ?? 0) + 3);
  for (const event of events) {
    if (event.kind !== "message") continue;
    const need = displayWidth(event.text) + 4;
    if (event.from === event.to) {
      if (event.from < gaps.length)
        gaps[event.from] = Math.max(gaps[event.from] ?? 0, need + 4);
      continue;
    }
    const low = Math.min(event.from, event.to);
    const high = Math.max(event.from, event.to);
    const span = gaps.slice(low, high).reduce((sum, gap) => sum + gap, 0);
    if (span < need) gaps[high - 1] = (gaps[high - 1] ?? 0) + need - span;
  }
  const centers = [half[0] ?? 0];
  for (const gap of gaps) centers.push((centers.at(-1) ?? 0) + gap);
  const canvas = new Canvas();
  labels.forEach((label, at) => {
    const center = centers[at] ?? 0;
    const boxWidth = displayWidth(label) + 4;
    canvas.box(center - Math.floor(boxWidth / 2), 0, boxWidth, label, "rect");
    canvas.put(center, 2, "┬");
  });
  let y = 3;
  const lifelines = (row: number) => {
    for (const center of centers) canvas.line(center, row, "│");
  };
  for (const event of events) {
    if (event.kind === "block") {
      canvas.text(0, y, `── ${event.text}`);
      lifelines(y);
      y += 1;
      continue;
    }
    if (event.kind === "note") {
      const low = Math.min(event.at, event.until);
      canvas.text((centers[low] ?? 0) + 2, y, `[${event.text}]`);
      lifelines(y);
      y += 1;
      continue;
    }
    const from = centers[event.from] ?? 0;
    const to = centers[event.to] ?? 0;
    const line = event.dashed ? "┄" : "─";
    if (from === to) {
      canvas.text(from + 1, y, `${line}┐ ${event.text}`);
      canvas.text(from + 1, y + 1, "◀┘");
      lifelines(y);
      lifelines(y + 1);
      y += 2;
      continue;
    }
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    canvas.text(
      low +
        Math.max(2, Math.floor((high - low - displayWidth(event.text)) / 2)),
      y,
      event.text,
    );
    for (let column = low + 1; column < high; column++)
      canvas.put(column, y + 1, line);
    canvas.put(to > from ? to - 1 : to + 1, y + 1, to > from ? "▶" : "◀");
    lifelines(y);
    lifelines(y + 1);
    y += 2;
  }
  lifelines(y);
  const rows = canvas.rows();
  if (fits(rows, width - indent.length))
    return rows.map((row) => `${indent}${row}`);
  return events.map((event) =>
    event.kind === "message"
      ? `${indent}${labels[event.from]} → ${labels[event.to]}: ${event.text}`
      : event.kind === "note"
        ? `${indent}[${event.text}]`
        : `${indent}── ${event.text}`,
  );
}

// ── Pie charts ─────────────────────────────────────────────────────────────

function drawPie(source: string, width: number, style: Style): string[] {
  const lines = source.split("\n");
  const title =
    lines[0]?.match(/title\s+(.*)$/)?.[1] ??
    lines.map((line) => line.match(/^\s*title\s+(.*)$/)?.[1]).find(Boolean);
  const slices = lines
    .map((line) => line.match(/^\s*"([^"]+)"\s*:\s*([\d.]+)/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ label: match[1] ?? "", value: Number(match[2]) }))
    .filter((slice) => Number.isFinite(slice.value) && slice.value >= 0);
  const sum = slices.reduce((total, slice) => total + slice.value, 0);
  if (!slices.length || !sum) return [];
  const labelWidth = Math.max(
    ...slices.map((slice) => displayWidth(slice.label)),
  );
  const largest = Math.max(...slices.map((slice) => slice.value));
  const bar = Math.max(
    4,
    Math.min(40, width - indent.length - labelWidth - 10),
  );
  return [
    ...(title ? [`${indent}${style.bold(title.trim())}`] : []),
    ...slices.map((slice) => {
      const length = Math.max(1, Math.round((slice.value / largest) * bar));
      const percent = `${((slice.value / sum) * 100).toFixed(1)}%`;
      return `${indent}${slice.label}${" ".repeat(labelWidth - displayWidth(slice.label))} ${style.accent("█".repeat(length))}${" ".repeat(bar - length)} ${percent.padStart(6)}`;
    }),
  ];
}

/** ```mermaid fences drawn as text; unknown diagram types show their source. */
export const mermaidFenceRenderer: FenceRenderer = {
  languages: ["mermaid"],
  render(source, width, style) {
    const text = source
      .split("\n")
      .filter((line) => line.trim() && !/^\s*%%/.test(line))
      .join("\n");
    const kind = text.trim().split(/\s+/)[0] ?? "";
    const drawn = /^(flowchart|graph|stateDiagram)/.test(kind)
      ? drawFlowchart(text.trim(), width, style)
      : kind === "sequenceDiagram"
        ? drawSequence(text.trim(), width)
        : kind === "pie"
          ? drawPie(text.trim(), width, style)
          : [];
    if (drawn.length) return drawn;
    return [
      style.dim(`${indent}┌ mermaid`),
      ...source
        .split("\n")
        .map((line) => `${indent}${style.accent("│")} ${line}`),
      style.dim(`${indent}└`),
    ];
  },
};
