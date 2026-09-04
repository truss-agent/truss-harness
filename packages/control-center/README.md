# Truss Control Center preview

Control Center is a standalone Electron client for assigning and observing real
Truss runtime agents across multiple local repository folders. It does not
require the Desktop workspace app. Each folder gets its own `AgentHost` and
`AgentCoordinator`, so tool access and edit write leases remain isolated per
repository while multiple repositories may run at once.

Run `npm run control-center:dev` from the repository root. Add repository
folders, create local-provider agents, then select an agent and assign a task.
Use Plan mode for a planning agent. Edit agent tool permissions follow the
selected policy and approval prompts appear in the selected agent detail card.

The scene is a presentation of actual run state: active agents are at desks,
running Plan agents are at the table, completed runs are at the handoff area,
and gold markers mean a tool approval is waiting. It remains separate from the
Desktop Agent Room implementation.

This initial preview supports local Ollama, OpenAI-compatible, and llama.cpp
endpoints without storing credentials. Cloud account management, durable run
history, Git worktree provisioning, parent-child runtime delegation, and
structured multi-round meetings are planned follow-up runtime work. Do not
merge, package, publish, or deploy this preview without authorization.
