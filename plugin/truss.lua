if vim.g.loaded_truss_nvim == 1 then
  return
end
vim.g.loaded_truss_nvim = 1

require("truss")._register_commands()
