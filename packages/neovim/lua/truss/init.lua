local context = require("truss.context")
local Panel = require("truss.panel").Panel
local ProtocolClient = require("truss.protocol").Client

local M = {}

local defaults = {
  command = "truss-cli",
  arguments = {},
  mode = "chat",
  attach_current_buffer = true,
  maximum_context_characters = 100000,
  panel = {
    position = "right",
    width = 52,
  },
}

local state = {
  options = vim.deepcopy(defaults),
  panel = nil,
  client = nil,
  session_id = nil,
  context_buffer = nil,
  commands_registered = false,
}

local function notify(message, level)
  vim.notify(message, level or vim.log.levels.INFO, { title = "Truss" })
end

local function diagnostic(message)
  if not message or message == "" then
    return
  end
  state.panel:add_activity(message)
end

local function ensure_panel()
  state.panel = state.panel or Panel.new(state.options.panel)
  state.panel:open()
  return state.panel
end

local function new_client()
  local arguments = vim.deepcopy(state.options.arguments)
  local has_mode = false
  for _, argument in ipairs(arguments) do
    if argument == "--mode" then
      has_mode = true
      break
    end
  end
  if not has_mode then
    vim.list_extend(arguments, { "--mode", state.options.mode })
  end
  return ProtocolClient.new({
    command = state.options.command,
    arguments = arguments,
    workspace = vim.fn.getcwd(),
    environment = state.options.environment,
    on_diagnostic = diagnostic,
    on_exit = function()
      state.panel:set_status("Disconnected")
    end,
    on_lifecycle = function(message)
      if message.state == "started" then
        state.panel:set_status("Running")
        state.panel:start_response()
      elseif message.state == "completed" then
        state.panel:finish_response()
        state.panel:set_status("Ready")
      elseif message.state == "cancelled" then
        state.panel:finish_response()
        state.panel:set_status("Stopped")
      elseif message.state == "failed" then
        state.panel:finish_response()
        state.panel:set_status("Failed")
      end
    end,
    on_event = function(event)
      if not event then
        return
      end
      if event.type == "text_delta" then
        state.panel:append_text(event.text or "")
      elseif event.type == "progress_delta" then
        state.panel:add_activity(event.text or "Working")
      elseif event.type == "tool_call_requested" then
        state.panel:add_activity("Tool requested: " .. (event.tool or "unknown"))
      elseif event.type == "tool_completed" then
        state.panel:add_activity("Tool completed: " .. (event.tool or "unknown"))
      elseif event.type == "run_failed" then
        state.panel:add_activity("Error: " .. (event.error or "run failed"))
      elseif event.type == "run_completed" and #(event.modifiedFiles or {}) > 0 then
        state.panel:add_activity("Changed: " .. table.concat(event.modifiedFiles, ", "))
      end
    end,
  })
end

local function connect(callback)
  if state.client and state.client.initialized then
    callback(nil)
    return
  end
  state.client = state.client or new_client()
  state.panel:set_status("Connecting")
  state.client:start(function(error_message)
    if error_message then
      local message = error_message.message or tostring(error_message)
      state.panel:set_status("Connection failed")
      state.panel:add_activity(message)
      callback(error_message)
      return
    end
    state.panel:set_status("Ready")
    callback(nil)
  end)
end

local function request_context(visual, visual_mode, buffer)
  if not state.options.attach_current_buffer then
    return {}, nil
  end
  return context.for_request({
    buffer = buffer,
    visual = visual,
    visual_mode = visual_mode,
    maximum_characters = state.options.maximum_context_characters,
  })
end

local function send(prompt, visual, visual_mode, buffer)
  if type(prompt) ~= "string" or vim.trim(prompt) == "" then
    return
  end
  if state.client and state.client.active_request then
    notify("A Truss run is already active. Stop it before sending another prompt.")
    return
  end
  local blocks, metadata = request_context(visual, visual_mode, buffer)
  local panel = ensure_panel()
  panel.context = metadata
  panel:add_message("You", prompt)
  connect(function(error_message)
    if error_message then
      return
    end
    state.client:run({
      prompt = prompt,
      session_id = state.session_id,
      context = blocks,
    }, function(run_error, result)
      if run_error then
        panel:set_status("Failed")
        panel:add_activity(run_error.message or tostring(run_error))
        return
      end
      state.session_id = result and result.sessionId or state.session_id
    end)
  end)
end

function M.setup(options)
  state.options = vim.tbl_deep_extend("force", vim.deepcopy(defaults), options or {})
  if state.panel then
    state.panel.options = state.options.panel
  end
  M._register_commands()
end

function M.open()
  ensure_panel()
end

function M.chat(prompt, options)
  options = options or {}
  local current = vim.api.nvim_get_current_buf()
  if vim.bo[current].filetype ~= "truss" and vim.bo[current].buftype == "" then
    state.context_buffer = current
  end
  local source_buffer = state.context_buffer
  ensure_panel()
  if type(prompt) == "string" and vim.trim(prompt) ~= "" then
    send(prompt, options.visual, options.visual_mode, source_buffer)
    return
  end
  vim.ui.input({ prompt = "Ask Truss: " }, function(value)
    if value then
      send(value, options.visual, options.visual_mode, source_buffer)
    end
  end)
end

function M.stop()
  if not state.client or not state.client.active_request then
    notify("No Truss run is active.")
    return
  end
  state.client:cancel(function(error_message)
    if error_message then
      notify(error_message.message or tostring(error_message), vim.log.levels.ERROR)
    end
  end)
end

function M.new()
  if state.client and state.client.active_request then
    notify("Stop the active Truss run before starting a new conversation.")
    return
  end
  state.session_id = nil
  ensure_panel():clear()
end

function M.status()
  local status = state.client and state.client.initialized and "connected" or "disconnected"
  local run = state.client and state.client.active_request and "run active" or "idle"
  notify(string.format("%s; %s; mode %s", status, run, state.options.mode))
end

function M.shutdown()
  if state.client then
    state.client:shutdown()
  end
  state.client = nil
end

function M._register_commands()
  if state.commands_registered then
    return
  end
  state.commands_registered = true
  vim.api.nvim_create_user_command("TrussOpen", M.open, {
    desc = "Open the Truss panel",
  })
  vim.api.nvim_create_user_command("TrussChat", function(command)
    M.chat(command.args, {
      visual = command.range > 0,
      visual_mode = command.range > 0 and vim.fn.visualmode() or nil,
    })
  end, {
    desc = "Chat with Truss using bounded buffer context",
    nargs = "*",
    range = true,
  })
  vim.api.nvim_create_user_command("TrussStop", M.stop, {
    desc = "Stop the active Truss run",
  })
  vim.api.nvim_create_user_command("TrussNew", M.new, {
    desc = "Start a new Truss conversation",
  })
  vim.api.nvim_create_user_command("TrussStatus", M.status, {
    desc = "Show Truss service status",
  })
  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = vim.api.nvim_create_augroup("TrussNvim", { clear = true }),
    callback = M.shutdown,
  })
end

M._state = state

return M
