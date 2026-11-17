# truss.nvim

`truss.nvim` is the keyboard-first Neovim client for the provider-neutral
Truss runtime. Lua owns the split-panel experience; `truss-cli serve` owns
models, credentials, tools, MCP connections, approvals, and workspace policy.

The plugin supports Neovim 0.10+, Chat, Plan, and Edit modes, a streaming
split, host-routed approvals with write previews, plan and tool activity,
clickable changed files, provider checks, named profiles, safe MCP status,
bounded editor context, cancellation, and clean service shutdown.

## Install with lazy.nvim

Install and configure the local service first:

```sh
npm install --global @truss-harness/cli@^0.1.14
truss-cli setup
```

The `neovim-release` branch is generated from this monorepo with the plugin at
the repository root, so no monorepo runtime-path workaround is required:

```lua
{
  "truss-agent/truss-harness",
  branch = "neovim-release",
  name = "truss.nvim",
  opts = {
    arguments = { "--profile", "ollama" },
  },
  config = function(_, opts)
    require("truss").setup(opts)
    require("truss.lazy").setup()
  end,
}
```

To pin a specific plugin release, replace `branch` with a release tag:

```lua
tag = "nvim-v0.3.1"
```

Run `:checkhealth truss` once after installation. Then use
`:TrussChat Explain this buffer`, `:TrussPlan Refactor this module`, or
`:TrussEdit Add validation`. A visual command attaches only the selected
lines. Merely opening Neovim or `:TrussOpen` sends no workspace content.

## Configure

```lua
require("truss").setup({
  command = "truss-cli",
  arguments = { "--profile", "ollama" },
  attach_current_buffer = true,
  attach_diagnostics = true,
  attach_git_diff = true,
  maximum_context_characters = 100000,
  panel = {
    position = "right",
    width = 52,
  },
})
```

`require("truss.lazy").setup()` adds opt-in LazyVim-style mappings without
replacing an existing mapping:

| Mapping | Action |
| --- | --- |
| `<leader>tc` | Chat |
| `<leader>tp` | Plan |
| `<leader>te` | Edit |
| `<leader>to` | Open panel |
| `<leader>ts` | Stop |
| `<leader>tP` | Select profile |

Use `:TrussTestConnection` to safely test the active provider and
`:TrussMcp` to render credential-free MCP state. `:TrussProfile` selects a
named CLI configuration profile and restarts the reusable service without
moving keys into Lua.

`:TrussSkills` chooses how agents use skills: Automatic (agents load relevant
skills), Manual (only skills you mark always active) or Off, and turns the
bundled Superpowers pack on or off. `:TrussSkillAdd {dir}` imports a folder
with a `SKILL.md`, and `:TrussSkillRemove {id}` removes one of your skills.
Skills are shared with the CLI, TUI, Desktop and VS Code, and changes apply to
the next run.

`:checkhealth truss` verifies the local Neovim and CLI versions, executable
resolution, workspace access, and optional Git integration without starting
the service or contacting a provider. See the
[compatibility table](COMPATIBILITY.md) for supported version pairs.

## Work in the Truss split

Run `:TrussOpen` to open the split and start typing a multiline prompt.
From the transcript, press `a` to return to the composer. You can also pass
a prompt directly to `:TrussChat`, `:TrussPlan`, or
`:TrussEdit`. The composer shows the sources captured for the draft and skips dotenv files.

| Key | Action |
| --- | --- |
| `Ctrl-S` | Send the draft |
| `Ctrl-G` | Toggle the captured context |
| `Ctrl-P` | Preview the exact attached context |
| `Esc`, then `q` | Hide the composer and keep the draft |

In the transcript, move up to read earlier output and press `G` to follow
the stream again. Use `c`, `p`, and `e` to switch modes between runs. Each
mode keeps its own draft, transcript, and session while Neovim is open.
Press `n` to start a new conversation in the current mode.

When the host requests approval, press `A` in the panel or run
`:TrussApprovals`. Choose **Preview diff** for a write or replacement. Use
`q` to exit the preview, then reopen approvals to approve or deny the request.
Press `gf` or Enter over a changed file to open it, `Ctrl-C` to stop the run,
and `?` for the panel's local controls.

Use `:help truss` for commands and defaults.

## Trust boundary

Provider keys are resolved by the local service process from the normal Truss
configuration and environment. Profile and MCP responses contain safe
metadata only. Do not put API keys in Lua configuration or a project file.
The composer captures buffer content, diagnostics, and the active file's Git
diff when you begin a draft. A visual command captures the selection instead.
The content is sent when you submit the prompt. Every source is bounded in Lua and again by the service
before reaching the runtime.

## License and contributions

This project is open source under the [MIT License](LICENSE).
Contributions are welcome; see the repository's contributing guide.
