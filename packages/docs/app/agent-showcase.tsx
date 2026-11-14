"use client";

import { useState } from "react";

type Line =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | {
      kind: "diff";
      file: string;
      rows: { sign: "+" | "-" | " "; text: string }[];
    }
  | { kind: "approve"; text: string }
  | { kind: "ok"; text: string };

type Agent = {
  id: string;
  name: string;
  mode: "Chat" | "Plan" | "Edit";
  model: string;
  where: string;
  status: string;
  lines: Line[];
};

const agents: Agent[] = [
  {
    id: "builder",
    name: "Builder",
    mode: "Edit",
    model: "qwen3-coder",
    where: "local · Ollama",
    status: "waiting for you",
    lines: [
      { kind: "user", text: "Fix the failing login test." },
      { kind: "tool", name: "read_file", detail: "src/auth/login.ts" },
      { kind: "tool", name: "run_terminal", detail: "npm test -- login" },
      {
        kind: "agent",
        text: "The test expects a redirect after sign-in, but the handler returns 200. I'll send the redirect and keep the session cookie.",
      },
      {
        kind: "diff",
        file: "src/auth/login.ts",
        rows: [
          { sign: " ", text: "  setSessionCookie(res, session);" },
          { sign: "-", text: "  return res.status(200).json({ ok: true });" },
          { sign: "+", text: '  return res.redirect(303, "/app");' },
        ],
      },
      { kind: "approve", text: "Apply this edit to src/auth/login.ts?" },
    ],
  },
  {
    id: "planner",
    name: "Planner",
    mode: "Plan",
    model: "claude",
    where: "cloud · your key",
    status: "plan ready",
    lines: [
      { kind: "user", text: "Plan the move from sessions to JWT." },
      { kind: "tool", name: "search_files", detail: '"session" · 14 files' },
      { kind: "tool", name: "update_plan", detail: "plans/jwt-migration.md" },
      {
        kind: "agent",
        text: "Four steps, smallest risk first. Plan mode can't edit code, so nothing has changed yet.",
      },
      { kind: "ok", text: "1 · add token signing behind a flag" },
      { kind: "ok", text: "2 · issue tokens alongside cookies" },
      { kind: "ok", text: "3 · switch middleware, keep fallback" },
      { kind: "ok", text: "4 · remove sessions after one release" },
    ],
  },
  {
    id: "reviewer",
    name: "Reviewer",
    mode: "Chat",
    model: "gemini",
    where: "cloud · your key",
    status: "idle",
    lines: [
      { kind: "user", text: "Anything risky in the current diff?" },
      { kind: "tool", name: "run_terminal", detail: "git diff --stat" },
      {
        kind: "agent",
        text: "One thing: the redirect drops the ?next= parameter, so deep links land on /app instead of the page the user asked for.",
      },
      {
        kind: "agent",
        text: "Everything else looks safe. Chat mode is read-only, so I can't change files.",
      },
    ],
  },
];

export function AgentShowcase() {
  const [active, setActive] = useState(agents[0]?.id ?? "");
  const [approved, setApproved] = useState<null | boolean>(null);
  const agent = agents.find((a) => a.id === active) ?? agents[0];
  if (!agent) return null;

  return (
    <div className="showcase" data-spotlight>
      <div className="showcase-bar">
        <span className="showcase-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>
          truss <em>/</em> ~/projects/web-app
        </span>
        <span className="showcase-tag">Interactive preview</span>
      </div>
      <div className="showcase-body">
        <aside className="showcase-side" aria-label="Agents">
          <p className="showcase-label">
            Agents <span>0{agents.length}</span>
          </p>
          {agents.map((a) => (
            <button
              type="button"
              key={a.id}
              className="showcase-agent"
              aria-pressed={a.id === active}
              onClick={() => {
                setActive(a.id);
                setApproved(null);
              }}
            >
              <span className={`showcase-mode mode-${a.mode.toLowerCase()}`}>
                {a.mode}
              </span>
              <strong>{a.name}</strong>
              <small>
                {a.model} · {a.where}
              </small>
            </button>
          ))}
          <p className="showcase-lease">
            <span aria-hidden="true" /> Write lock held by Builder
          </p>
        </aside>
        <div className="showcase-main" aria-live="polite">
          <div className="showcase-head">
            <span className="showcase-live" aria-hidden="true" />
            {agent.name}
            <em>/</em>
            {agent.mode} mode
            <span className="showcase-status">{agent.status}</span>
          </div>
          <div className="showcase-log" key={agent.id}>
            {agent.lines.map((line, i) => {
              const key = `${agent.id}-${i}`;
              const style = { animationDelay: `${i * 90}ms` };
              switch (line.kind) {
                case "user":
                  return (
                    <p key={key} className="log-user" style={style}>
                      <b>❯</b> {line.text}
                    </p>
                  );
                case "agent":
                  return (
                    <p key={key} className="log-agent" style={style}>
                      {line.text}
                    </p>
                  );
                case "tool":
                  return (
                    <p key={key} className="log-tool" style={style}>
                      <span>{line.name}</span> {line.detail}
                    </p>
                  );
                case "ok":
                  return (
                    <p key={key} className="log-ok" style={style}>
                      {line.text}
                    </p>
                  );
                case "diff":
                  return (
                    <div key={key} className="log-diff" style={style}>
                      <div className="log-diff-head">
                        <span>↳ {line.file}</span>
                        <span>+1 −1</span>
                      </div>
                      <pre>
                        {line.rows.map((row) => (
                          <span
                            key={row.text}
                            className={`d-${row.sign === "+" ? "add" : row.sign === "-" ? "del" : "ctx"}`}
                          >
                            {row.sign} {row.text}
                            {"\n"}
                          </span>
                        ))}
                      </pre>
                    </div>
                  );
                case "approve":
                  return (
                    <div key={key} className="log-approve" style={style}>
                      {approved === null ? (
                        <>
                          <span>{line.text}</span>
                          <button
                            type="button"
                            className="approve-yes"
                            onClick={() => setApproved(true)}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="approve-no"
                            onClick={() => setApproved(false)}
                          >
                            Reject
                          </button>
                        </>
                      ) : approved ? (
                        <span className="approve-done">
                          ✓ Applied · npm test: 42 passed
                        </span>
                      ) : (
                        <span className="approve-rejected">
                          ✕ Rejected · no files changed
                        </span>
                      )}
                    </div>
                  );
              }
              return null;
            })}
          </div>
        </div>
      </div>
      <div className="showcase-foot">
        <span>
          <i aria-hidden="true" /> 3 agents · 1 workspace
        </span>
        <span>approvals: ask before writes and commands</span>
      </div>
    </div>
  );
}
