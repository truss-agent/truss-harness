local context = require("truss.context")
local approval = require("truss.approval")
local workspace = require("truss.workspace")
local Panel = require("truss.panel").Panel
local ProtocolClient = require("truss.protocol").Client
local version = require("truss.version")

local M = {}
M.version = version

local defaults = {
  command = "truss-cli",
  arguments = {},
  mode = "chat",
  attach_current_buffer = true,
  attach_diagnostics = true,
  attach_git_diff = true,
  maximum_context_characters = 100000,
  maximum_diagnostics = 50,
  git_timeout_ms = 2000,
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
  state.panel:set_mode(state.options.mode, state.options.profile)
  state.panel:open()
  return state.panel
end

local function set_argument(arguments, flag, value)
  local result = {}
  local index = 1
  while index <= #arguments do
    if arguments[index] == flag then
      index = index + 2
    else
      table.insert(result, arguments[index])
      index = index + 1
    end
  end
  if value then
    vim.list_extend(result, { flag, value })
  end
  return result
end

local function new_client()
  local arguments = vim.deepcopy(state.options.arguments)
  arguments = set_argument(arguments, "--mode", state.options.mode)
  if state.options.profile then
    arguments = set_argument(arguments, "--profile", state.options.profile)
  end
  local client
  client = ProtocolClient.new({
    command = state.options.command,
    arguments = arguments,
    workspace = vim.fn.getcwd(),
    environment = state.options.environment,
    on_diagnostic = diagnostic,
    on_exit = function()
      if state.client == client then
        state.panel:set_status("Disconnected")
      end
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
    on_approval = function(request)
      state.panel:add_activity(
        "Approval required: " .. (request.tool or "unknown")
      )
      approval.prompt(vim.fn.getcwd(), request, function(approved)
        if
          not state.client
          or state.client.active_request ~= request.requestId
        then
          return
        end
        state.client:approve(request.callId, approved, function(error_message)
          if error_message then
            state.panel:add_activity(
              error_message.message or tostring(error_message)
            )
          else
            state.panel:add_activity(
              (approved and "Approved: " or "Denied: ")
                .. (request.tool or "unknown")
            )
          end
        end)
      end)
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
      elseif event.type == "plan_updated" then
        state.panel:set_plan(event.plan)
      elseif event.type == "run_failed" then
        state.panel:add_activity("Error: " .. (event.error or "run failed"))
      elseif event.type == "run_completed" then
        state.panel:set_changed_files(event.modifiedFiles or {})
      end
    end,
  })
  return client
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
    maximum_diagnostics = state.options.maximum_diagnostics,
    attach_diagnostics = state.options.attach_diagnostics,
    attach_git_diff = state.options.attach_git_diff,
    git_timeout_ms = state.options.git_timeout_ms,
    workspace = vim.fn.getcwd(),
  })
end

local function reset_client()
  if state.client then
    state.client:shutdown()
  end
  state.client = nil
  state.session_id = nil
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
  if not state.options.profile then
    for index, argument in ipairs(state.options.arguments) do
      if argument == "--profile" then
        state.options.profile = state.options.arguments[index + 1]
        break
      end
    end
  end
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

function M.select_mode(mode)
  if state.client and state.client.active_request then
    notify("Stop the active Truss run before changing modes.")
    return false
  end
  if state.options.mode ~= mode then
    state.options.mode = mode
    reset_client()
    local panel = ensure_panel()
    panel:clear()
    panel:set_mode(mode, state.options.profile)
  end
  return true
end

function M.run_mode(mode, prompt, options)
  if not M.select_mode(mode) then
    return
  end
  M.chat(prompt, options)
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

function M.open_changed_file(path)
  local _, error_message = workspace.open(vim.fn.getcwd(), path)
  if error_message then
    notify(error_message, vim.log.levels.ERROR)
  end
end

