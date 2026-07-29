local M = {}

local Panel = {}
Panel.__index = Panel

function Panel.new(options)
  return setmetatable({
    options = options or {},
    buffer = nil,
    window = nil,
    status = "Disconnected",
    messages = {},
    active_text = "",
    activity = {},
    context = nil,
    mode = "chat",
    profile = nil,
    plan = nil,
    changed_files = {},
    file_lines = {},
  }, Panel)
end

function Panel:is_open()
  return self.window and vim.api.nvim_win_is_valid(self.window)
end

function Panel:open()
  if self:is_open() then
    vim.api.nvim_set_current_win(self.window)
    return
  end
  if not self.buffer or not vim.api.nvim_buf_is_valid(self.buffer) then
    self.buffer = vim.api.nvim_create_buf(false, true)
    vim.bo[self.buffer].buftype = "nofile"
    vim.bo[self.buffer].bufhidden = "hide"
    vim.bo[self.buffer].swapfile = false
    vim.bo[self.buffer].filetype = "truss"
    vim.api.nvim_buf_set_name(self.buffer, "Truss")
  end
  local position = self.options.position or "right"
  local command = position == "left" and "topleft vsplit" or "botright vsplit"
  vim.cmd(command)
  self.window = vim.api.nvim_get_current_win()
  vim.api.nvim_win_set_buf(self.window, self.buffer)
  vim.api.nvim_win_set_width(self.window, self.options.width or 52)
  vim.wo[self.window].wrap = true
  vim.wo[self.window].number = false
  vim.wo[self.window].relativenumber = false
  vim.wo[self.window].signcolumn = "no"
  vim.keymap.set("n", "q", function()
    self:close()
  end, { buffer = self.buffer, silent = true, desc = "Close Truss panel" })
  vim.keymap.set("n", "<C-c>", function()
    require("truss").stop()
  end, { buffer = self.buffer, silent = true, desc = "Stop Truss run" })
  vim.keymap.set("n", "<CR>", function()
    local path = self.file_lines[vim.api.nvim_win_get_cursor(0)[1]]
    if path then
      require("truss").open_changed_file(path)
    else
      require("truss").chat()
    end
  end, { buffer = self.buffer, silent = true, desc = "Ask Truss" })
  vim.keymap.set("n", "gf", function()
    local path = self.file_lines[vim.api.nvim_win_get_cursor(0)[1]]
    if path then
      require("truss").open_changed_file(path)
    end
  end, { buffer = self.buffer, silent = true, desc = "Open changed file" })
  self:render()
end

function Panel:close()
  if self:is_open() then
    vim.api.nvim_win_close(self.window, true)
  end
  self.window = nil
end

function Panel:set_status(status)
  self.status = status
  self:render()
end

function Panel:add_message(role, content)
  table.insert(self.messages, { role = role, content = content })
  self:render()
end

function Panel:start_response()
  self.active_text = ""
  self.activity = {}
  self.plan = nil
  self.changed_files = {}
  self:render()
end

function Panel:append_text(text)
  self.active_text = self.active_text .. text
  self:render()
end

function Panel:add_activity(text)
  table.insert(self.activity, text)
  self:render()
end

function Panel:set_mode(mode, profile)
  self.mode = mode
  self.profile = profile
  self:render()
end

function Panel:set_plan(plan)
  self.plan = plan
  self:render()
end

function Panel:set_changed_files(paths)
  self.changed_files = vim.deepcopy(paths or {})
  self:render()
end

function Panel:finish_response()
  if self.active_text ~= "" then
    table.insert(self.messages, { role = "Agent", content = self.active_text })
  end
  self.active_text = ""
  self:render()
end

function Panel:clear()
  self.messages = {}
  self.active_text = ""
  self.activity = {}
  self.context = nil
  self.plan = nil
  self.changed_files = {}
  self.status = "Ready"
  self:render()
end

local function append_content(lines, content)
  local values = vim.split(content or "", "\n", { plain = true })
  for _, line in ipairs(values) do
    table.insert(lines, line)
  end
end

function Panel:render()
  if not self.buffer or not vim.api.nvim_buf_is_valid(self.buffer) then
    return
  end
  local mode = self.mode:gsub("^%l", string.upper)
  local profile = self.profile and (" · " .. self.profile) or ""
  local lines = {
    " Truss",
    string.format(" %s · %s%s", self.status, mode, profile),
    string.rep("─", 48),
  }
  self.file_lines = {}
  if self.context then
    local suffix = self.context.truncated and " (truncated)" or ""
    table.insert(lines, string.format(" Context: %s%s", self.context.source, suffix))
    table.insert(lines, "")
  end
  for _, message in ipairs(self.messages) do
    table.insert(lines, " " .. message.role)
    append_content(lines, message.content)
    table.insert(lines, "")
  end
  if self.active_text ~= "" then
    table.insert(lines, " Agent")
    append_content(lines, self.active_text)
    table.insert(lines, "")
  end
  for _, activity in ipairs(self.activity) do
    table.insert(lines, " · " .. activity)
  end
  if self.plan then
    table.insert(lines, "")
    table.insert(lines, " Plan: " .. (self.plan.title or "Current plan"))
    for _, step in ipairs(self.plan.steps or {}) do
      local marker = step.status == "completed" and "[x]"
        or (step.status == "in_progress" and "[..]" or "[ ]")
      table.insert(lines, string.format(" %s %s", marker, step.content or ""))
    end
  end
  if #self.changed_files > 0 then
    table.insert(lines, "")
    table.insert(lines, " Changed files")
    for _, path in ipairs(self.changed_files) do
      table.insert(lines, " ↳ " .. path)
      self.file_lines[#lines] = path
    end
  end
  table.insert(lines, "")
  table.insert(lines, " <Enter> ask/open  gf file  <C-c> stop  q close")

  vim.bo[self.buffer].modifiable = true
  vim.api.nvim_buf_set_lines(self.buffer, 0, -1, false, lines)
  vim.bo[self.buffer].modifiable = false
  if self:is_open() then
    vim.api.nvim_win_set_cursor(self.window, { #lines, 0 })
  end
end

M.Panel = Panel

return M
