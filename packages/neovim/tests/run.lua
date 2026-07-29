local root = vim.fn.getcwd()
vim.opt.runtimepath:prepend(root)

local failures = {}
local count = 0

local function test(name, callback)
  count = count + 1
  local ok, error_message = pcall(callback)
  if not ok then
    table.insert(failures, name .. ": " .. tostring(error_message))
  end
end

local function equal(actual, expected, message)
  if not vim.deep_equal(actual, expected) then
    error((message or "values differ")
      .. "\nexpected: " .. vim.inspect(expected)
      .. "\nactual: " .. vim.inspect(actual))
  end
end

test("protocol parses split newline frames", function()
  local Protocol = require("truss.protocol")
  local received = {}
  local client = Protocol.Client.new({
    decode = vim.json.decode,
    on_event = function(event)
      table.insert(received, event)
    end,
  })
  client:feed('{"jsonrpc":"2.0","method":"runtime/event","params":{"requestId":"run","event":{"type":"text_')
  client:feed('delta","sessionId":"one","text":"hello"}}}\n')
  vim.wait(50)
  equal(received, {
    { type = "text_delta", sessionId = "one", text = "hello" },
  })
end)

test("protocol keeps multiple frames in order", function()
  local Protocol = require("truss.protocol")
  local values = {}
  local client = Protocol.Client.new({
    decode = vim.json.decode,
    on_lifecycle = function(message)
      table.insert(values, message.state)
    end,
  })
  client:feed(
    '{"jsonrpc":"2.0","method":"run/lifecycle","params":{"requestId":"run","state":"started"}}\n'
      .. '{"jsonrpc":"2.0","method":"run/lifecycle","params":{"requestId":"run","state":"completed"}}\n'
  )
  vim.wait(50)
  equal(values, { "started", "completed" })
end)

test("protocol negotiates, runs, and cancels through the process transport", function()
  local Protocol = require("truss.protocol")
  local writes = {}
  local stdout
  local killed = false
  local spawn_count = 0
  local spawned_command
  local process = {
    write = function(_, value)
      table.insert(writes, vim.json.decode(vim.trim(value)))
    end,
    kill = function()
      killed = true
    end,
  }
  local initialized = 0
  local client = Protocol.Client.new({
    spawn = function(command, options)
      spawn_count = spawn_count + 1
      spawned_command = command
      stdout = options.stdout
      return process
    end,
  })
  client:start(function(error_message)
    assert(not error_message)
    initialized = initialized + 1
  end)
  client:start(function(error_message)
    assert(not error_message)
    initialized = initialized + 1
  end)
  equal(spawn_count, 1)
  equal(spawned_command, { "truss-cli", "serve" })
  equal(writes[1].method, "initialize")
  stdout(nil, vim.json.encode({
    jsonrpc = "2.0",
    id = writes[1].id,
    result = {
      protocolVersion = Protocol.protocol_version,
      capabilities = { streaming = true, cancellation = true },
    },
  }) .. "\n")
  vim.wait(50, function()
    return initialized == 2
  end)
  equal(initialized, 2)

  local run_id = client:run({ prompt = "hello", context = {} }, function() end)
  equal(writes[2].id, run_id)
  equal(writes[2].method, "run/start")
  client:cancel(function() end)
  equal(writes[3].method, "run/cancel")
  equal(writes[3].params.targetRequestId, run_id)
  client:shutdown()
  equal(writes[4].method, "service/shutdown")
  vim.wait(300, function()
    return killed
  end)
  equal(killed, true)
end)

test("current buffer context is explicit and bounded", function()
  local Context = require("truss.context")
  local buffer = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_buf_set_name(buffer, root .. "/example.lua")
  vim.api.nvim_buf_set_lines(buffer, 0, -1, false, {
    "local value = 1",
    "return value",
  })
  local blocks, metadata = Context.for_request({
    buffer = buffer,
    maximum_characters = 10,
  })
  equal(#blocks, 1)
  equal(blocks[1].content, "local valu")
  equal(metadata.truncated, true)
  assert(blocks[1].source:match("current%-buffer:example.lua"))
  vim.api.nvim_buf_delete(buffer, { force = true })
end)

test("visual selection sends only selected lines", function()
  local Context = require("truss.context")
  local buffer = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_buf_set_name(buffer, root .. "/selection.lua")
  vim.api.nvim_buf_set_lines(buffer, 0, -1, false, {
    "first",
    "second",
    "third",
  })
  vim.api.nvim_buf_set_mark(buffer, "<", 2, 0, {})
  vim.api.nvim_buf_set_mark(buffer, ">", 3, 0, {})
  local blocks = Context.for_request({
    buffer = buffer,
    visual = true,
    visual_mode = "V",
  })
  equal(blocks[1].content, "second\nthird")
  assert(blocks[1].source:match(":2%-3$"))
  vim.api.nvim_buf_delete(buffer, { force = true })
end)

test("opening the panel does not start a service", function()
  local truss = require("truss")
  truss.setup()
  truss.open()
  equal(truss._state.client, nil)
  assert(truss._state.panel:is_open())
  truss._state.panel:close()
end)

if #failures > 0 then
  error(string.format(
    "%d/%d truss.nvim tests failed:\n%s",
    #failures,
    count,
    table.concat(failures, "\n")
  ))
end

print(string.format("truss.nvim: %d tests passed", count))
