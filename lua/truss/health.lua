local version = require("truss.version")

local M = {}

local function parse_semver(value)
  local major, minor, patch = tostring(value or ""):match(
    "(%d+)%.(%d+)%.(%d+)"
  )
  if not major then
    return nil
  end
  return {
    tonumber(major),
    tonumber(minor),
    tonumber(patch),
  }
end

local function at_least(actual, minimum)
  local actual_parts = parse_semver(actual)
  local minimum_parts = parse_semver(minimum)
  if not actual_parts or not minimum_parts then
    return false
  end
  for index = 1, 3 do
    if actual_parts[index] ~= minimum_parts[index] then
      return actual_parts[index] > minimum_parts[index]
    end
  end
  return true
end

local function command_argv(command)
  if type(command) == "table" then
    return vim.deepcopy(command)
  end
  return { command or "truss-cli" }
end

local function add(results, level, message)
  table.insert(results, { level = level, message = message })
end

function M.collect(options)
  options = options or {}
  local results = {}
  local configured = options.config
    or (
      package.loaded.truss
      and package.loaded.truss._state
      and package.loaded.truss._state.options
    )
    or {}
  local nvim_version = options.nvim_version
    or string.format(
      "%d.%d.%d",
      vim.version().major,
      vim.version().minor,
      vim.version().patch
    )

  if at_least(nvim_version, version.minimum_neovim) then
    add(results, "ok", string.format(
      "Neovim %s meets the %s minimum.",
      nvim_version,
      version.minimum_neovim
    ))
  else
    add(results, "error", string.format(
      "Neovim %s is unsupported; install %s or newer.",
      nvim_version,
      version.minimum_neovim
    ))
  end

  local argv = command_argv(configured.command)
  local executable = options.executable or vim.fn.executable
  if type(argv[1]) ~= "string" or argv[1] == "" or executable(argv[1]) ~= 1 then
    add(results, "error", string.format(
      "Truss CLI executable '%s' was not found. Install @truss-harness/cli or update setup().command.",
      tostring(argv[1] or "")
    ))
  else
    local version_command = vim.deepcopy(argv)
    table.insert(version_command, "--version")
    local run = options.system or function(command)
      return vim.system(command, {
        cwd = options.workspace or vim.fn.getcwd(),
        text = true,
        timeout = options.timeout_ms or 3000,
      }):wait()
    end
    local ok, result = pcall(run, version_command)
    if not ok or type(result) ~= "table" or result.code ~= 0 then
      local detail = ok and vim.trim(result.stderr or "") or tostring(result)
      add(results, "error", "Could not query truss-cli --version"
        .. (detail ~= "" and (": " .. detail) or "."))
    else
      local cli_version = tostring(result.stdout or ""):match(
        "(%d+%.%d+%.%d+[%w%.%-+]*)"
      )
      if not cli_version then
        add(results, "error", "truss-cli --version returned an unrecognized value.")
      elseif at_least(cli_version, version.minimum_cli) then
        add(results, "ok", string.format(
          "truss-cli %s meets the %s minimum.",
          cli_version,
          version.minimum_cli
        ))
      else
        add(results, "error", string.format(
          "truss-cli %s is too old; update to %s or newer.",
          cli_version,
          version.minimum_cli
        ))
      end
    end
  end

  local workspace = options.workspace or vim.fn.getcwd()
  local is_directory = options.is_directory or function(path)
    return vim.fn.isdirectory(path) == 1
  end
  if is_directory(workspace) then
    add(results, "ok", "Workspace is accessible: " .. workspace)
  else
    add(results, "error", "Workspace directory is not accessible: " .. workspace)
  end

  if configured.attach_git_diff ~= false then
    if executable("git") == 1 then
      add(results, "ok", "Git is available for active-file diff context.")
    else
      add(results, "warn", "Git was not found; active-file diff context is unavailable.")
    end
  else
    add(results, "info", "Active-file Git diff context is disabled.")
  end

  add(results, "info", string.format(
    "truss.nvim %s uses protocol v%d. Run :TrussTestConnection to test the configured provider.",
    version.plugin,
    version.protocol
  ))
  return results
end

function M.check()
  vim.health.start("truss.nvim")
  for _, result in ipairs(M.collect()) do
    vim.health[result.level](result.message)
  end
end

M._at_least = at_least

return M
