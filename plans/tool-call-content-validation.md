# Tool-call content validation

**Status:** Complete — implementation and regression coverage validated

**Tracking issue:** #233

## Goal

Prevent valid tool calls from failing solely because a model intentionally sends
an empty string for an argument such as a file's `content` or a replacement's
`newText`. Keep path, command, and search inputs strict so the runtime does not
weaken workspace safety to accommodate malformed calls.

## Current behavior

`packages/runtime/src/tools.ts` routes required string arguments through one
helper that rejects both non-strings and empty strings. That is correct for
identifiers and paths, but it incorrectly rejects legitimate values for tools
whose schema allows an empty string:

- `write_file({ path, content: "" })` cannot create or clear a file.
- `replace_in_file({ path, oldText: "", newText })` cannot initialize a blank
  file, despite the tool description promising that behavior.
- A provider can surface the raw validation text to users instead of receiving
  a concise tool-result error it can correct.

## Design

1. Replace the one-size-fits-all helper with explicit argument semantics:
   `requiredNonEmptyString`, `requiredString`, and optional variants where
   needed. Call sites declare whether blank text is valid.
2. Keep non-empty validation for paths, filenames, queries, commands, and plan
   IDs. Accept `""` only for text payloads where the tool contract explicitly
   supports it.
3. Reconcile each tool's JSON schema, description, and runtime validation so
   every declared valid input is executable.
4. Keep failed calls recoverable: malformed values return a clear tool error;
   they must not crash a run, poison a session, or expose provider internals.

## Work items

1. Add table-driven tests for accepted/rejected empty text inputs in the core
   tools and regression coverage for blank-file initialization and file
   clearing.
2. Refactor the validation helpers and update only the tools whose schemas
   permit blank text.
3. Confirm tool-call parsing in the OpenAI-compatible provider preserves an
   empty string rather than dropping or coercing it.
4. Run runtime/provider tests plus the root build and full test suite.

## Non-goals

- Treating missing arguments, `null`, arrays, or objects as strings.
- Allowing empty workspace paths, shell commands, search queries, or plan IDs.
- Changing approval policy, provider credential handling, or tool permissions.

## Acceptance criteria

- `write_file` can create and clear a file with `content: ""`.
- `replace_in_file` can initialize a blank file with `oldText: ""`.
- Empty paths and other identifier-like inputs still fail with precise errors.
- Existing tool safety tests and consumer builds remain green.

## Implementation record

- Split strict non-empty identifiers from text payloads in the core tool
  validators.
- `write_file` now accepts `content: ""`, and `replace_in_file` accepts an
  empty `oldText` when initializing a blank file.
- Paths, search queries, terminal commands, and plan IDs remain strict.
- Validated with focused runtime/agent tests, the complete test suite, root
  build, isolated docs build, and `git diff --check`.
