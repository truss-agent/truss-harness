import { relative } from "node:path";
import type {
  DesktopConfiguration,
  DesktopGitGraph,
  DesktopGitStatus,
} from "../shared.js";

type ExecFile = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly maxBuffer: number },
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

export class GitService {
  constructor(
    private readonly workspaceRoot: () => string,
    private readonly resolveWorkspacePath: (path: string) => string,
    private readonly execFile: ExecFile,
    private readonly configuration: () => DesktopConfiguration | undefined,
    private readonly generateText: (
      configuration: DesktopConfiguration,
      prompt: string,
    ) => Promise<string>,
  ) {}

  async output(args: readonly string[]): Promise<string> {
    try {
      return (
        await this.execFile("git", args, {
          cwd: this.workspaceRoot(),
          maxBuffer: 1_000_000,
        })
      ).stdout;
    } catch (error) {
      const stdout =
        error && typeof error === "object" && "stdout" in error
          ? (error as { readonly stdout?: unknown }).stdout
          : undefined;
      return typeof stdout === "string" ? stdout : "";
    }
  }

  async command(args: readonly string[]): Promise<string> {
    try {
      const { stdout, stderr } = await this.execFile("git", args, {
        cwd: this.workspaceRoot(),
        maxBuffer: 1_000_000,
      });
      return (stdout || stderr || "Git command completed.").trim();
    } catch (error) {
      const detail =
        error && typeof error === "object"
          ? ["stderr", "stdout"]
              .map((key) => (error as Record<string, unknown>)[key])
              .find(
                (value): value is string =>
                  typeof value === "string" && Boolean(value.trim()),
              )
          : undefined;
      throw new Error(
        detail?.trim() ||
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  paths(paths: readonly string[]): string[] {
    if (!Array.isArray(paths) || !paths.length)
      throw new Error("Select at least one file.");
    return paths.map((path) =>
      relative(this.workspaceRoot(), this.resolveWorkspacePath(path)),
    );
  }

  async status(): Promise<DesktopGitStatus> {
    try {
      const output = await this.command([
        "status",
        "--porcelain=v1",
        "--branch",
      ]);
      const pushRemote = await this.pushRemoteName();
      let branch: string | undefined;
      let ahead = 0;
      let behind = 0;
      const files: DesktopGitStatus["files"][number][] = [];
      for (const line of output.split(/\r?\n/)) {
        if (line.startsWith("## ")) {
          const details = line.slice(3);
          branch = details.split("...")[0].trim();
          const aheadBehind = details.match(
            /\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)(?:, ahead (\d+))?\]/,
          );
          if (aheadBehind) {
            ahead = Number.parseInt(
              aheadBehind[1] ?? aheadBehind[4] ?? "0",
              10,
            );
            behind = Number.parseInt(
              aheadBehind[2] ?? aheadBehind[3] ?? "0",
              10,
            );
          }
          continue;
        }
        if (line.length < 4) continue;
        files.push({
          path: line.slice(3),
          indexStatus: line[0],
          workTreeStatus: line[1],
        });
      }
      return {
        available: true,
        branch,
        ahead,
        behind,
        files,
        ...(pushRemote ? { pushRemote } : {}),
      };
    } catch (error) {
      return {
        available: false,
        ahead: 0,
        behind: 0,
        files: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async graph(): Promise<DesktopGitGraph> {
    try {
      const output = await this.command([
        "log",
        "--all",
        "--max-count=80",
        "--date=iso-strict",
        "--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%P%x1f%D%x1f%s",
      ]);
      const commits = output
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          const [hash, shortHash, author, authoredAt, parents, refs, subject] =
            line.split("\x1f");
          if (!hash || !shortHash || !subject) return [];
          return [
            {
              hash,
              shortHash,
              subject,
              author: author ?? "Unknown author",
              authoredAt: authoredAt ?? "",
              parents: parents ? parents.split(" ").filter(Boolean) : [],
              refs: refs
                ? refs
                    .split(",")
                    .map((ref) => ref.trim())
                    .filter(Boolean)
                : [],
            },
          ];
        });
      return { available: true, commits };
    } catch (error) {
      return {
        available: false,
        commits: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async generateCommitMessage(): Promise<string> {
    const configuration = this.configuration();
    if (!configuration?.model)
      throw new Error("Choose a model before generating a commit message.");
    let diff = await this.output(["diff", "--cached", "--no-ext-diff"]);
    if (!diff.trim()) diff = await this.output(["diff", "--no-ext-diff"]);
    if (!diff.trim())
      throw new Error("There are no staged or unstaged changes to summarize.");
    const prompt = `You write accurate, production-quality Git commit messages. Analyze the diff and return only one Conventional Commit message.

Requirements:
- First line format: type(optional scope): imperative summary
- Choose the most accurate type from feat, fix, refactor, perf, docs, test, build, ci, or chore.
- Keep the subject under 72 characters and describe the actual user-visible or technical change.
- Use specific verbs and nouns. Do not use vague wording such as "update", "changes", or "stuff".
- Add a blank line and a concise body only when it clarifies important behavior, constraints, or follow-up effects.
- Do not include Markdown, quotes, explanations, issue numbers, or text such as "Commit message:".

Diff:
${compactCommitDiff(diff, configuration.contextWindow)}`;
    const response = await this.generateText(configuration, prompt);
    const message = normalizeCommitMessage(response);
    if (!message)
      throw new Error("The model returned an empty commit message.");
    return message;
  }

  async diffFile(path: string): Promise<string> {
    const target = this.resolveWorkspacePath(path);
    const relativePath = relative(this.workspaceRoot(), target);
    const againstHead = await this.output([
      "diff",
      "--no-ext-diff",
      "HEAD",
      "--",
      relativePath,
    ]);
    if (againstHead) return againstHead;
    const staged = await this.output([
      "diff",
      "--cached",
      "--no-ext-diff",
      "--",
      relativePath,
    ]);
    const workingTree = await this.output([
      "diff",
      "--no-ext-diff",
      "--",
      relativePath,
    ]);
    if (staged || workingTree)
      return [staged, workingTree].filter(Boolean).join("\n");
    const tracked = await this.output([
      "ls-files",
      "--error-unmatch",
      "--",
      relativePath,
    ]);
    if (!tracked) {
      const untracked = await this.output([
        "diff",
        "--no-index",
        "--",
        "/dev/null",
        relativePath,
      ]);
      if (untracked) return untracked;
    }
    return "No Git diff for this file.";
  }

  stage(paths: readonly string[]): Promise<string> {
    return this.command(["add", "--", ...this.paths(paths)]);
  }

  async unstage(paths: readonly string[]): Promise<string> {
    const selected = this.paths(paths);
    try {
      return await this.command(["restore", "--staged", "--", ...selected]);
    } catch {
      return this.command(["rm", "--cached", "--", ...selected]);
    }
  }

  async discard(paths: readonly string[]): Promise<string> {
    const selected = this.paths(paths);
    const tracked: string[] = [];
    const stagedNew: string[] = [];
    const untracked: string[] = [];
    for (const path of selected) {
      if (await this.pathExistsAtHead(path)) tracked.push(path);
      else if (
        (
          await this.output(["diff", "--cached", "--name-only", "--", path])
        ).trim()
      )
        stagedNew.push(path);
      else untracked.push(path);
    }
    const output: string[] = [];
    if (tracked.length)
      output.push(
        await this.command([
          "restore",
          "--source=HEAD",
          "--staged",
          "--worktree",
          "--",
          ...tracked,
        ]),
      );
    if (stagedNew.length) {
      try {
        output.push(
          await this.command(["restore", "--staged", "--", ...stagedNew]),
        );
      } catch {
        output.push(await this.command(["rm", "--cached", "--", ...stagedNew]));
      }
    }
    const removable = [...stagedNew, ...untracked];
    if (removable.length)
      output.push(
        await this.command(["clean", "-f", "-d", "--", ...removable]),
      );
    return output.filter(Boolean).join("\n") || "Discarded selected changes.";
  }

  async commit(message: string): Promise<string> {
    if (typeof message !== "string" || !message.trim())
      throw new Error("Enter a commit message.");
    await this.command(["add", "-A", "--"]);
    return this.command(["commit", "-m", message.trim()]);
  }

  pull(): Promise<string> {
    return this.command(["pull"]);
  }

  async push(): Promise<string> {
    if (!(await this.pushRemoteName()))
      throw new Error(
        "No push remote is configured. Add one with: git remote add origin <repository-url>",
      );
    return this.command(["push"]);
  }

  private async pathExistsAtHead(path: string): Promise<boolean> {
    try {
      await this.execFile("git", ["cat-file", "-e", `HEAD:${path}`], {
        cwd: this.workspaceRoot(),
        maxBuffer: 1_000_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async pushRemoteName(): Promise<string | undefined> {
    try {
      const { stdout } = await this.execFile("git", ["remote"], {
        cwd: this.workspaceRoot(),
        maxBuffer: 100_000,
      });
      for (const name of stdout.split(/\r?\n/).map((value) => value.trim())) {
        if (!name) continue;
        try {
          const { stdout: url } = await this.execFile(
            "git",
            ["remote", "get-url", "--push", name],
            { cwd: this.workspaceRoot(), maxBuffer: 100_000 },
          );
          if (url.trim()) return name;
        } catch {
          // Ignore remotes without a usable push URL.
        }
      }
    } catch {
      // Status reports repositories that do not expose a usable remote.
    }
    return undefined;
  }
}

export function normalizeCommitMessage(value: string): string {
  return value
    .trim()
    .replace(/^```(?:gitcommit|text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^(?:commit message|message):\s*/i, "")
    .trim();
}

export function compactCommitDiff(diff: string, contextWindow: number): string {
  const limit = Math.max(
    8_000,
    Math.min(48_000, Math.floor(contextWindow * 1.25)),
  );
  if (diff.length <= limit) return diff;
  const segments = diff.split(/(?=^diff --git )/m).filter(Boolean);
  const isGenerated = (segment: string): boolean =>
    /(?:package-lock\.json|(?:^|[/\\])(?:dist|coverage|\.next)(?:[/\\])|\.map(?:\r?$))/m.test(
      segment,
    );
  const selected: string[] = [];
  let remaining = limit - 240;
  for (const segment of [
    ...segments.filter((segment) => !isGenerated(segment)),
    ...segments.filter(isGenerated),
  ]) {
    if (remaining <= 0) break;
    if (segment.length <= remaining) {
      selected.push(segment);
      remaining -= segment.length;
      continue;
    }
    const head = Math.max(1_000, Math.floor(remaining * 0.7));
    const tail = Math.max(500, remaining - head - 90);
    selected.push(
      `${segment.slice(0, head)}\n... diff content omitted for context budget ...\n${segment.slice(-tail)}`,
    );
    remaining = 0;
  }
  if (!selected.length)
    selected.push(
      `${diff.slice(0, Math.floor(limit * 0.7))}\n... diff content omitted for context budget ...\n${diff.slice(-Math.floor(limit * 0.25))}`,
    );
  return `The full diff exceeds the configured context budget. Generate a message from this representative selection; do not mention that it was truncated.\n\n${selected.join("\n")}`;
}
