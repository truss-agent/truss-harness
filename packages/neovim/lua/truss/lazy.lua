local M = {}

local defaults = {
  chat = "<leader>tc",
  plan = "<leader>tp",
  edit = "<leader>te",
  open = "<leader>to",
  stop = "<leader>ts",
  profile = "<leader>tP",
}

-- Opt-in LazyVim-style mappings. Existing mappings are never replaced.
function M.setup(mappings)
  for command, key in pairs(vim.tbl_extend("force", defaults, mappings or {})) do
    if key and vim.fn.maparg(key, "n") == "" then
      local name = command:gsub("^%l", string.upper)
      vim.keymap.set("n", key, "<cmd>Truss" .. name .. "<cr>", {
        silent = true,
        desc = "Truss " .. command,
      })
    end
  end
end

return M
