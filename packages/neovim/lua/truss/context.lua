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
  if not block then
    return {}, nil
  end
  local context = {
    {
      source = block.source,
      content = block.content,
      priority = block.priority,
    },
  }
  return context, {
    source = block.source,
    truncated = block.truncated,
    characters = #block.content,
  }
end

return M
