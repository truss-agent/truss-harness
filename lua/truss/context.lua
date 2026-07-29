local M = {}

local function bounded(value, maximum)
  if #value <= maximum then
    return value, false
  end
  return value:sub(1, maximum), true
end

local function buffer_name(buffer)
  local name = vim.api.nvim_buf_get_name(buffer)
  if name == "" then
    return "[No Name]"
  end
  local relative = vim.fn.fnamemodify(name, ":.")
  return relative ~= "" and relative or name
end

local function severity_name(severity)
  local values = vim.diagnostic.severity
  if severity == values.ERROR then
    return "error"
  elseif severity == values.WARN then
    return "warning"
  elseif severity == values.INFO then
    return "info"
  end
  return "hint"
end

function M.diagnostics(options)
  options = options or {}
  local buffer = options.buffer or vim.api.nvim_get_current_buf()
  if not vim.api.nvim_buf_is_valid(buffer) or vim.bo[buffer].buftype ~= "" then
    return nil
  end
  local diagnostics = vim.diagnostic.get(buffer)
  if #diagnostics == 0 then
    return nil
  end
  table.sort(diagnostics, function(left, right)
    if left.lnum == right.lnum then
      return left.col < right.col
    end
    return left.lnum < right.lnum
  end)
  local maximum_items = options.maximum_diagnostics or 50
  local values = {}
  for index = 1, math.min(#diagnostics, maximum_items) do
    local diagnostic = diagnostics[index]
    table.insert(
      values,
      string.format(
        "%d:%d [%s] %s",
        diagnostic.lnum + 1,
        diagnostic.col + 1,
        severity_name(diagnostic.severity),
        tostring(diagnostic.message):gsub("\n", " ")
      )
    )
  end
  local clipped, truncated = bounded(
    table.concat(values, "\n"),
    options.maximum_characters or 20000
  )
  return {
    source = "diagnostics:" .. buffer_name(buffer),
    content = clipped,
    priority = 110,
    truncated = truncated or #diagnostics > maximum_items,
  }
end

function M.git_diff(options)
  options = options or {}
  local buffer = options.buffer or vim.api.nvim_get_current_buf()
  if not vim.api.nvim_buf_is_valid(buffer) or vim.bo[buffer].buftype ~= "" then
    return nil
  end
  local absolute = vim.api.nvim_buf_get_name(buffer)
  if absolute == "" then
    return nil
  end
  local root = options.workspace or vim.fn.getcwd()
  local normalized_root =
    vim.fs.normalize(vim.fn.fnamemodify(root, ":p")):gsub("/+$", "")
  local normalized_file = vim.fs.normalize(vim.fn.fnamemodify(absolute, ":p"))
  if normalized_file:sub(1, #normalized_root + 1) ~= normalized_root .. "/" then
    return nil
  end
  local relative = normalized_file:sub(#normalized_root + 2)
  local result = vim.system(
    { "git", "diff", "--no-ext-diff", "HEAD", "--", relative },
    { cwd = root, text = true }
  ):wait(options.git_timeout_ms or 2000)
  if result.code ~= 0 or not result.stdout or result.stdout == "" then
    return nil
  end
  local clipped, truncated = bounded(
    result.stdout,
    options.maximum_characters or 50000
  )
  return {
    source = "git-diff:" .. relative,
    content = clipped,
    priority = 115,
    truncated = truncated,
  }
end

function M.current_buffer(options)
  options = options or {}
  local buffer = options.buffer or vim.api.nvim_get_current_buf()
  if not vim.api.nvim_buf_is_valid(buffer) or vim.bo[buffer].buftype ~= "" then
    return nil
  end
  local content = table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
  local maximum = options.maximum_characters or 100000
  local clipped, truncated = bounded(content, maximum)
  return {
    source = "current-buffer:" .. buffer_name(buffer),
    content = clipped,
    priority = 100,
    truncated = truncated,
  }
end

function M.visual_selection(options)
  options = options or {}
  local buffer = options.buffer or vim.api.nvim_get_current_buf()
  if not vim.api.nvim_buf_is_valid(buffer) or vim.bo[buffer].buftype ~= "" then
    return nil
  end
  local first = vim.api.nvim_buf_get_mark(buffer, "<")
  local last = vim.api.nvim_buf_get_mark(buffer, ">")
  if first[1] == 0 or last[1] == 0 then
    return nil
  end
  local first_line = math.min(first[1], last[1]) - 1
  local last_line = math.max(first[1], last[1])
  local lines = vim.api.nvim_buf_get_lines(buffer, first_line, last_line, false)
  if #lines == 0 then
    return nil
  end
  if options.visual_mode ~= "V" then
    local first_column = first[1] <= last[1] and first[2] or last[2]
    local last_column = first[1] <= last[1] and last[2] or first[2]
    lines[1] = lines[1]:sub(first_column + 1)
    lines[#lines] = lines[#lines]:sub(1, last_column + 1)
  end
  local maximum = options.maximum_characters or 100000
  local clipped, truncated = bounded(table.concat(lines, "\n"), maximum)
  return {
    source = string.format(
      "visual-selection:%s:%d-%d",
      buffer_name(buffer),
      first_line + 1,
      last_line
    ),
    content = clipped,
    priority = 120,
    truncated = truncated,
  }
end

function M.for_request(options)
  options = options or {}
  local selected = options.visual and M.visual_selection(options) or nil
  local block = selected or M.current_buffer(options)
  local candidates = { block }
  if options.attach_diagnostics and not options.visual then
    table.insert(candidates, M.diagnostics(options))
  end
  if options.attach_git_diff and not options.visual then
    table.insert(candidates, M.git_diff(options))
  end
  local context = {}
  local sources = {}
  local truncated = false
  local characters = 0
  local maximum = options.maximum_characters or 100000
  for _, candidate in ipairs(candidates) do
    if candidate and characters < maximum then
      local content, clipped = bounded(
        candidate.content,
        maximum - characters
      )
      table.insert(context, {
        source = candidate.source,
        content = content,
        priority = candidate.priority,
      })
      table.insert(sources, candidate.source)
      characters = characters + #content
      truncated = truncated or candidate.truncated or clipped
    end
  end
  if #context == 0 then
    return {}, nil
  end
  return context, {
    source = table.concat(sources, ", "),
    sources = sources,
    truncated = truncated,
    characters = characters,
  }
end

return M
