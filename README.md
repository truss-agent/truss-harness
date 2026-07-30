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
tag = "nvim-v0.2.1"
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

`:checkhealth truss` verifies the local Neovim and CLI versions, executable
resolution, workspace access, and optional Git integration without starting
the service or contacting a provider. See the
[compatibility table](COMPATIBILITY.md) for supported version pairs.

Edit-mode write and replace requests remain blocked until the host asks for
approval. Choose **Preview diff** to inspect the proposed text in a native
`diff` split before approving it. Changed files appear in the Truss panel;
press `gf` or Enter on one to open or focus it after a workspace-boundary
check.

Use `:help truss` for commands and defaults.

## Trust boundary

Provider keys are resolved by the local service process from the normal Truss
configuration and environment. Profile and MCP responses contain safe
metadata only. Do not put API keys in Lua configuration or a project file.
Current-buffer content with available diagnostics and the active file's Git
diff is attached only when a command starts a run. A visual command sends the
selection instead. Every source is bounded in Lua and again by the service
before reaching the runtime.
