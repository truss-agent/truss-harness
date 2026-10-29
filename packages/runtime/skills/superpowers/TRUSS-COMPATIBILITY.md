# Superpowers in Truss

This is a Truss adaptation note, not part of upstream Superpowers. The skills
were written for other agent harnesses; use these Truss equivalents. Trust your
actual tool list over this note when they disagree.

- **Invoking a skill** (the `Skill` tool, "invoke the skill"): call `load_skill`
  with the qualified ID, for example `superpowers:brainstorming`. Only skills in
  the Available skills list can be loaded. Announce which skill you are using.
- **Supporting files** a skill mentions (for example `references/fix-loop.md`
  or `implementer-prompt.md`): call `read_skill_resource` with the skill ID and
  the path relative to that skill. When a result includes a next offset, call
  again with that offset to continue a long file.
- **Asking the user and waiting** (clarifying questions, design approval, "wait
  for your human partner"): call `request_user_input` with your question. It
  ends your turn without requiring file changes; the user's reply starts the
  next turn.
- **Todos / checklists**: in Agent mode use `update_plan`; otherwise keep a
  Markdown checklist in your reply.
- **Subagents** (`Agent`, `Task`, `spawn_agent`, parallel dispatch,
  subagent-driven development): not available inside a run. Do the work inline,
  one task at a time, following executing-plans. Mention that the user can start
  separate Truss agents from their client if they want parallel work.
- **Helper scripts bundled with a skill** (`scripts/*`, `*.sh`, `*.js`,
  `*.cjs`): they are not in the workspace and are never run for you. Read them
  only as reference.
- **Browser or visual companion servers**: not supported. Continue in text.
- **Git worktrees and branches**: only through the terminal tool when it is
  available and the user approves the command. Otherwise explain the step.
- **Chat and Plan modes are read-only.** If a skill calls for edits, tests or
  commits, say so and ask the user to switch to Agent mode.

Precedence: Truss safety rules, then the user's explicit instructions (including
AGENTS.md and similar project files), then skills. A skill never grants tools,
permissions, credentials or network access.
