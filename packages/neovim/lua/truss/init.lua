local context = require("truss.context")
local approval = require("truss.approval")
local workspace = require("truss.workspace")
local Composer = require("truss.composer")
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
  modes = {},
  workspaces = {},
  sending = false,
  commands_registered = false,
}

local function notify(message, level)
  vim.notify(message, level or vim.log.levels.INFO, { title = "Truss" })
end

local function ensure_panel()
  state.panel = state.panel or Panel.new(state.options.panel)
  state.panel.root = state.panel.root or vim.fn.getcwd()
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
  local panel = state.panel
  local root = panel.root
  local client
  client = ProtocolClient.new({
    command = state.options.command,
    arguments = arguments,
    workspace = root,
    environment = state.options.environment,
    on_diagnostic = function(message)
      if message and message ~= "" then
        panel:add_activity(message)
      end
    end,
    on_exit = function()
      local tracked = state.client == client
      if tracked then
        state.session_id = nil
      end
      local function clear_session(saved)
        if saved.client == client then
          saved.session_id = nil
          tracked = true
        end
      end
      for _, mode in pairs(state.modes) do
        clear_session(mode)
      end
      for _, saved in pairs(state.workspaces) do
        clear_session(saved)
        for _, mode in pairs(saved.modes) do
          clear_session(mode)
        end
      end
      if tracked then
        panel.approvals = {}
        panel:finish_response()
        panel:set_status("Disconnected")
      end
    end,
    on_lifecycle = function(message)
      if client.active_request ~= message.requestId then
        return
      end
      if message.state == "started" then
        panel:set_status("Running")
        panel:start_response()
      else
        panel.approvals = {}
      end
      if message.state == "completed" then
        panel:finish_response()
        panel:set_status("Ready")
      elseif message.state == "cancelled" then
        panel:finish_response()
        panel:set_status("Stopped")
      elseif message.state == "failed" then
        panel:finish_response()
        panel:set_status("Failed")
      end
    end,
    on_approval = function(request)
      if type(request.callId) ~= "string" or client.active_request ~= request.requestId then
        return
      end
      panel.approvals[request.callId] = {
        request = request,
        resolve = function(approved, done)
          if client.active_request ~= request.requestId then
            done({ message = "This approval has expired." })
            return
          end
          client:approve(request.callId, approved, done)
        end,
      }
      panel:set_status("Approval needed")
      notify("Truss needs approval. Press A in the panel or run :TrussApprovals.")
    end,
    on_event = function(event)
      if not event then
        return
      end
      if event.type == "text_delta" then
        panel:append_text(event.text or "")
      elseif event.type == "progress_delta" then
        panel:add_activity(event.text or "Working")
      elseif event.type == "tool_call_requested" then
        panel:add_activity("Tool requested: " .. (event.tool or "unknown"))
      elseif event.type == "tool_completed" then
        panel:add_activity("Tool completed: " .. (event.tool or "unknown"))
      elseif event.type == "plan_updated" then
        panel:set_plan(event.plan)
      elseif event.type == "run_failed" then
        panel:add_activity("Error: " .. (event.error or "run failed"))
      elseif event.type == "run_completed" then
        panel:set_changed_files(event.modifiedFiles or {})
      end
    end,
  })
  return client
end

local function connect(callback)
  local panel = state.panel
  if state.client and state.client.initialized then
    callback(nil)
    return
  end
  state.client = state.client or new_client()
  state.panel:set_status("Connecting")
  local client = state.client
  client:start(function(error_message)
    if client ~= state.client or panel ~= state.panel then
      return
    end
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
    workspace = state.panel.root,
  })
end

local function reset_client()
  local client = state.client
  state.client = nil
  state.sending = false
  if client then
    client:shutdown()
  end
  local function dispose(saved)
    if saved.client then
      saved.client:shutdown()
    end
    saved.panel:dispose()
  end
  for _, mode in pairs(state.modes) do
    dispose(mode)
  end
  for _, saved in pairs(state.workspaces) do
    dispose(saved)
    for _, mode in pairs(saved.modes) do
      dispose(mode)
    end
  end
  state.modes = {}
  state.workspaces = {}
  state.session_id = nil
