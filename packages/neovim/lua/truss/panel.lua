local approval = require("truss.approval")
local ui = require("truss.ui")

local M = {}

local namespace = vim.api.nvim_create_namespace("truss-panel")

local Panel = {}
Panel.__index = Panel

function Panel.new(options)
  ui.ensure()
  return setmetatable({
    options = options or {},
    buffer = nil,
    window = nil,
    status = "Idle",
    messages = {},
    active_text = "",
    activity = {},
    context = nil,
    mode = "chat",
    profile = nil,
    plan = nil,
    changed_files = {},
    approvals = {},
    file_lines = {},
    show_help = false,
  }, Panel)
end

function Panel:is_open()
  return self.window and vim.api.nvim_win_is_valid(self.window)
    and vim.api.nvim_win_get_buf(self.window) == self.buffer
end

local function display_mode(mode)
  return (mode or "chat"):gsub("^%l", string.upper)
end

local function escape_statusline(text)
  return (text or ""):gsub("%%", "%%%%")
end

local function status_symbol(status)
  return (status or ""):lower() == "idle" and "○" or "●"
end

function Panel:update_window_chrome()
  if not self:is_open() then
    return
  end
  local profile = self.profile and (" · " .. self.profile) or ""
  local status_group = ui.status_highlight(self.status)
  vim.wo[self.window].winbar = string.format(
    "%%#TrussTitle# Truss %%#%s#%s %%#TrussMuted#%s · %s%s",
    status_group,
    status_symbol(self.status),
    escape_statusline(self.status),
    escape_statusline(display_mode(self.mode)),
    escape_statusline(profile)
  )
end

function Panel:set_keymaps()
  local options = { buffer = self.buffer, silent = true }
  vim.keymap.set("n", "q", function()
    self:close()
  end, vim.tbl_extend("force", options, { desc = "Close Truss panel" }))
  vim.keymap.set("n", "<Esc>", function()
    self:close()
  end, vim.tbl_extend("force", options, { desc = "Close Truss panel" }))
  vim.keymap.set("n", "<C-c>", function()
    require("truss").stop()
  end, vim.tbl_extend("force", options, { desc = "Stop Truss run" }))
  vim.keymap.set("n", "<CR>", function()
    local path = self.file_lines[vim.api.nvim_win_get_cursor(0)[1]]
    if path then
      require("truss").open_changed_file(path)
    else
      require("truss").chat()
    end
  end, vim.tbl_extend("force", options, { desc = "Ask Truss or open changed file" }))
  vim.keymap.set("n", "gf", function()
    local path = self.file_lines[vim.api.nvim_win_get_cursor(0)[1]]
    if path then
      require("truss").open_changed_file(path)
    end
  end, vim.tbl_extend("force", options, { desc = "Open changed file" }))
  vim.keymap.set("n", "G", function()
    self:follow_latest()
  end, vim.tbl_extend("force", options, { desc = "Follow latest Truss response" }))
  vim.keymap.set("n", "A", function()
    require("truss").approvals()
  end, vim.tbl_extend("force", options, { desc = "Review pending Truss approvals" }))
  vim.keymap.set("n", "a", function()
    require("truss").chat()
  end, vim.tbl_extend("force", options, { desc = "Ask Truss" }))
  vim.keymap.set("n", "c", function()
    require("truss").select_mode("chat")
  end, vim.tbl_extend("force", options, { desc = "Select Truss Chat mode" }))
  vim.keymap.set("n", "p", function()
    require("truss").select_mode("plan")
  end, vim.tbl_extend("force", options, { desc = "Select Truss Plan mode" }))
  vim.keymap.set("n", "e", function()
    require("truss").select_mode("edit")
  end, vim.tbl_extend("force", options, { desc = "Select Truss Edit mode" }))
  vim.keymap.set("n", "n", function()
    require("truss").new()
  end, vim.tbl_extend("force", options, { desc = "New Truss conversation" }))
  vim.keymap.set("n", "r", function()
    require("truss").test_connection()
  end, vim.tbl_extend("force", options, { desc = "Test Truss connection" }))
  vim.keymap.set("n", "m", function()
    require("truss").mcp_status()
  end, vim.tbl_extend("force", options, { desc = "Show Truss MCP status" }))
  vim.keymap.set("n", "P", function()
    require("truss").select_profile()
  end, vim.tbl_extend("force", options, { desc = "Select Truss profile" }))
  vim.keymap.set("n", "?", function()
    self.show_help = not self.show_help
    self:render()
  end, vim.tbl_extend("force", options, { desc = "Toggle Truss panel help" }))
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
    vim.bo[self.buffer].undolevels = -1
    vim.bo[self.buffer].filetype = "truss"
    vim.api.nvim_buf_set_name(self.buffer, "truss://panel/" .. self.buffer)
    self:set_keymaps()
  end
  local position = self.options.position or "right"
  vim.cmd(position == "left" and "topleft vsplit" or "botright vsplit")
  self.window = vim.api.nvim_get_current_win()
  vim.api.nvim_win_set_buf(self.window, self.buffer)
  vim.api.nvim_win_set_width(self.window, self.options.width or 52)
  vim.wo[self.window].wrap = true
  vim.wo[self.window].linebreak = true
  vim.wo[self.window].breakindent = true
  vim.wo[self.window].number = false
  vim.wo[self.window].relativenumber = false
  vim.wo[self.window].signcolumn = "no"
  vim.wo[self.window].cursorline = true
  vim.wo[self.window].cursorlineopt = "line"
  vim.wo[self.window].winhighlight = "Normal:TrussNormal,NormalNC:TrussNormal,EndOfBuffer:TrussEndOfBuffer,WinBar:TrussWinbar,WinBarNC:TrussWinbarNC"
  self:update_window_chrome()
  self:render()
  self:follow_latest()
