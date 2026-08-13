import type {
  DesktopGitCommit,
  DesktopGitFile,
  DesktopGitGraph,
} from "../../shared.js";
import {
  type DesktopGitView,
  type GitViewActions,
  type GitViewSnapshot,
  gitStatusSummary,
  stagedGitFiles,
} from "./git-controller.js";

export interface DesktopGitElements {
  readonly document: Document;
  readonly panel: HTMLElement;
  readonly body: HTMLElement;
  readonly branch: HTMLElement;
  readonly counts: HTMLElement;
  readonly graph: HTMLElement;
  readonly files: HTMLElement;
  readonly refresh: HTMLButtonElement;
  readonly toggle: HTMLButtonElement;
  readonly stageAll: HTMLButtonElement;
  readonly discardAll: HTMLButtonElement;
  readonly pull: HTMLButtonElement;
  readonly push: HTMLButtonElement;
  readonly commitForm: HTMLFormElement;
  readonly commitMessage: HTMLInputElement;
  readonly commit: HTMLButtonElement;
  readonly generateCommitMessage: HTMLButtonElement;
}

export interface DesktopGitViewCallbacks {
  readonly syntaxErrorTitle: (path: string) => string | undefined;
  readonly openFile: (path: string) => void;
}

export interface GitGraphRow {
  readonly commit: DesktopGitCommit;
  readonly laneIndex: number;
  readonly before: readonly string[];
  readonly after: readonly string[];
}

const gitGraphColors = [
  "#f28b30",
  "#4f9cf9",
  "#e03b8b",
  "#f1bd22",
  "#9b6ade",
  "#54d7b0",
];

export function desktopGitElements(document: Document): DesktopGitElements {
  const element = <T extends HTMLElement>(id: string): T =>
    document.getElementById(id) as T;
  return {
    document,
    panel: element<HTMLElement>("gitPanel"),
    body: element<HTMLElement>("gitBody"),
    branch: element<HTMLElement>("gitBranch"),
    counts: element<HTMLElement>("gitCounts"),
    graph: element<HTMLElement>("gitGraph"),
    files: element<HTMLElement>("gitFiles"),
    refresh: element<HTMLButtonElement>("refreshGit"),
    toggle: element<HTMLButtonElement>("toggleGit"),
    stageAll: element<HTMLButtonElement>("stageAll"),
    discardAll: element<HTMLButtonElement>("discardAll"),
    pull: element<HTMLButtonElement>("pullGit"),
    push: element<HTMLButtonElement>("pushGit"),
    commitForm: element<HTMLFormElement>("commitForm"),
    commitMessage: element<HTMLInputElement>("commitMessage"),
    commit: element<HTMLButtonElement>("commitButton"),
    generateCommitMessage: element<HTMLButtonElement>("generateCommitMessage"),
  };
}

export function gitStatusLabel(file: DesktopGitFile): string {
  const status = `${file.indexStatus}${file.workTreeStatus}`;
  if (status === "??") return "NEW";
  if (status.includes("A")) return "ADD";
  if (status.includes("D")) return "DEL";
  if (status.includes("R")) return "REN";
  if (status.includes("M")) return "MOD";
  return status.trim() || "CHG";
}

export function gitGraphRefLabel(ref: string): string {
  return ref
    .replace(/^HEAD -> /, "")
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\//, "");
}

export function layoutGitGraph(
  commits: readonly DesktopGitCommit[],
): readonly GitGraphRow[] {
  const lanes: string[] = [];
  return commits.map((commit) => {
    let laneIndex = lanes.indexOf(commit.hash);
    if (laneIndex < 0) {
      laneIndex = 0;
      lanes.unshift(commit.hash);
    }
    const before = [...lanes];
    lanes.splice(laneIndex, 1, ...commit.parents);
    const nextLanes = lanes.filter(
      (hash, index) => lanes.indexOf(hash) === index,
    );
    lanes.splice(0, lanes.length, ...nextLanes);
    return { commit, laneIndex, before, after: [...lanes] };
  });
}

function graphDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function appendSvgLine(
  document: Document,
  svg: SVGSVGElement,
  attributes: Record<string, string>,
): void {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  for (const [name, value] of Object.entries(attributes))
    line.setAttribute(name, value);
  svg.append(line);
}