end

local function busy()
  return state.sending or (state.client and state.client.active_request)
end

local function send(prompt, blocks, metadata, on_start)
  if type(prompt) ~= "string" or vim.trim(prompt) == "" then
    return false
  end
  if busy() then
    notify("A Truss run is already active. Stop it before sending another prompt.")
    return false
  end
  vim.cmd.stopinsert()
  local panel = ensure_panel()
  state.sending = true
  connect(function(error_message)
    state.sending = false
    if error_message then
      return
    end
    local client = state.client
    local _, written = client:run({
      prompt = prompt,
      session_id = state.session_id,
      context = blocks,
    }, function(run_error, result)
      if client ~= state.client then
        return
      end
      if run_error then
        panel.approvals = {}
        panel:set_status("Failed")
        panel:add_activity(run_error.message or tostring(run_error))
        return
      end
      state.session_id = result and result.sessionId or state.session_id
    end)
    if written then
      panel.context = metadata
      panel:add_message("You", prompt)
      panel:follow_latest()
      if on_start then
        on_start()
      end
    end
  end)
  return true
end

function M.setup(options)
  if state.panel then
    reset_client()
    state.panel:dispose()
    state.panel = nil
    state.context_buffer = nil
  end
  state.options = vim.tbl_deep_extend("force", vim.deepcopy(defaults), options or {})
  if not state.options.profile then
    for index, argument in ipairs(state.options.arguments) do
      if argument == "--profile" then
        state.options.profile = state.options.arguments[index + 1]
        break
      end
    end
  end
  M._register_commands()
end

local function sync_workspace()
  local root = vim.fn.getcwd()
  if state.panel and state.panel.root ~= root then
    if busy() then
      notify("Stop the active Truss run before switching workspaces.")
      return false
    end
    state.panel:close()
    state.workspaces[state.panel.root] = {
      panel = state.panel,
      client = state.client,
      session_id = state.session_id,
      context_buffer = state.context_buffer,
      modes = state.modes,
      mode = state.options.mode,
    }
    local saved = state.workspaces[root] or {}
    state.workspaces[root] = nil
    state.panel, state.client, state.session_id = saved.panel, saved.client, saved.session_id
    state.context_buffer = saved.context_buffer
    state.modes = saved.modes or {}
    state.options.mode = saved.mode or state.options.mode
  end
  return true
end

local function remember_buffer()
  local current = vim.api.nvim_get_current_buf()
  if vim.bo[current].filetype ~= "truss" and vim.bo[current].buftype == "" then
    state.context_buffer = current
  end
end

function M.open()
  if sync_workspace() then
    remember_buffer()
    ensure_panel()
  end
end

function M.chat(prompt, options)
  if not sync_workspace() then
    return
  end
  options = options or {}
  remember_buffer()
  local source_buffer = state.context_buffer
  local panel = ensure_panel()
  local function capture()
    return request_context(options.visual, options.visual_mode, source_buffer)
  end
  if type(prompt) == "string" and vim.trim(prompt) ~= "" then
    if busy() then
      notify("A Truss run is already active. Stop it before sending another prompt.")
      return
    end
    send(prompt, capture())
    return
  end
  panel.composer = panel.composer or Composer.new()
  panel.composer:open(capture, function(value, blocks, metadata, on_start)
    if vim.fn.getcwd() ~= panel.root then
      notify("Reopen Truss in the current workspace before sending.")
      return false
    end
    return send(value, blocks, metadata, on_start)
  end, options.visual)
end

function M.select_mode(mode)
  if not sync_workspace() then
    return false
  end
  if busy() then
    notify("Stop the active Truss run before changing modes.")
    return false
  end
  if state.options.mode ~= mode then
    if state.panel then
      state.panel:close()
      state.modes[state.options.mode] = {
        panel = state.panel,
        client = state.client,
        session_id = state.session_id,
      }
    end
    local saved = state.modes[mode] or {}
    state.modes[mode] = nil
    state.options.mode = mode
    state.panel, state.client, state.session_id = saved.panel, saved.client, saved.session_id
    ensure_panel()
  end
  return true
