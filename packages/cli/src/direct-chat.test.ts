import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("real CLI ask and auto-read fail closed without a TTY; explicit auto-all writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "truss-direct-chat-"));
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body) as { messages: { role: string }[] };
    const done = parsed.messages.some((message) => message.role === "tool");
    response.setHeader("content-type", "text/event-stream");
    const delta = done
      ? { content: "Finished" }
      : {
          tool_calls: [
            {
              index: 0,
              id: "write",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({
                  path: "canary.txt",
                  content: "authorized",
                }),
              },
            },
          ],
        };
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta, finish_reason: done ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No local server");
    for (const mode of ["ask", "auto-read", "auto-all"]) {
      const result = await new Promise<{ code: number | null; output: string }>(
        (resolveChild, reject) => {
          const child = spawn(
            process.execPath,
            [
              resolve("packages/cli/dist/bin.js"),
              "chat",
              "Perform the fixture action",
              "--provider",
              "openai-compatible",
              "--model",
              "fixture",
              "--base-url",
              `http://127.0.0.1:${address.port}/v1`,
              "--mode",
              "edit",
              "--permission",
              mode,
            ],
            {
              cwd: root,
              env: {
                PATH: process.env.PATH,
                XDG_CONFIG_HOME: join(root, "user"),
              },
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          let output = "";
          child.stdout.on("data", (chunk) => {
            output += chunk;
          });
          child.stderr.on("data", (chunk) => {
            output += chunk;
          });
          child.stdin.end();
          const timeout = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`CLI stalled: ${output}`));
          }, 10000);
          child.once("error", reject);
          child.once("close", (code) => {
            clearTimeout(timeout);
            resolveChild({ code, output });
          });
        },
      );
      if (mode === "auto-all") {
        expect(result.code, result.output).toBe(0);
        expect(await readFile(join(root, "canary.txt"), "utf8")).toBe(
          "authorized",
        );
      } else {
        expect(result.code, result.output).toBe(1);
        expect(result.output).toMatch(
          /non.interactive|TTY|approval unavailable/i,
        );
        await expect(readFile(join(root, "canary.txt"))).rejects.toThrow();
      }
    }
  } finally {
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    );
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it.runIf(process.platform === "linux").each(["one-shot", "interactive"])(
  "real %s TTY CLI exits after provider initialization rejects",
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "truss-tty-init-"));
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const args = [
      process.execPath,
      resolve("packages/cli/dist/bin.js"),
      "chat",
      ...(kind === "one-shot" ? ["fixture"] : []),
      "--provider",
      "ollama",
      "--model",
      "fixture",
      "--base-url",
      "invalid",
    ];
    try {
      // Linux util-linux script supplies a real PTY while this test keeps its
      // input pipe open. EOF must not accidentally hide a leaked stdin owner.
      const result = await new Promise<{
        code: number | null;
        output: string;
        stalled: boolean;
      }>((resolveChild, reject) => {
        const child = spawn(
          "/usr/bin/script",
          [
            "--quiet",
            "--return",
            "--command",
            `exec ${args.map(quote).join(" ")}`,
            "/dev/null",
          ],
          {
            cwd: root,
            env: {
              PATH: process.env.PATH,
              XDG_CONFIG_HOME: join(root, "user"),
            },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let output = "",
          stalled = false;
        let exitDeadline: ReturnType<typeof setTimeout> | undefined;
        const terminate = () => {
          stalled = true;
          child.kill("SIGTERM");
        };
        const startupDeadline = setTimeout(terminate, 15000);
        const receive = (chunk: Buffer) => {
          output += chunk.toString();
          if (
            !exitDeadline &&
            output.includes("requires a valid HTTP or HTTPS endpoint")
          ) {
            clearTimeout(startupDeadline);
            exitDeadline = setTimeout(terminate, 1500);
          }
        };
        child.stdout.on("data", receive);
        child.stderr.on("data", receive);
        child.once("error", (error) => {
          clearTimeout(startupDeadline);
          clearTimeout(exitDeadline);
          reject(error);
        });
        child.once("close", (code) => {
          clearTimeout(startupDeadline);
          clearTimeout(exitDeadline);
          resolveChild({ code, output, stalled });
        });
      });
      expect(result.output).toContain(
        "Ollama requires a valid HTTP or HTTPS endpoint.",
      );
      expect(result.stalled, result.output).toBe(false);
      expect(result.code, result.output).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  25000,
);
