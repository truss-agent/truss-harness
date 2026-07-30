local lazy_path = vim.env.TRUSS_LAZY_PATH
local plugin_path = vim.env.TRUSS_PLUGIN_PATH or vim.fn.getcwd()
assert(lazy_path and vim.fn.isdirectory(lazy_path) == 1, "TRUSS_LAZY_PATH is required")
assert(vim.fn.isdirectory(plugin_path) == 1, "TRUSS_PLUGIN_PATH must be a directory")

vim.g.mapleader = " "
vim.opt.runtimepath:prepend(lazy_path)
local state_path = vim.fn.tempname()
vim.fn.mkdir(state_path, "p")

require("lazy").setup({
  {
    dir = plugin_path,
    name = "truss.nvim",
    lazy = false,
    opts = {
      attach_current_buffer = false,
      attach_diagnostics = false,
      attach_git_diff = false,
    },
    config = function(_, options)
      require("truss").setup(options)
      require("truss.lazy").setup()
    end,
  },
}, {
  root = state_path .. "/plugins",
  lockfile = state_path .. "/lazy-lock.json",
  readme = { enabled = false },
  checker = { enabled = false },
  change_detection = { enabled = false, notify = false },
  performance = { rtp = { reset = false } },
})

local truss = require("truss")
assert(vim.g.loaded_truss_nvim == 1, "lazy.nvim did not load the plugin")
assert(vim.api.nvim_get_commands({}).TrussChat, "TrussChat is missing")
assert(vim.fn.maparg("<leader>tc", "n"):match("TrussChat"), "Chat mapping is missing")
assert(vim.fn.maparg("<leader>te", "n"):match("TrussEdit"), "Edit mapping is missing")
assert(truss._state.client == nil, "lazy.nvim startup must not launch truss-cli")

print("truss.nvim lazy.nvim/LazyVim integration smoke: passed")
