# truss.nvim

`truss.nvim` is the keyboard-first Neovim client for the provider-neutral
Truss runtime. Lua owns the split-panel experience; `truss-cli serve` owns
models, credentials, tools, MCP connections, approvals, and workspace policy.

This first vertical slice supports Neovim 0.10+, a streaming chat panel,
bounded current-buffer or visual-selection context, persistent sessions,
cancellation, and clean service shutdown.

## Install with lazy.nvim

Until the plugin moves to its standalone distribution repository, point
`lazy.nvim` at the monorepo and add `packages/neovim` to the runtime path:

```lua
{
  "truss-agent/truss-harness",
  config = function(plugin)
    vim.opt.rtp:prepend(plugin.dir .. "/packages/neovim")
    require("truss").setup()
  end,
  keys = {
    { "<leader>tc", "<cmd>TrussChat<cr>", desc = "Truss chat" },
    { "<leader>ts", "<cmd>TrussStop<cr>", desc = "Stop Truss" },
  },
}
```

Install and configure the service first:

```sh
npm install --global @truss-harness/cli
truss-cli setup
```

Then run `:TrussChat Explain this buffer`. A visual `:TrussChat` attaches only
the selected lines. Merely opening Neovim or `:TrussOpen` sends no workspace
content.

## Configure

```lua
require("truss").setup({
  command = "truss-cli",
  arguments = { "--profile", "ollama" },
  attach_current_buffer = true,
  maximum_context_characters = 100000,
  panel = {
    position = "right",
    width = 52,
  },
})
```

Use `:help truss` for commands and defaults.

## Trust boundary

Provider keys are resolved by the local service process from the normal Truss
configuration and environment. Do not put API keys in Lua configuration or a
project file. Context is bounded in Lua and again by the service before it can
reach the runtime.