function appendSvgPath(
  document: Document,
  svg: SVGSVGElement,
  attributes: Record<string, string>,
): void {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  for (const [name, value] of Object.entries(attributes))
    path.setAttribute(name, value);
  svg.append(path);
}

/** Owns Git panel DOM rendering and event binding. */
export class DesktopGitDomView implements DesktopGitView {
  constructor(
    readonly elements: DesktopGitElements,
    private readonly callbacks: DesktopGitViewCallbacks,
  ) {}

  bind(actions: GitViewActions): void {
    this.elements.refresh.onclick = actions.refresh;
    this.elements.toggle.onclick = actions.toggleCollapsed;
    this.elements.stageAll.onclick = actions.stageAll;
    this.elements.discardAll.onclick = actions.discardAll;
    this.elements.pull.onclick = actions.pull;
    this.elements.push.onclick = actions.push;
    this.elements.generateCommitMessage.onclick = actions.generateCommitMessage;
    this.elements.commitForm.onsubmit = (event) => {
      event.preventDefault();
      actions.commit(this.elements.commitMessage.value);
    };
  }

  render(snapshot: GitViewSnapshot, actions: GitViewActions): void {
    const { status } = snapshot;
    this.elements.panel.classList.toggle("collapsed", snapshot.collapsed);
    this.elements.body.hidden = snapshot.collapsed;
    this.elements.toggle.textContent = snapshot.collapsed ? "Show" : "Hide";
    this.elements.toggle.title = snapshot.collapsed
      ? "Expand Git panel"
      : "Collapse Git panel";
    this.elements.toggle.setAttribute(
      "aria-expanded",
      String(!snapshot.collapsed),
    );
    if (!status.available) {
      this.elements.branch.textContent = "Git unavailable";
      this.elements.counts.textContent = "";
      this.renderGraph(snapshot.graph);
      this.elements.files.replaceChildren();
      this.elements.commit.disabled = true;
      this.elements.commit.title = "Git is unavailable in this workspace";
      this.elements.pull.disabled = true;
      this.elements.push.disabled = true;
      return;
    }

    const staged = stagedGitFiles(status);
    this.elements.branch.textContent = status.branch || "No branch yet";
    this.elements.counts.textContent = gitStatusSummary(status);
    this.renderGraph(snapshot.graph);
    this.elements.commit.disabled = status.files.length === 0;
    this.elements.commit.title = staged.length
      ? "Commit staged changes"
      : "Commit all changed files; staging happens automatically";
    this.elements.pull.disabled = false;
    this.elements.push.disabled = !status.pushRemote;
    this.elements.push.title = status.pushRemote
      ? `Push to ${status.pushRemote}`
      : "No push remote configured. Add one with: git remote add origin <url>";
    this.elements.stageAll.textContent = staged.length
      ? "Unstage all"
      : "Stage all";
    this.elements.stageAll.title = staged.length
      ? "Unstage every staged file"
      : "Stage all changed files";
    this.elements.stageAll.disabled = status.files.length === 0;
    this.elements.discardAll.disabled = status.files.length === 0;
    this.elements.files.replaceChildren(
      ...status.files.map((file) => this.renderFile(file, actions)),
    );
  }

  setCommitMessage(message: string): void {
    this.elements.commitMessage.value = message;
  }

  focusCommitMessage(): void {
    this.elements.commitMessage.focus();
  }

  setGeneratingCommitMessage(generating: boolean): void {
    this.elements.generateCommitMessage.disabled = generating;
    this.elements.generateCommitMessage.textContent = generating
      ? "Generating..."
      : "Generate";
  }

  private renderFile(
    file: DesktopGitFile,
    actions: GitViewActions,
  ): HTMLElement {
    const document = this.elements.document;
    const row = document.createElement("div");
    row.className = "git-file-row";
    const status = document.createElement("span");
    status.className = "git-file-status";
    status.textContent = gitStatusLabel(file);
    const open = document.createElement("button");
    open.className = "git-file-name";
    open.textContent = file.path;
    const syntaxError = this.callbacks.syntaxErrorTitle(file.path);
    row.classList.toggle("has-syntax-error", Boolean(syntaxError));
    open.title = syntaxError ? `${file.path}\n${syntaxError}` : file.path;
    open.onclick = () => this.callbacks.openFile(file.path);
    const fileActions = document.createElement("div");
    fileActions.className = "git-row-actions";
    row.append(status, open, fileActions);
    if (file.indexStatus !== " " && file.indexStatus !== "?") {
      fileActions.append(
        this.fileAction("-", `Unstage ${file.path}`, () =>
          actions.unstageFile(file.path),
        ),
      );
    }
    if (file.workTreeStatus !== " " || file.indexStatus === "?") {
      fileActions.append(
        this.fileAction("+", `Stage ${file.path}`, () =>
          actions.stageFile(file.path),
        ),
      );
    }
    fileActions.append(
      this.fileAction(
        "x",
        `Discard ${file.path}`,
        () => actions.discardFile(file.path),
        true,
        `Discard all uncommitted changes in ${file.path}`,
      ),
    );
    return row;
  }

