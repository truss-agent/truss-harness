local root = vim.fn.getcwd()
vim.opt.runtimepath:prepend(root)

local Health = require("truss.health")
local failures = {}
local count = 0

local function test(name, callback)
  count = count + 1
  local ok, error_message = pcall(callback)
  if not ok then
    table.insert(failures, name .. ": " .. tostring(error_message))
  end
end

local function messages(results, level)
  local selected = {}
  for _, result in ipairs(results) do
    if not level or result.level == level then
      table.insert(selected, result.message)
    end
  end
  return table.concat(selected, "\n")
end

local function healthy_options(overrides)
  return vim.tbl_deep_extend("force", {
    config = {
      command = "truss-cli",
      attach_git_diff = true,
    },
    nvim_version = "0.10.4",
    workspace = root,
    executable = function()
      return 1
    end,
    is_directory = function()
      return true
    end,
    system = function(command)
      assert(vim.deep_equal(command, { "truss-cli", "--version" }))
      return { code = 0, stdout = "truss-cli 0.1.14\n", stderr = "" }
    end,
  }, overrides or {})
end

test("healthy installations report compatible versions", function()
  local results = Health.collect(healthy_options())
  assert(messages(results, "error") == "")
  assert(messages(results, "ok"):match("Neovim 0%.10%.4"))
  assert(messages(results, "ok"):match("truss%-cli 0%.1%.14"))
  assert(messages(results, "info"):match("TrussTestConnection"))
end)

test("old CLI versions fail without starting the service", function()
  local invocations = 0
  local results = Health.collect(healthy_options({
    system = function(command)
      invocations = invocations + 1
      assert(vim.deep_equal(command, { "truss-cli", "--version" }))
      return { code = 0, stdout = "truss-cli 0.1.13\n", stderr = "" }
    end,
  }))
  assert(invocations == 1)
  assert(messages(results, "error"):match("too old"))
end)

test("missing executables and workspaces are actionable", function()
  local results = Health.collect(healthy_options({
    executable = function(command)
      return command == "git" and 0 or 0
    end,
    is_directory = function()
      return false
    end,
    system = function()
      error("version command should not run")
    end,
  }))
  local errors = messages(results, "error")
  assert(errors:match("was not found"))
  assert(errors:match("not accessible"))
  assert(messages(results, "warn"):match("Git was not found"))
end)

test("argv-table commands retain their launcher arguments", function()
  local results = Health.collect(healthy_options({
    config = {
      command = { "node", "/opt/truss/bin.js" },
      attach_git_diff = false,
    },
    system = function(command)
      assert(vim.deep_equal(command, {
        "node",
        "/opt/truss/bin.js",
        "--version",
      }))
      return { code = 0, stdout = "truss-cli 0.1.14\n", stderr = "" }
    end,
  }))
  assert(messages(results, "error") == "")
  assert(messages(results, "info"):match("diff context is disabled"))
end)

test("semantic version comparison handles future minor releases", function()
  assert(Health._at_least("0.10.0", "0.10.0"))
  assert(Health._at_least("0.11.0-dev", "0.10.0"))
  assert(not Health._at_least("0.9.5", "0.10.0"))
end)

if #failures > 0 then
  error(string.format(
    "%d/%d truss.nvim health tests failed:\n%s",
    #failures,
    count,
    table.concat(failures, "\n")
  ))
end

print(string.format("truss.nvim health: %d tests passed", count))
