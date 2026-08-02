local M = {}

local configured = false

local function link(name, target)
  vim.api.nvim_set_hl(0, name, { link = target, default = true })
end

local function channel(color, shift)
  return math.floor(color / (2 ^ shift)) % 0x100
end

local function pack(red, green, blue)
  return red * 0x10000 + green * 0x100 + blue
end

local function soften_background(background, fallback)
  if fallback and fallback ~= background then
    local weight = 0.28
    return pack(
      math.floor(channel(background, 16) * (1 - weight) + channel(fallback, 16) * weight + 0.5),
      math.floor(channel(background, 8) * (1 - weight) + channel(fallback, 8) * weight + 0.5),
      math.floor(channel(background, 0) * (1 - weight) + channel(fallback, 0) * weight + 0.5)
    )
  end
  local red = channel(background, 16)
  local green = channel(background, 8)
  local blue = channel(background, 0)
  local luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
  local shift = luminance < 128 and 0.055 or -0.055
  local function adjust(value)
    return math.max(0, math.min(255, math.floor(value + (shift > 0 and (255 - value) * shift or value * shift) + 0.5)))
  end
  return pack(adjust(red), adjust(green), adjust(blue))
end

local function setup_panel_background()
  local normal = vim.api.nvim_get_hl(0, { name = "Normal", link = false })
  local floating = vim.api.nvim_get_hl(0, { name = "NormalFloat", link = false })
  if not normal.bg then
    link("TrussNormal", "NormalFloat")
    link("TrussEndOfBuffer", "EndOfBuffer")
    link("TrussWinbar", "WinBar")
    link("TrussWinbarNC", "WinBarNC")
    return
  end
  local background = soften_background(normal.bg, floating.bg)
  vim.api.nvim_set_hl(0, "TrussNormal", {
    bg = background,
    fg = normal.fg,
  })
  vim.api.nvim_set_hl(0, "TrussEndOfBuffer", {
    bg = background,
    fg = background,
  })
  vim.api.nvim_set_hl(0, "TrussWinbar", {
    bg = background,
    fg = normal.fg,
    bold = true,
  })
  vim.api.nvim_set_hl(0, "TrussWinbarNC", {
    bg = background,
    fg = normal.fg,
  })
end

function M.setup()
  link("TrussTitle", "Title")
  link("TrussAccent", "Special")
  link("TrussMuted", "Comment")
  link("TrussBorder", "FloatBorder")
  link("TrussUser", "Identifier")
  link("TrussAgent", "Function")
  link("TrussPlan", "Special")
  link("TrussFile", "Directory")
  link("TrussKey", "Special")
  link("TrussReady", "DiagnosticOk")
  link("TrussWorking", "DiagnosticInfo")
  link("TrussWarning", "DiagnosticWarn")
  link("TrussError", "DiagnosticError")
  setup_panel_background()
end

function M.ensure()
  M.setup()
  if configured then
    return
  end
  configured = true
  vim.api.nvim_create_autocmd("ColorScheme", {
    group = vim.api.nvim_create_augroup("TrussUi", { clear = true }),
    callback = M.setup,
  })
end

function M.status_highlight(status)
  local normalized = (status or ""):lower()
  if normalized == "idle" or normalized == "not started" then
    return "TrussMuted"
  end
  if normalized:find("ready", 1, true) or normalized:find("connected", 1, true) then
    return "TrussReady"
  end
  if normalized:find("running", 1, true) or normalized:find("connecting", 1, true) then
    return "TrussWorking"
  end
  if normalized:find("failed", 1, true) or normalized:find("disconnected", 1, true) then
    return "TrussError"
  end
  return "TrussWarning"
end

return M
