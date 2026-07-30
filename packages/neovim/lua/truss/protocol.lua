local M = {}
local version = require("truss.version")

M.protocol_version = version.protocol
M.client_version = version.plugin

local function default_encode(value)
  return vim.json.encode(value)
end

local function default_decode(value)
  return vim.json.decode(value)
end

local function schedule(callback)
  if vim.in_fast_event() then
    vim.schedule(callback)
  else
    callback()
  end
end

local Client = {}
Client.__index = Client

function Client.new(options)
  options = options or {}
  return setmetatable({
    command = options.command or "truss-cli",
    arguments = options.arguments or {},
    workspace = options.workspace or vim.fn.getcwd(),
    environment = options.environment,
    encode = options.encode or default_encode,
    decode = options.decode or default_decode,
    spawn = options.spawn or vim.system,
    on_event = options.on_event or function() end,
    on_lifecycle = options.on_lifecycle or function() end,
    on_approval = options.on_approval or function() end,
    on_diagnostic = options.on_diagnostic or function() end,
    on_exit = options.on_exit or function() end,
    pending = {},
    sequence = 0,
    stdout_buffer = "",
    initialized = false,
    capabilities = {},
    process = nil,
    active_request = nil,
    starting = false,
    start_callbacks = {},
  }, Client)
end

function Client:_next_id(prefix)
  self.sequence = self.sequence + 1
  return string.format("nvim-%s-%d", prefix, self.sequence)
end

function Client:_finish_pending(message)
  local request_id = message.id or message.requestId
  local callback = request_id and self.pending[request_id] or nil
  if not callback then
    return
  end
  self.pending[request_id] = nil
  local error_message = message.error
    and {
      message = message.error.message,
      code = message.error.data and message.error.data.code or message.error.code,
      data = message.error.data,
    }
    or (message.type == "error" and message or nil)
  callback(error_message, message)
end

function Client:_message(message)
  if type(message) ~= "table" then
    self.on_diagnostic("Truss service sent an invalid message.")
    return
  end
  if message.jsonrpc == "2.0" and message.method == "runtime/event" then
    local params = message.params or {}
    self.on_event(params.event, params.requestId)
  elseif message.jsonrpc == "2.0" and message.method == "run/lifecycle" then
    self.on_lifecycle(message.params or {})
  elseif message.jsonrpc == "2.0" and message.method == "approval/requested" then
    self.on_approval(message.params or {})
  elseif message.jsonrpc == "2.0" and (message.result or message.error) then
    self:_finish_pending(message)
  elseif message.type == "event" then
    self.on_event(message.event, message.requestId)
  elseif message.type == "lifecycle" then
    self.on_lifecycle(message)
  elseif message.type == "response" or message.type == "error" then
    self:_finish_pending(message)
  end
end

function Client:feed(chunk)
  if not chunk or chunk == "" then
    return
  end
  self.stdout_buffer = self.stdout_buffer .. chunk
  while true do
    local newline = self.stdout_buffer:find("\n", 1, true)
    if not newline then
      return
    end
    local line = self.stdout_buffer:sub(1, newline - 1)
    self.stdout_buffer = self.stdout_buffer:sub(newline + 1)
    if line ~= "" then
      local ok, message = pcall(self.decode, line)
      if ok then
        schedule(function()
          self:_message(message)
        end)
      else
        schedule(function()
          self.on_diagnostic("Could not decode Truss service output: " .. tostring(message))
        end)
      end
    end
  end
end

function Client:_write(message, callback)
  if not self.process then
    if callback then
      callback({ message = "Truss service is not running." })
    end
    return nil
  end
  local request_id = message.id or message.requestId
  if callback then
    self.pending[request_id] = callback
  end
  local encoded = self.encode(message) .. "\n"
  local ok, error_message = pcall(function()
    self.process:write(encoded)
  end)
  if not ok then
    self.pending[request_id] = nil
    if callback then
      callback({ message = tostring(error_message) })
    end
    return nil
  end
  return request_id
end