end

function Panel:close()
  if self.composer then
    self.composer:close()
  end
  if self:is_open() then
    vim.api.nvim_win_close(self.window, true)
  end
  self.window = nil
end

function Panel:discard_draft()
  if self.composer then
    self.composer:close()
    if self.composer.buffer and vim.api.nvim_buf_is_valid(self.composer.buffer) then
      vim.api.nvim_buf_delete(self.composer.buffer, { force = true })
    end
    self.composer = nil
  end
end

function Panel:dispose()
  self:close()
  self:discard_draft()
  if self.buffer and vim.api.nvim_buf_is_valid(self.buffer) then
    vim.api.nvim_buf_delete(self.buffer, { force = true })
  end
  self.buffer = nil
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

function Panel:follow_latest()
  if self:is_open() then
    vim.api.nvim_win_set_cursor(self.window, { vim.api.nvim_buf_line_count(self.buffer), 0 })
  end
end

function Panel:append_text(text)
  self.active_text = self.active_text .. text
  if not self.render_pending and self:is_open() then
    self.render_pending = true
    vim.defer_fn(function()
      self.render_pending = false
      self:render()
    end, 32)
  end
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
  self.approvals = {}
  self.status = "Ready"
  self:render()
end

local function append_content(lines, highlights, content)
  local values = vim.split(content or "", "\n", { plain = true })
  for _, line in ipairs(values) do
    table.insert(lines, "  " .. line)
    table.insert(highlights, false)
  end
end

local function add_line(lines, highlights, text, highlight)
  table.insert(lines, text)
  table.insert(highlights, highlight or false)
end