end

function M.run_mode(mode, prompt, options)
  if not sync_workspace() then
    return
  end
  remember_buffer()
  if M.select_mode(mode) then
    M.chat(prompt, options)
  end
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
  if not sync_workspace() then
    return
  end
  if busy() then
    notify("Stop the active Truss run before starting a new conversation.")
    return
  end
  state.session_id = nil
  local panel = ensure_panel()
  panel:discard_draft()
  panel:clear()
end

function M.open_changed_file(path)
  local _, error_message = workspace.open(state.panel and state.panel.root or vim.fn.getcwd(), path)
  if error_message then
    notify(error_message, vim.log.levels.ERROR)
  end
end

function M.test_connection()
  if not sync_workspace() then
    return
  end
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
  if not sync_workspace() then
    return
  end
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
  if not sync_workspace() then
    return
  end
  local panel = ensure_panel()
  if busy() then
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
        if not profile or busy() or panel ~= state.panel then
          return
        end
        state.options.profile = profile.name
        reset_client()
        panel:discard_draft()
        panel:clear()
        panel:set_mode(state.options.mode, profile.name)
        notify("Truss profile: " .. profile.name)
      end)
    end)
  end)
end

local skill_mode_order = { "automatic", "manual", "off" }

local function skill_client(manage, callback)
  if not sync_workspace() then
    return
  end
  local panel = ensure_panel()
  connect(function(error_message)
    if error_message then
      return
    end
    local capabilities = state.client.capabilities
    if not capabilities.skills or (manage and not capabilities.skillManagement) then
      notify("Update truss-cli to manage skills from Neovim.")
      return
    end
    callback(panel)
  end)
end

local function skill_result(panel, callback)
  return function(request_error, result)
    if request_error then
      panel:add_activity(request_error.message or tostring(request_error))
      return
    end
    if callback then
      callback(result or {})
    end
  end
end

local function without_pack_skills(skill_ids)
  local kept = {}
  for _, id in ipairs(skill_ids or {}) do
    if not vim.startswith(id, "superpowers:") then
      table.insert(kept, id)
    end
  end
  return kept
end

local function skill_selectable(skills, skill)
  return skill.trusted
    and (skills.selection.superpowersEnabled or not vim.startswith(skill.id, "superpowers:"))
end

