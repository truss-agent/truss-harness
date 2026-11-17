local Composer = {}
Composer.__index = Composer

function Composer.new()
  return setmetatable({ include_context = true }, Composer)
end

function Composer:update_header()
  if not self:is_open() then
    return
  end
  local source = self.include_context and self.metadata and self.metadata.source or "No context"
  if self.include_context and self.metadata and self.metadata.truncated then
    source = source .. " (truncated)"
  end
  vim.wo[self.window].winbar = " Ctrl-S send · " .. source:gsub("[\r\n]", " "):gsub("%%", "%%%%")
  vim.wo[self.window].statusline = " Ctrl-S Send  ·  Ctrl-G Context  ·  Ctrl-P Preview  ·  Esc Normal"
end

function Composer:is_open()
  return self.window and vim.api.nvim_win_is_valid(self.window)
    and vim.api.nvim_win_get_buf(self.window) == self.buffer
end

function Composer:close()
  if self:is_open() then
    vim.api.nvim_win_close(self.window, true)
  end
  self.window = nil
end

function Composer:preview()
  if not self.include_context or not self.metadata then
    vim.notify("This draft has no attached context.", vim.log.levels.INFO, { title = "Truss" })
    return
  end
  local lines = {}
  for _, block in ipairs(self.blocks) do
    vim.list_extend(lines, { block.source, "" })
    vim.list_extend(lines, vim.split(block.content, "\n", { plain = true }))
    table.insert(lines, "")
  end
  local buffer = vim.api.nvim_create_buf(false, true)
  vim.bo[buffer].bufhidden = "wipe"
  vim.bo[buffer].swapfile = false
  vim.api.nvim_buf_set_lines(buffer, 0, -1, false, lines)
  vim.bo[buffer].modifiable = false
  vim.cmd("botright split")
  vim.api.nvim_win_set_buf(0, buffer)
  vim.keymap.set("n", "q", function()
    vim.cmd.close()
    if self:is_open() then
      vim.api.nvim_set_current_win(self.window)
    end
  end, { buffer = buffer, desc = "Close context preview" })
end

function Composer:open(capture, send, replace_context)
  if not self.buffer or not vim.api.nvim_buf_is_valid(self.buffer) then
    self.buffer = vim.api.nvim_create_buf(false, true)
    vim.bo[self.buffer].bufhidden = "hide"
    vim.bo[self.buffer].swapfile = false
    vim.bo[self.buffer].filetype = "truss-compose"
    vim.api.nvim_buf_set_name(self.buffer, "truss://compose/" .. self.buffer)
    local function map(modes, key, action, description)
      vim.keymap.set(modes, key, action, { buffer = self.buffer, silent = true, desc = description })
    end
    map({ "n", "i" }, "<C-s>", function()
      local prompt = table.concat(vim.api.nvim_buf_get_lines(self.buffer, 0, -1, false), "\n")
      local blocks = self.include_context and self.blocks or {}
      local metadata = self.include_context and self.metadata or nil
      local tick = vim.api.nvim_buf_get_changedtick(self.buffer)
      self.send(prompt, blocks, metadata, function()
        if not vim.api.nvim_buf_is_valid(self.buffer)
          or vim.api.nvim_buf_get_changedtick(self.buffer) ~= tick then
          return
        end
        vim.api.nvim_buf_set_lines(self.buffer, 0, -1, false, { "" })
        self.blocks = nil
        self.metadata = nil
        self:close()
      end)
    end, "Send Truss prompt")
    map({ "n", "i" }, "<C-g>", function()
      self.include_context = not self.include_context
      self:update_header()
    end, "Toggle attached Truss context")
    map({ "n", "i" }, "<C-p>", function()
      vim.cmd.stopinsert()
      self:preview()
    end, "Preview attached Truss context")
    map("n", "q", function() self:close() end, "Hide Truss draft")
  end
  local lines = vim.api.nvim_buf_get_lines(self.buffer, 0, -1, false)
  if replace_context or not self.blocks or (#lines == 1 and lines[1] == "") then
    self.blocks, self.metadata = capture()
    self.include_context = true
  end
  self.send = send
  if not self:is_open() then
    vim.cmd("belowright 5split")
    self.window = vim.api.nvim_get_current_win()
    vim.api.nvim_win_set_buf(self.window, self.buffer)
    vim.wo[self.window].number = false
    vim.wo[self.window].relativenumber = false
    vim.wo[self.window].signcolumn = "no"
    vim.wo[self.window].wrap = true
    vim.wo[self.window].winfixheight = true
  else
    vim.api.nvim_set_current_win(self.window)
  end
  self:update_header()
  vim.cmd.startinsert()
end

return Composer
