local commands = vim.api.nvim_get_commands({})
for _, name in ipairs({
  "TrussChat",
  "TrussEdit",
  "TrussMcp",
  "TrussOpen",
  "TrussPlan",
  "TrussProfile",
  "TrussTestConnection",
}) do
  assert(commands[name], name .. " was not registered during normal startup")
end

local truss = require("truss")
assert(vim.g.loaded_truss_nvim == 1)
assert(truss.version.plugin == "0.2.3")
assert(truss._state.client == nil, "startup must not launch truss-cli")
assert(type(require("truss.health").check) == "function")

print("truss.nvim plain Neovim smoke: passed")