function M.test_connection()
  local panel = ensure_panel()
  connect(function(error_message)
    if error_message then
      return
    end
    if not state.client.capabilities.providerPreflight then
      notify("Update truss-cli to use provider connection tests from Neovim.")
      return
    end
    panel:add_activity("Testing provider connection…")
    state.client:test_connection(function(request_error, result)
      if request_error then
        panel:add_activity(request_error.message or tostring(request_error))
        return
      end
      local connection = result and result.providerConnection or {}
      panel:add_activity(
        string.format(
          "Provider %s: %s",
          connection.status or "unknown",
          connection.message or "No result returned."
        )
      )
    end)
  end)
end

function M.mcp_status()
  local panel = ensure_panel()
  connect(function(error_message)
    if error_message then
      return
    end
    if not state.client.capabilities.mcpStatus then
      notify("Update truss-cli to inspect MCP status from Neovim.")
      return
    end
    state.client:mcp_status(function(request_error, result)
      if request_error then
        panel:add_activity(request_error.message or tostring(request_error))
        return
      end
      local servers = result and result.mcpServers or {}
      if #servers == 0 then
        panel:add_activity("MCP: no servers configured")
        return
      end
      for _, server in ipairs(servers) do
        local detail = server.error
          or string.format("%d tools", server.toolCount or 0)
        panel:add_activity(
          string.format("MCP %s: %s (%s)", server.name, server.state, detail)
        )
      end
    end)
  end)
end

function M.select_profile()
  local panel = ensure_panel()
  if state.client and state.client.active_request then
    notify("Stop the active Truss run before changing profiles.")
    return
  end
  connect(function(error_message)
    if error_message then
      return
    end
    if not state.client.capabilities.configurationProfiles then
      notify("Update truss-cli to select named profiles from Neovim.")
      return
    end
    state.client:list_profiles(function(request_error, result)
      if request_error then
        panel:add_activity(request_error.message or tostring(request_error))
        return
      end
      local profiles = result and result.profiles or {}
      if #profiles == 0 then
        notify("No named Truss profiles are configured.")
        return
      end
      vim.ui.select(profiles, {
        prompt = "Truss profile",
        format_item = function(profile)
          return string.format(
            "%s%s · %s/%s",
            profile.selected and "✓ " or "",
            profile.name,
            profile.provider or "?",
            profile.model or "?"
          )
        end,
      }, function(profile)
        if not profile then
          return
        end
        state.options.profile = profile.name
        reset_client()
        panel:clear()
        panel:set_mode(state.options.mode, profile.name)
        notify("Truss profile: " .. profile.name)
      end)
    end)
  end)
end

function M.status()
  local status = state.client and state.client.initialized and "connected" or "disconnected"
  local run = state.client and state.client.active_request and "run active" or "idle"
  local profile = state.options.profile and ("; profile " .. state.options.profile)
    or ""
  notify(string.format("%s; %s; mode %s%s", status, run, state.options.mode, profile))
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
    M.run_mode("chat", command.args, {
      visual = command.range > 0,
      visual_mode = command.range > 0 and vim.fn.visualmode() or nil,
    })
  end, {
    desc = "Chat with Truss using bounded buffer context",
    nargs = "*",
    range = true,
  })
  vim.api.nvim_create_user_command("TrussPlan", function(command)
    M.run_mode("plan", command.args, {
      visual = command.range > 0,
      visual_mode = command.range > 0 and vim.fn.visualmode() or nil,
    })
  end, {
    desc = "Plan with Truss using bounded editor context",
    nargs = "*",
    range = true,
  })
  vim.api.nvim_create_user_command("TrussEdit", function(command)
    M.run_mode("edit", command.args, {
      visual = command.range > 0,
      visual_mode = command.range > 0 and vim.fn.visualmode() or nil,
    })
  end, {
    desc = "Edit with Truss using previewed tool approvals",
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
  vim.api.nvim_create_user_command("TrussTestConnection", M.test_connection, {
    desc = "Test the configured Truss provider",
  })
  vim.api.nvim_create_user_command("TrussMcp", M.mcp_status, {
    desc = "Show safe MCP server status",
  })
  vim.api.nvim_create_user_command("TrussProfile", M.select_profile, {
    desc = "Select a named Truss CLI profile",
  })
  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = vim.api.nvim_create_augroup("TrussNvim", { clear = true }),
    callback = M.shutdown,
  })
end

M._state = state

return M
