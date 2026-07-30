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

test("protocol routes approval requests and host capability methods", function()
  local Protocol = require("truss.protocol")
  local writes = {}
  local approval
  local client = Protocol.Client.new({
    on_approval = function(request)
      approval = request
    end,
  })
  client.process = {
    write = function(_, value)
      table.insert(writes, vim.json.decode(vim.trim(value)))
    end,
  }
  client.initialized = true
  client.active_request = "run-1"
  client:feed(vim.json.encode({
    jsonrpc = "2.0",
    method = "approval/requested",
    params = {
      requestId = "run-1",
      sessionId = "session-1",
      callId = "write-1",
      tool = "write_file",
      input = { path = "README.md", content = "next" },
    },
  }) .. "\n")
  vim.wait(50, function()
    return approval ~= nil
  end)
  equal(approval.callId, "write-1")

  client:approve("write-1", true)
  client:test_connection()
  client:list_profiles()
  client:mcp_status()
  equal(writes[1].method, "approval/resolve")
  equal(writes[2].method, "provider/test")
  equal(writes[3].method, "profiles/list")
  equal(writes[4].method, "mcp/status")
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

test("diagnostics are explicit bounded context", function()
  local Context = require("truss.context")
  local buffer = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_buf_set_name(buffer, root .. "/diagnostics.lua")
  vim.api.nvim_buf_set_lines(buffer, 0, -1, false, { "local value =" })
  local namespace = vim.api.nvim_create_namespace("truss-test")
  vim.diagnostic.set(namespace, buffer, {
    {
      lnum = 0,
      col = 6,
      severity = vim.diagnostic.severity.ERROR,
      message = "expected expression",
    },
  })
  local blocks, metadata = Context.for_request({
    buffer = buffer,
    maximum_characters = 1000,
    attach_diagnostics = true,
  })
  equal(#blocks, 2)
  assert(blocks[2].source:match("^diagnostics:"))
  assert(blocks[2].content:match("1:7 %[error%] expected expression"))
  equal(#metadata.sources, 2)
  vim.api.nvim_buf_delete(buffer, { force = true })
end)

test("active-file Git diff context is explicit and bounded", function()
  local Context = require("truss.context")
  local buffer = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_buf_set_name(buffer, root .. "/diff.lua")
  vim.api.nvim_buf_set_lines(buffer, 0, -1, false, { "return true" })
  local system = vim.system
  vim.system = function(command, options)
    equal(
      command,
      { "git", "diff", "--no-ext-diff", "HEAD", "--", "diff.lua" }
    )
    equal(options.cwd, root)
    return {
      wait = function()
        return { code = 0, stdout = "diff --git a/diff.lua b/diff.lua\n" }
      end,
    }
  end
  local ok, value = pcall(Context.git_diff, {
    buffer = buffer,
    workspace = root,
    maximum_characters = 12,
  })
  vim.system = system
  assert(ok, value)
  equal(value.content, "diff --git a")
  equal(value.truncated, true)
  vim.api.nvim_buf_delete(buffer, { force = true })
end)

test("workspace paths cannot escape the repository", function()
  local Workspace = require("truss.workspace")
  local inside = Workspace.resolve(root, "README.md")
  assert(inside and inside:match("/README.md$"))
  local outside, error_message = Workspace.resolve(root, "../package.json")
  equal(outside, nil)
  assert(error_message:match("outside"))
end)

test("write approvals render a native diff without changing the file", function()
  local Approval = require("truss.approval")
  local original = table.concat(vim.fn.readfile(root .. "/README.md", "b"), "\n")
  local path, error_message = Approval.preview(root, {
    callId = "preview-1",
    tool = "replace_in_file",
    input = {
      path = "README.md",
      oldText = "# truss.nvim",
      newText = "# Truss for Neovim",
    },
  })
  assert(path and not error_message)
  equal(vim.bo.filetype, "diff")
  local preview = table.concat(
    vim.api.nvim_buf_get_lines(0, 0, -1, false),
    "\n"
  )
  assert(preview:match("%-# truss.nvim"))
  assert(preview:match("%+# Truss for Neovim"))
  equal(
    table.concat(vim.fn.readfile(root .. "/README.md", "b"), "\n"),
    original
  )
  vim.cmd("close")
end)

test("LazyVim mappings are opt-in and preserve existing keys", function()
  vim.keymap.set("n", "<leader>tc", "<cmd>echo 'existing'<cr>")
  require("truss.lazy").setup({
    plan = "<leader>zx",
    edit = false,
    open = false,
    stop = false,
    profile = false,
  })
  assert(vim.fn.maparg("<leader>tc", "n"):match("existing"))
  assert(vim.fn.maparg("<leader>zx", "n"):match("TrussPlan"))
  vim.keymap.del("n", "<leader>tc")
  vim.keymap.del("n", "<leader>zx")
end)

test("panel renders plans and safe changed-file links", function()
  local Panel = require("truss.panel").Panel
  local panel = Panel.new({ width = 52 })
  panel:open()
  panel:set_mode("plan", "local")
  panel:set_plan({
    title = "Review",
    steps = {
      { content = "Inspect code", status = "completed" },
      { content = "Write fix", status = "in_progress" },
    },
  })
  panel:set_changed_files({ "README.md" })
  local lines = vim.api.nvim_buf_get_lines(panel.buffer, 0, -1, false)
  assert(table.concat(lines, "\n"):match("Plan: Review"))
  assert(table.concat(lines, "\n"):match("%[x%] Inspect code"))
  local found
  for line, path in pairs(panel.file_lines) do
    if path == "README.md" then
      found = line
    end
  end
  assert(found)
  panel:close()
  vim.api.nvim_buf_delete(panel.buffer, { force = true })
end)

test("opening the panel does not start a service", function()
  local truss = require("truss")
  truss.setup()
  truss.open()
  equal(truss._state.client, nil)
  assert(truss._state.panel:is_open())
  truss._state.panel:close()
end)

test("Plan mode launches the shared CLI service with the requested mode", function()
  local truss = require("truss")
  local writes = {}
  local stdout
  local system = vim.system
  local process = {
    write = function(_, value)
      table.insert(writes, vim.json.decode(vim.trim(value)))
    end,
    kill = function() end,
  }
  vim.system = function(command, options)
    equal(command, { "truss-cli", "serve", "--mode", "plan" })
    stdout = options.stdout
    return process
  end
  truss.setup({
    attach_current_buffer = false,
    attach_diagnostics = false,
    attach_git_diff = false,
  })
  truss.run_mode("plan", "Plan the next change")
  equal(writes[1].method, "initialize")
  stdout(nil, vim.json.encode({
    jsonrpc = "2.0",
    id = writes[1].id,
    result = {
      protocolVersion = 1,
      capabilities = {
        streaming = true,
        cancellation = true,
        providerPreflight = true,
        configurationProfiles = true,
        mcpStatus = true,
      },
    },
  }) .. "\n")
  vim.wait(50, function()
    return writes[2] ~= nil
  end)
  equal(writes[2].method, "run/start")
  equal(writes[2].params.prompt, "Plan the next change")
  local run_id = writes[2].id
  stdout(nil, vim.json.encode({
    jsonrpc = "2.0",
    method = "run/lifecycle",
    params = { requestId = run_id, state = "completed", sessionId = "session" },
  }) .. "\n")
  stdout(nil, vim.json.encode({
    jsonrpc = "2.0",
    id = run_id,
    result = { sessionId = "session" },
  }) .. "\n")
  vim.wait(50, function()
    return truss._state.client.active_request == nil
  end)
  equal(truss._state.options.mode, "plan")
  truss.shutdown()
  truss._state.panel:close()
  vim.system = system
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