function Client:start(callback)
  if self.process and self.initialized then
    callback(nil, self.capabilities)
    return
  end
  table.insert(self.start_callbacks, callback)
  if self.starting then
    return
  end
  self.starting = true
  local function finish(error_message)
    self.starting = false
    if error_message and self.process then
      local process = self.process
      self.process = nil
      process:kill(15)
    end
    local callbacks = self.start_callbacks
    self.start_callbacks = {}
    for _, pending in ipairs(callbacks) do
      pending(error_message, error_message and nil or self.capabilities)
    end
  end
  local command = type(self.command) == "table" and vim.deepcopy(self.command)
    or { self.command }
  table.insert(command, "serve")
  vim.list_extend(command, self.arguments)
  local ok, process_or_error = pcall(self.spawn, command, {
    cwd = self.workspace,
    env = self.environment,
    stdin = true,
    text = true,
    stdout = function(error_message, data)
      if error_message then
        schedule(function()
          self.on_diagnostic(tostring(error_message))
        end)
      end
      self:feed(data)
    end,
    stderr = function(_, data)
      if data and data ~= "" then
        schedule(function()
          self.on_diagnostic(vim.trim(data))
        end)
      end
    end,
  }, function(result)
    schedule(function()
      self.process = nil
      self.initialized = false
      self.active_request = nil
      local message = string.format(
        "Truss service exited (%s).",
        tostring(result and result.code or "unknown")
      )
      for request_id, pending in pairs(self.pending) do
        self.pending[request_id] = nil
        pending({ message = message })
      end
      self.on_exit(result)
    end)
  end)
  if not ok then
    self.process = nil
    finish({ message = "Could not start Truss service: " .. tostring(process_or_error) })
    return
  end
  self.process = process_or_error
  local request_id = self:_next_id("initialize")
  self:_write({
    jsonrpc = "2.0",
    id = request_id,
    method = "initialize",
    params = {
      protocolVersions = { M.protocol_version },
      client = { name = "truss.nvim", version = M.client_version },
    },
  }, function(error_message, response)
    if error_message then
      finish(error_message)
      return
    end
    local result = response.result or {}
    if result.protocolVersion ~= M.protocol_version then
      finish({ message = "Truss service negotiated an unsupported protocol version." })
      return
    end
    self.initialized = true
    self.capabilities = result.capabilities or {}
    finish(nil)
  end)
end

function Client:request(method, params, callback)
  local handler = callback and function(error_message, response)
    callback(error_message, response and response.result or nil)
  end or nil
  return self:_write({
    jsonrpc = "2.0",
    id = self:_next_id("request"),
    method = method,
    params = params or {},
  }, handler)
end

function Client:run(input, callback)
  local request_id = self:_next_id("run")
  self.active_request = request_id
  self:_write({
    jsonrpc = "2.0",
    id = request_id,
    method = "run/start",
    params = {
      prompt = input.prompt,
      sessionId = input.session_id,
      context = input.context or {},
      attachments = input.attachments or {},
    },
  }, function(error_message, response)
    if self.active_request == request_id then
      self.active_request = nil
    end
    callback(error_message, response and response.result or nil)
  end)
  return request_id
end

function Client:cancel(callback)
  local target = self.active_request
  if not target then
    if callback then
      callback({ message = "No Truss run is active." })
    end
    return
  end
  self:_write({
    jsonrpc = "2.0",
    id = self:_next_id("cancel"),
    method = "run/cancel",
    params = { targetRequestId = target },
  }, callback)
end

function Client:approve(call_id, approved, callback)
  if not self.active_request then
    if callback then
      callback({ message = "No Truss run is active." })
    end
    return
  end
  self:request("approval/resolve", {
    callId = call_id,
    approved = approved,
  }, callback)
end

function Client:test_connection(callback)
  self:request("provider/test", {}, callback)
end

function Client:list_profiles(callback)
  self:request("profiles/list", {}, callback)
end

function Client:mcp_status(callback)
  self:request("mcp/status", {}, callback)
end

function Client:shutdown()
  if not self.process then
    return
  end
  self:_write({
    jsonrpc = "2.0",
    id = self:_next_id("shutdown"),
    method = "service/shutdown",
    params = {},
  })
  local process = self.process
  vim.defer_fn(function()
    if self.process == process then
      process:kill(15)
    end
  end, 250)
end

M.Client = Client

return M
