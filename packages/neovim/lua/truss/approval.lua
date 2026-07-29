local workspace = require("truss.workspace")

local M = {}

local function read_file(path)
  local ok, lines = pcall(vim.fn.readfile, path, "b")
  return ok and table.concat(lines, "\n") or ""
end

local function proposed_content(tool, input, current)
  if tool == "write_file" and type(input.content) == "string" then
    return input.content
  end
  if
    tool == "replace_in_file"
    and type(input.oldText) == "string"
    and type(input.newText) == "string"
  then
    local first, last = current:find(input.oldText, 1, true)
    if first then
      return current:sub(1, first - 1) .. input.newText .. current:sub(last + 1)
    end
  end
  return nil
end

function M.preview(root, request)
  local input = request.input or {}
  local path, error_message = workspace.resolve(root, input.path)
  if not path then
    return nil, error_message
  end
  local before = read_file(path)
  local after = proposed_content(request.tool, input, before)
  if not after then
    return nil, "A diff preview is unavailable for this tool request."
  end
  local diff = vim.diff(before, after, {
    result_type = "unified",
    ctxlen = 3,
  })
  local buffer = vim.api.nvim_create_buf(false, true)
  vim.bo[buffer].buftype = "nofile"
  vim.bo[buffer].bufhidden = "wipe"
  vim.bo[buffer].swapfile = false
  vim.bo[buffer].filetype = "diff"
  vim.api.nvim_buf_set_name(
    buffer,
    string.format(
      "Truss preview: %s [%s]",
      input.path,
      request.callId or tostring(buffer)
    )
  )
  vim.api.nvim_buf_set_lines(
    buffer,
    0,
    -1,
    false,
    vim.split(diff ~= "" and diff or "No textual changes.", "\n", {
      plain = true,
    })
  )
  vim.bo[buffer].modifiable = false
  vim.cmd("botright split")
  vim.api.nvim_win_set_buf(0, buffer)
  vim.api.nvim_win_set_height(0, math.min(18, math.max(6, vim.o.lines / 3)))
  vim.keymap.set("n", "q", "<cmd>close<cr>", {
    buffer = buffer,
    silent = true,
    desc = "Close Truss diff preview",
  })
  return path
end

local function label(request)
  local input = request.input or {}
  local target = type(input.path) == "string" and (" " .. input.path) or ""
  if target == "" and type(input.command) == "string" then
    local command = input.command:gsub("\n", " ")
    target = " `" .. command:sub(1, 100) .. (#command > 100 and "…" or "") .. "`"
  end
  return string.format("%s%s", request.tool or "tool", target)
end

function M.prompt(root, request, callback)
  local choices = { "Approve", "Deny" }
  local input = request.input or {}
  if
    type(input.path) == "string"
    and (request.tool == "write_file" or request.tool == "replace_in_file")
  then
    table.insert(choices, 2, "Preview diff")
  end
  vim.ui.select(choices, {
    prompt = "Truss requests " .. label(request),
  }, function(choice)
    if choice == "Preview diff" then
      local _, error_message = M.preview(root, request)
      if error_message then
        vim.notify(error_message, vim.log.levels.WARN, { title = "Truss" })
      end
      vim.ui.select({ "Approve", "Deny" }, {
        prompt = "Apply " .. label(request) .. "?",
      }, function(decision)
        callback(decision == "Approve")
      end)
      return
    end
    callback(choice == "Approve")
  end)
end

return M