function Panel:render()
  if not self.buffer or not vim.api.nvim_buf_is_valid(self.buffer) then
    return
  end

  self:update_window_chrome()
  local mode = display_mode(self.mode)
  local profile = self.profile and (" · " .. self.profile) or ""
  local width = self:is_open() and vim.api.nvim_win_get_width(self.window) or (self.options.width or 52)
  local separator = string.rep("─", math.max(1, width - 2))
  local lines = {}
  local highlights = {}
  local status_highlight = ui.status_highlight(self.status)

  add_line(lines, highlights, " Truss", "TrussTitle")
  add_line(lines, highlights, string.format(" %s %s  ·  %s%s", status_symbol(self.status), self.status, mode, profile), status_highlight)
  add_line(lines, highlights, " " .. separator, "TrussBorder")

  self.file_lines = {}
  if self.context then
    local suffix = self.context.truncated and " · truncated" or ""
    add_line(lines, highlights, string.format(" Context  %s%s", self.context.source, suffix), "TrussMuted")
    add_line(lines, highlights, "", nil)
  end

  local has_content = #self.messages > 0
    or self.active_text ~= ""
    or #self.activity > 0
    or self.plan ~= nil
    or #self.changed_files > 0

  if not has_content then
    add_line(lines, highlights, " Start here", "TrussAccent")
    add_line(lines, highlights, "  Ask about the workspace, make a plan, or request an edit.", "TrussMuted")
    add_line(lines, highlights, "", nil)
    add_line(lines, highlights, "  c  Chat       p  Plan       e  Edit", "TrussKey")
    add_line(lines, highlights, "  Enter / a  Ask       r  Test connection", "TrussKey")
  end

  for _, message in ipairs(self.messages) do
    local is_user = message.role == "You"
    add_line(lines, highlights, " " .. (is_user and "You" or "Truss"), is_user and "TrussUser" or "TrussAgent")
    append_content(lines, highlights, message.content)
    add_line(lines, highlights, "", nil)
  end

  if self.active_text ~= "" then
    add_line(lines, highlights, " Truss · thinking", "TrussAgent")
    append_content(lines, highlights, self.active_text)
    add_line(lines, highlights, "", nil)
  end

  if #self.activity > 0 then
    add_line(lines, highlights, " Activity", "TrussAccent")
    for _, activity in ipairs(self.activity) do
      add_line(lines, highlights, "  › " .. activity, "TrussMuted")
    end
    add_line(lines, highlights, "", nil)
  end

  if self.plan then
    add_line(lines, highlights, " Plan · " .. (self.plan.title or "Current plan"), "TrussPlan")
    for _, step in ipairs(self.plan.steps or {}) do
      local marker = step.status == "completed" and "✓"
        or (step.status == "in_progress" and "→" or "○")
      local highlight = step.status == "completed" and "TrussReady"
        or (step.status == "in_progress" and "TrussWorking" or "TrussMuted")
      add_line(lines, highlights, string.format("  %s %s", marker, step.content or ""), highlight)
    end
    add_line(lines, highlights, "", nil)
  end

  if #self.changed_files > 0 then
    add_line(lines, highlights, string.format(" Changed files · %d", #self.changed_files), "TrussAccent")
    for _, path in ipairs(self.changed_files) do
      add_line(lines, highlights, "  ↳ " .. path, "TrussFile")
      self.file_lines[#lines] = path
    end
    add_line(lines, highlights, "", nil)
  end

  local approvals = vim.tbl_keys(self.approvals)
  table.sort(approvals)
  if #approvals > 0 then
    add_line(lines, highlights, " Pending approvals · A to review", "TrussAccent")
    for _, id in ipairs(approvals) do
      local label = approval.label(self.approvals[id].request):gsub("[\r\n]", " ")
      add_line(lines, highlights, "  › " .. label, "TrussMuted")
    end
    add_line(lines, highlights, "", nil)
  end

  add_line(lines, highlights, " " .. separator, "TrussBorder")
  add_line(lines, highlights, " a compose · A approvals · ? help · q close", "TrussMuted")
  if self.show_help then
    add_line(lines, highlights, "", nil)
    add_line(lines, highlights, " Panel controls", "TrussAccent")
    add_line(lines, highlights, "  Enter compose/open file · G follow · Ctrl-c stop", "TrussKey")
    add_line(lines, highlights, "  m MCP status · r connection test · P select profile", "TrussKey")
  end

  local window = self:is_open() and self.window or nil
  local cursor = window and vim.api.nvim_win_get_cursor(window)
  local old_count = vim.api.nvim_buf_line_count(self.buffer)
  local follow = cursor and cursor[1] == old_count
  local view = window and vim.api.nvim_win_call(window, vim.fn.winsaveview)
  local previous = vim.api.nvim_buf_get_lines(self.buffer, 0, -1, false)
  local first = 1
  while first <= old_count and first <= #lines
    and previous[first] == lines[first]
    and self.highlights and self.highlights[first] == highlights[first] do
    first = first + 1
  end
  if first <= old_count or first <= #lines then
    local replacement = {}
    for index = first, #lines do
      table.insert(replacement, lines[index])
    end
    vim.bo[self.buffer].modifiable = true
    vim.api.nvim_buf_set_lines(self.buffer, first - 1, -1, false, replacement)
    vim.api.nvim_buf_clear_namespace(self.buffer, namespace, first - 1, -1)
    for index = first, #highlights do
      if highlights[index] then
        vim.api.nvim_buf_add_highlight(self.buffer, namespace, highlights[index], index - 1, 0, -1)
      end
    end
    vim.bo[self.buffer].modifiable = false
  end
  self.highlights = highlights
  if follow then
    self:follow_latest()
  elseif view then
    vim.api.nvim_win_call(window, function() vim.fn.winrestview(view) end)
  end
end

M.Panel = Panel

return M
