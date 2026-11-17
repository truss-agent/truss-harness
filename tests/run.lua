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

test("protocol sends skill requests", function()
  local Protocol = require("truss.protocol")
  local writes = {}
  local client = Protocol.Client.new({})
  client.process = {
    write = function(_, value)
      table.insert(writes, vim.json.decode(vim.trim(value)))
    end,
  }
  client.initialized = true
  client:list_skills()
  client:update_skill_settings("workspace", { mode = "manual" })
  client:update_skill_settings("workspace", nil)
  client:import_skill("/skills/notes")
  client:remove_skill("user:notes")
  equal(writes[1].method, "skills/list")
  equal(writes[2].method, "skills/settings")
  equal(writes[2].params, { scope = "workspace", selection = { mode = "manual" } })
  equal(writes[3].params.selection, vim.NIL)
  equal(writes[4].params, { path = "/skills/notes" })
  equal(writes[5].params, { id = "user:notes" })
end)

test("skill commands require host support and save through the service", function()
  local truss = require("truss")
  local notified = {}
  local notify = vim.notify
  vim.notify = function(message)
    table.insert(notified, message)
  end
  local writes = {}
  local selected
  local select = vim.ui.select
  vim.ui.select = function(items, _, on_choice)
    on_choice(selected and selected(items) or nil)
  end
  local client = require("truss.protocol").Client.new({})
  client.initialized = true
  client.capabilities = { skills = true }
  client.process = {
    write = function(_, value)
      local message = vim.json.decode(vim.trim(value))
      table.insert(writes, message)
      if message.method == "skills/list" then
        client:feed(vim.json.encode({
          jsonrpc = "2.0",
          id = message.id,
          result = {
            skills = {
              skills = {},
              diagnostics = {},
              selection = {
                mode = "automatic",
                superpowersEnabled = true,
                skillIds = { "superpowers:brainstorming", "user:notes" },
              },
            },
          },
        }) .. "\n")
      end
    end,
  }
  truss._state.client = client

  truss.add_skill("/skills/notes")
  equal(#writes, 0, "import must wait for skill management support")
  equal(notified[#notified], "Update truss-cli to manage skills from Neovim.")

  -- Turning the pack off also drops selected pack skills.
  selected = function(items)
    selected = nil
    return items[2]
  end
  truss.skills()
  vim.wait(100, function()
    return #writes >= 2
  end)
  equal(writes[2].method, "skills/settings")
  equal(writes[2].params, {
    scope = "user",
    selection = { superpowersEnabled = false, skillIds = { "user:notes" } },
  })
  equal(
    truss._skill_menu({ selection = { mode = "off", superpowersEnabled = false, skillIds = {} } }, "workspace")[4].label,
    "Save changes for: this workspace"
  )
  truss._state.client = nil
  vim.ui.select = select
  vim.notify = notify
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
      server = {
        name = "truss-cli",
        version = "test",
        identity = {
          runtime = {
            packageName = "@truss-harness/runtime",
            version = "0.1.11",
          },
          protocolVersions = { Protocol.protocol_version },
        },
      },
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

test("panel renders themed plans, safe changed-file links, and local controls", function()
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
  local content = table.concat(lines, "\n")
  assert(content:match("Truss"))
  assert(content:match("Plan · Review"))
  assert(content:match("✓ Inspect code"))
  assert(content:match("a compose · A approvals"))
  assert(vim.fn.maparg("a", "n", false, true).desc == "Ask Truss")
  assert(vim.fn.maparg("c", "n", false, true).desc == "Select Truss Chat mode")
  panel.show_help = true
  panel:render()
  content = table.concat(vim.api.nvim_buf_get_lines(panel.buffer, 0, -1, false), "\n")
  assert(content:match("Panel controls"))
  assert(#vim.api.nvim_buf_get_extmarks(panel.buffer, -1, 0, -1, {}) > 0)
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

test("composer keeps a multiline draft across closing and reopening", function()
  local truss = require("truss")
  truss.setup({ attach_current_buffer = false })
  local input = vim.ui.input
  vim.ui.input = function() end
  truss.chat()
  vim.ui.input = input
  local draft = vim.api.nvim_get_current_buf()
  equal(vim.bo[draft].filetype, "truss-compose")
  vim.api.nvim_buf_set_lines(draft, 0, -1, false, { "first", "second" })
  truss._state.panel:close()
  truss.chat()
  equal(vim.api.nvim_get_current_buf(), draft)
  equal(vim.api.nvim_buf_get_lines(draft, 0, -1, false), { "first", "second" })
  truss._state.panel:close()
end)

test("switching working directories preserves drafts in their workspace", function()
  local truss = require("truss")
  truss.setup({ attach_current_buffer = false })
  local previous = vim.fn.getcwd()
  truss.chat()
  local panel = truss._state.panel
  local draft = panel.composer.buffer
  vim.api.nvim_buf_set_lines(draft, 0, -1, false, { "workspace draft" })
  vim.cmd.cd(vim.fn.fnamemodify(previous, ":h"))
  truss.open()
  assert(truss._state.panel ~= panel)
  vim.cmd.cd(previous)
  truss.chat()
  equal(truss._state.panel, panel)
  equal(vim.api.nvim_get_current_buf(), draft)
  equal(vim.api.nvim_buf_get_lines(draft, 0, -1, false), { "workspace draft" })
  panel:close()
end)

test("composer snapshots source context and lets users exclude it", function()
  local truss = require("truss")
  truss.setup({ attach_diagnostics = false, attach_git_diff = false })
  local source = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_set_current_buf(source)
  vim.api.nvim_buf_set_lines(source, 0, -1, false, { "original" })
  truss.open()
  truss.chat()
  local composer = truss._state.panel.composer
  equal(composer.blocks[1].content, "original")
  vim.api.nvim_buf_set_lines(source, 0, -1, false, { "edited" })
  vim.fn.maparg("<C-p>", "n", false, true).callback()
  equal(vim.api.nvim_buf_get_lines(0, 2, 3, false), { "original" })
  vim.fn.maparg("q", "n", false, true).callback()
  equal(vim.api.nvim_get_current_win(), composer.window)
  vim.fn.maparg("<C-g>", "n", false, true).callback()
  equal(composer.include_context, false)
  assert(vim.wo[composer.window].winbar:find("No context", 1, true))
  truss._state.panel:close()
  vim.api.nvim_buf_delete(source, { force = true })
end)

test("changed files open in an editor and leave the composer visible", function()
  local truss = require("truss")
  truss.setup({ attach_current_buffer = false })
  truss.chat()
  local panel = truss._state.panel
  vim.api.nvim_set_current_win(panel.window)
  truss.open_changed_file("README.md")
  assert(vim.api.nvim_buf_get_name(0):match("/README%.md$"))
  assert(panel.composer:is_open())
  panel:close()
end)

test("streaming follows the latest response and preserves an older cursor", function()
  local panel = require("truss.panel").Panel.new()
  panel:open()
  panel:add_message("You", "hello")
  panel:follow_latest()
  panel:append_text("first")
  assert(vim.wait(200, function()
    return vim.api.nvim_win_get_cursor(panel.window)[1] == vim.api.nvim_buf_line_count(panel.buffer)
  end))
  vim.api.nvim_win_set_cursor(panel.window, { 2, 0 })
  panel:append_text("\nsecond")
  assert(vim.wait(200, function()
    return table.concat(vim.api.nvim_buf_get_lines(panel.buffer, 0, -1, false), "\n"):find("second")
  end))
  equal(vim.api.nvim_win_get_cursor(panel.window)[1], 2)
  panel:close()
end)

test("TrussOpen focuses the composer without attaching dotenv context", function()
  local truss = require("truss")
  truss.setup({ attach_git_diff = false })
  local source = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_set_current_buf(source)
  vim.api.nvim_buf_set_name(source, vim.fn.tempname() .. "/.env.local")
  vim.api.nvim_buf_set_lines(source, 0, -1, false, { "SECRET=fixture" })
  vim.cmd.TrussOpen()
  local panel = truss._state.panel
  equal(vim.bo.filetype, "truss-compose")
  equal(panel.composer.blocks, {})
  equal(panel.composer.metadata, nil)
  equal(truss._state.client, nil)
  panel:close()
  vim.api.nvim_buf_delete(source, { force = true })
end)

test("opening the panel does not start a service", function()
  local truss = require("truss")
  truss.setup()
  truss.open()
  equal(truss._state.client, nil)
  assert(truss._state.panel:is_open())
  truss._state.panel:close()
end)

test("selecting a panel mode does not open a prompt or start a service", function()
  local truss = require("truss")
  truss.setup()
  assert(truss.select_mode("edit"))
  equal(truss._state.options.mode, "edit")
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
      server = {
        name = "truss-cli",
        version = "test",
        identity = {
          runtime = {
            packageName = "@truss-harness/runtime",
            version = "0.1.11",
          },
          protocolVersions = { 1 },
        },
      },
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
  local plan_panel = truss._state.panel
  local plan_client = truss._state.client
  assert(truss.select_mode("edit"))
  assert(truss._state.panel ~= plan_panel)
  equal(truss._state.session_id, nil)
  assert(truss.select_mode("plan"))
  equal(truss._state.panel, plan_panel)
  equal(truss._state.client, plan_client)
  truss.chat()
  local draft = vim.api.nvim_get_current_buf()
  vim.api.nvim_buf_set_lines(draft, 0, -1, false, { "Continue the plan", "Keep the tests" })
  local submit = vim.fn.maparg("<C-s>", "n", false, true).callback
  local write = process.write
  process.write = function() error("test pipe closed") end
  submit()
  equal(#plan_panel.messages, 1)
  equal(vim.api.nvim_buf_get_lines(draft, 0, -1, false), { "Continue the plan", "Keep the tests" })
  process.write = write
  vim.api.nvim_set_current_win(plan_panel.composer.window)
  submit()
  equal(writes[3].params.prompt, "Continue the plan\nKeep the tests")
  equal(writes[3].params.sessionId, "session")
  assert(not plan_panel.composer:is_open())
  stdout(nil, vim.json.encode({
    jsonrpc = "2.0",
    method = "approval/requested",
    params = { requestId = writes[3].id, callId = "approve-me", tool = "write_file",
      input = { path = "README.md", content = "proposed" } },
  }) .. "\n")
  assert(vim.wait(100, function() return plan_panel.approvals["approve-me"] ~= nil end))
  equal(plan_panel.status, "Approval needed")
  local select = vim.ui.select
  vim.ui.select = function(_, _, callback) callback(nil) end
  truss.approvals()
  equal(#writes, 3)
  vim.ui.select = function(_, _, callback) callback("Deny") end
  truss.approvals()
  vim.ui.select = select
  equal(writes[4].method, "approval/resolve")
  equal(writes[4].params.approved, false)
  stdout(nil, vim.json.encode({
    jsonrpc = "2.0", id = writes[4].id, result = {},
  }) .. "\n")
  assert(vim.wait(100, function() return next(plan_panel.approvals) == nil end))
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
