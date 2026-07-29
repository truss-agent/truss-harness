local M = {}

local function normalized(path)
  return vim.fs.normalize(vim.fn.fnamemodify(path, ":p")):gsub("/+$", "")
end

local function inside(root, target)
  return target == root or target:sub(1, #root + 1) == root .. "/"
end

local function resolved_candidate(path)
  local suffix = {}
  local current = path
  while current and current ~= "" do
    local real = vim.uv.fs_realpath(current)
    if real then
      if #suffix == 0 then
        return normalized(real)
      end
      return normalized(real .. "/" .. table.concat(suffix, "/"))
    end
    table.insert(suffix, 1, vim.fs.basename(current))
    local parent = vim.fs.dirname(current)
    if parent == current then
      break
    end
    current = parent
  end
  return path
end

function M.resolve(root, path)
  if type(path) ~= "string" or vim.trim(path) == "" then
    return nil, "Truss returned an empty file path."
  end
  local workspace = normalized(root)
  local absolute = path:match("^/") or path:match("^%a:[/\\]")
  local candidate = absolute and normalized(path)
    or normalized(workspace .. "/" .. path)
  local real_workspace = normalized(vim.uv.fs_realpath(workspace) or workspace)
  local real_candidate = resolved_candidate(candidate)
  if not inside(real_workspace, real_candidate) then
    return nil, "Refusing to open a path outside the current workspace."
  end
  return real_candidate
end

function M.open(root, path)
  local target, error_message = M.resolve(root, path)
  if not target then
    return nil, error_message
  end
  local buffer = vim.fn.bufnr(target)
  if buffer >= 0 then
    for _, window in ipairs(vim.fn.win_findbuf(buffer)) do
      if vim.api.nvim_win_is_valid(window) then
        vim.api.nvim_set_current_win(window)
        return target
      end
    end
  end
  if vim.bo.filetype == "truss" then
    vim.cmd("wincmd p")
  end
  vim.cmd("edit " .. vim.fn.fnameescape(target))
  return target
end

return M