  private fileAction(
    text: string,
    ariaLabel: string,
    action: () => void,
    danger = false,
    title = ariaLabel,
  ): HTMLButtonElement {
    const button = this.elements.document.createElement("button");
    button.className = `git-row-action${danger ? " danger" : ""}`;
    button.textContent = text;
    button.title = title;
    button.setAttribute("aria-label", ariaLabel);
    button.onclick = action;
    return button;
  }

  private renderGraph(graph: DesktopGitGraph): void {
    const document = this.elements.document;
    this.elements.graph.replaceChildren();
    if (!graph.available) {
      this.elements.graph.textContent = "Git history unavailable.";
      return;
    }
    if (!graph.commits.length) {
      this.elements.graph.textContent = "No commits yet.";
      return;
    }

    const rows = layoutGitGraph(graph.commits);
    const laneCount = Math.max(
      1,
      ...rows.flatMap((row) => [row.before.length, row.after.length]),
    );
    const graphWidth = Math.max(42, laneCount * 16 + 18);
    this.elements.graph.replaceChildren(
      ...rows.map(({ commit, laneIndex, before, after }) => {
        const row = document.createElement("div");
        row.className = "git-graph-row";
        const visual = document.createElement("div");
        visual.className = "git-graph-visual";
        visual.style.width = `${graphWidth}px`;
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        svg.setAttribute("viewBox", `0 0 ${graphWidth} 36`);
        svg.setAttribute("aria-hidden", "true");
        const xFor = (index: number) => 9 + index * 16;
        before.forEach((_hash, index) => {
          const color = gitGraphColors[index % gitGraphColors.length];
          appendSvgLine(document, svg, {
            x1: String(xFor(index)),
            y1: "0",
            x2: String(xFor(index)),
            y2: "36",
            stroke: color,
            "stroke-width": "2",
          });
        });
        const currentX = xFor(laneIndex);
        commit.parents.forEach((parent) => {
          const parentIndex = after.indexOf(parent);
          if (parentIndex < 0) return;
          const parentX = xFor(parentIndex);
          if (parentX === currentX) return;
          appendSvgPath(document, svg, {
            d: `M ${currentX} 18 C ${currentX} 27, ${parentX} 27, ${parentX} 36`,
            fill: "none",
            stroke: gitGraphColors[parentIndex % gitGraphColors.length],
            "stroke-width": "2",
          });
        });
        const node = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        node.setAttribute("cx", String(currentX));
        node.setAttribute("cy", "18");
        node.setAttribute("r", "5");
        node.setAttribute(
          "fill",
          gitGraphColors[laneIndex % gitGraphColors.length],
        );
        node.setAttribute("stroke", "#11161a");
        node.setAttribute("stroke-width", "2");
        svg.append(node);
        visual.append(svg);

        const details = document.createElement("div");
        details.className = "git-graph-commit";
        const heading = document.createElement("div");
        heading.className = "git-graph-commit-heading";
        const subject = document.createElement("span");
        subject.className = "git-graph-subject";
        subject.textContent = commit.subject;
        subject.title = `${commit.subject}\n${commit.hash}`;
        heading.append(subject);
        for (const ref of commit.refs) {
          const badge = document.createElement("span");
          badge.className = `git-ref-badge ${ref.includes("remotes/") ? "remote" : ""}`;
          badge.textContent = gitGraphRefLabel(ref);
          badge.title = ref;
          heading.append(badge);
        }
        const metadata = document.createElement("span");
        metadata.className = "git-graph-meta";
        metadata.textContent = `${commit.author} · ${graphDate(commit.authoredAt)} · ${commit.shortHash}`;
        details.append(heading, metadata);
        row.append(visual, details);
        return row;
      }),
    );
  }
}