--- Skill menu entries for one listed state, exposed for tests.
function M._skill_menu(skills, scope)
  local selection = skills.selection
  return {
    { action = "mode", label = "Mode: " .. selection.mode },
    {
      action = "superpowers",
      label = "Superpowers pack: " .. (selection.superpowersEnabled and "on" or "off"),
    },
    {
      action = "select",
      label = string.format("Always-active skills (%d)", #(selection.skillIds or {})),
    },
    {
      action = "scope",
      label = "Save changes for: " .. (scope == "user" and "all workspaces" or "this workspace"),
    },
  }
end

function M.skills(scope)
  scope = scope or "user"
  skill_client(false, function(panel)
    state.client:list_skills(skill_result(panel, function(result)
      local skills = result.skills
      if not skills then
        return
      end
      local save = function(selection)
        state.client:update_skill_settings(scope, selection, skill_result(panel, function()
          M.skills(scope)
        end))
      end
      vim.ui.select(M._skill_menu(skills, scope), {
        prompt = "Truss skills (changes apply to the next run)",
        format_item = function(item)
          return item.label
        end,
      }, function(item)
        if not item then
          return
        end
        if item.action == "scope" then
          M.skills(scope == "user" and "workspace" or "user")
        elseif item.action == "mode" then
          vim.ui.select(skill_mode_order, { prompt = "Skill mode" }, function(mode)
            if mode then
              save({ mode = mode })
            end
          end)
        elseif item.action == "superpowers" then
          if skills.selection.superpowersEnabled then
            save({
              superpowersEnabled = false,
              skillIds = without_pack_skills(skills.selection.skillIds),
            })
          else
            save({ superpowersEnabled = true })
          end
        else
          local selected = {}
          for _, id in ipairs(skills.selection.skillIds or {}) do
            selected[id] = true
          end
          local choices = {}
          for _, skill in ipairs(skills.skills or {}) do
            if selected[skill.id] or skill_selectable(skills, skill) then
              table.insert(choices, skill)
            end
          end
          vim.ui.select(choices, {
            prompt = "Toggle an always-active skill",
            format_item = function(skill)
              return string.format(
                "[%s] %s  %s",
                selected[skill.id] and "x" or " ",
                skill.id,
                skill.description or ""
              )
            end,
          }, function(skill)
            if not skill then
              return
            end
            local next_ids = {}
            for _, id in ipairs(skills.selection.skillIds or {}) do
              if id ~= skill.id then
                table.insert(next_ids, id)
              end
            end
            if not selected[skill.id] then
              table.insert(next_ids, skill.id)
            end
            save({ skillIds = next_ids })
          end)
        end
      end)
    end))
  end)
end

function M.add_skill(path)
  if not path or path == "" then
    notify("Give a skill folder that contains SKILL.md.", vim.log.levels.ERROR)
    return
  end
  local directory = vim.fn.fnamemodify(vim.fn.expand(path), ":p"):gsub("[/\\]$", "")
  skill_client(true, function(panel)
    state.client:import_skill(directory, skill_result(panel, function(result)
      local skill = result.skill or {}
      notify("Imported skill " .. (skill.id or directory))
    end))
  end)
end

function M.remove_skill(id)
  if not id or id == "" then
    notify("Give the skill ID to remove, such as user:notes.", vim.log.levels.ERROR)
    return
  end
  skill_client(true, function(panel)
    state.client:remove_skill(id, skill_result(panel, function()
      notify("Removed skill " .. id)
    end))
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
  reset_client()
end

function M.approvals()
  local panel = state.panel
  if not panel or vim.tbl_isempty(panel.approvals) then
    notify("No pending Truss approvals.")
    return
  end
  local function review(id)
    local entry = panel.approvals[id]
    if not entry or entry.resolving then
      return
    end
    approval.prompt(panel.root, entry.request, function(approved)
      if approved == nil or panel.approvals[id] ~= entry or entry.resolving then
        return
      end
      entry.resolving = true
      entry.resolve(approved, function(error_message)
        entry.resolving = false
        if error_message then
          panel:add_activity(error_message.message or tostring(error_message))
        elseif panel.approvals[id] == entry then
          panel.approvals[id] = nil
          panel:set_status(next(panel.approvals) and "Approval needed" or "Running")
          panel:add_activity((approved and "Approved: " or "Denied: ") .. approval.label(entry.request))
        end
      end)
    end)
  end
  local ids = vim.tbl_keys(panel.approvals)
  table.sort(ids)
  if #ids == 1 then
    review(ids[1])
  else
    vim.ui.select(ids, {
      prompt = "Pending Truss approvals",
      format_item = function(id)
        local entry = panel.approvals[id]
        return entry and approval.label(entry.request) or "Expired"
      end,
    }, function(id)
      if id then review(id) end
    end)
  end
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
  vim.api.nvim_create_user_command("TrussApprovals", M.approvals, { desc = "Review pending Truss approvals" })
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
  vim.api.nvim_create_user_command("TrussSkills", function()
    M.skills()
  end, {
    desc = "Choose Truss skill mode, Superpowers and always-active skills",
  })
  vim.api.nvim_create_user_command("TrussSkillAdd", function(command)
    M.add_skill(command.args)
  end, {
    desc = "Import a skill folder into your Truss skills",
    nargs = 1,
    complete = "dir",
  })
  vim.api.nvim_create_user_command("TrussSkillRemove", function(command)
    M.remove_skill(command.args)
  end, {
    desc = "Remove one of your imported Truss skills",
    nargs = 1,
  })
  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = vim.api.nvim_create_augroup("TrussNvim", { clear = true }),
    callback = M.shutdown,
  })
end

M._state = state

return M
