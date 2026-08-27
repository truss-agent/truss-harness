# Master prompt templates

**Status:** Planned

**Tracking issue:** #235

## Goal

Let a user define a persistent master prompt that is applied to every new agent
run. The prompt must preserve literal XML, support an explicit set of dynamic
workspace/session values, and work consistently in every Truss client without
letting a prompt template access credentials, arbitrary environment variables,
or unbounded workspace data.

## Prompt composition

The shared host composes system instructions in this order:

1. Truss mode and safety instructions, which cannot be removed by a user
   prompt.
2. The rendered master prompt, if configured.
3. Per-agent profile instructions.
4. Existing bounded workspace, memory, plan, attachment, and request context.

This ordering keeps permissions and mode boundaries authoritative while still
giving a master prompt reliable, reusable instructions.

## Template language

- The template is plain text. XML such as `<project_rules>` and `</project_rules>`
  remains literal text; there is no XML parser or sanitizer that rewrites it.
- Dynamic values use only double-brace tokens: `{{workspace.name}}`.
- Unknown, malformed, or disabled tokens are left visible and reported during
  validation; they are never replaced with an empty value silently.
- Dynamic text is XML-escaped by default when inserted. A separate raw syntax,
  if ever needed, requires an explicit security review and will not ship in v1.
- Rendering has a bounded output size. Oversized templates fail before a model
  request, with a client-readable configuration error.

## v1 dynamic variables

| Token | Source | Notes |
| --- | --- | --- |
| `{{workspace.name}}` | workspace root basename | XML-escaped |
| `{{workspace.root}}` | configured workspace root | local path; XML-escaped |
| `{{repository.branch}}` | workspace repository snapshot | empty-safe when not a Git repo |
| `{{repository.changedFiles}}` | bounded repository snapshot | newline list, capped |
| `{{agent.mode}}` | selected Chat/Plan/Edit mode | stable enum |
| `{{session.id}}` | runtime session ID | opaque identifier only |
| `{{date.iso}}` | host clock | ISO-8601 UTC |

No token may expose API keys, credential references, environment variables,
file contents, full chat history, shell output, or device-pairing data.

## Storage and configuration

1. Define a shared runtime contract: template text, template version, enabled
   flag, and a typed rendering context.
2. Persist the setting at the workspace profile/configuration layer owned by
   each client. Credentials remain in the existing platform secure storage and
   are never part of the template configuration.
3. Existing `TRUSS_HARNESS_SYSTEM_PROMPT` remains a CLI-compatible input. It
   becomes an explicit master-template source rather than a parallel prompt
   system; documented precedence prevents duplicate instructions.
4. Clients expose a multiline editor, token reference, preview using sample
   non-secret data, validation feedback, reset, and an on/off toggle.

## Work items

1. Add the provider-neutral template contracts, tokenizer/parser, bounded
   renderer, and unit tests to `@truss-harness/runtime`.
2. Add master-prompt composition in `@truss-harness/agent-host` before a
   runtime creates its system message; regression-test mode safety and profile
   instruction ordering.
3. Add configuration adapters for Desktop, VS Code, CLI/TUI, Neovim, and the
   gateway-host configuration used by Mobile. The Mobile app can view/update
   host-provided settings only through its authenticated host protocol.
4. Build the UI surfaces incrementally, but retain the shared contract and
   validation behavior in every client.
5. Document XML examples, supported variables, escaping behavior, privacy
   limits, and recovery from invalid templates.

## Acceptance criteria

- A literal XML master prompt reaches the model unchanged apart from dynamic
  token substitution.
- Dynamic values are deterministic, bounded, and XML-safe.
- Unknown variables produce an actionable validation error before an agent run.
- A master prompt cannot grant tools, bypass approvals, alter mode safety, or
  obtain credentials/secrets.
- All client paths produce the same rendered prompt for identical template and
  runtime context.
