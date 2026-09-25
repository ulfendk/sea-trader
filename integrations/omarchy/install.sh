#!/usr/bin/env bash
# Installs the Sea Trader status widget and floating-window launcher on Omarchy.
#   Omarchy 4+ (omarchy-shell): installs the ulfendk.sea-trader shell plugin into the bar.
#   Older Omarchy (Waybar):      adds a custom/sea-trader Waybar module.
# Set SEA_TRADER_URL, SEA_TRADER_API and SEA_TRADER_TOKEN to skip the prompts.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ID="ulfendk.sea-trader"
BIN="$HOME/.local/bin"
CONF_DIR="$HOME/.config/sea-trader"
PLUGIN_DIR="$HOME/.config/omarchy/plugins/$PLUGIN_ID"
WAYBAR_CONF="${WAYBAR_CONFIG:-$HOME/.config/waybar/config.jsonc}"
WAYBAR_CSS="${WAYBAR_STYLE:-$HOME/.config/waybar/style.css}"

for dep in curl jq hyprctl notify-send; do
  command -v "$dep" >/dev/null || echo "warning: '$dep' not found (install it for full functionality)"
done

mkdir -p "$BIN" "$CONF_DIR"

if [[ ! -f "$CONF_DIR/config" ]]; then
  url="${SEA_TRADER_URL:-}"
  api="${SEA_TRADER_API:-}"
  token="${SEA_TRADER_TOKEN:-}"
  [[ -n "$url" ]] || read -rp "Game URL (e.g. https://seatrader.example.com/): " url
  if [[ -z "$api" ]]; then
    if [[ -n "${SEA_TRADER_URL:-}" ]]; then
      api="${url%/}/api"
    else
      read -rp "API URL [${url%/}/api]: " api
      api="${api:-${url%/}/api}"
    fi
  fi
  if [[ -z "$token" ]]; then
    echo "Create a token in the game: Settings → Omarchy status bar → Create status bar token"
    read -rsp "Status bar token: " token
    echo
  fi
  (
    umask 077
    cat >"$CONF_DIR/config" <<CFG
SEA_TRADER_URL=$url
SEA_TRADER_API=$api
SEA_TRADER_TOKEN=$token
CFG
  )
  echo "Wrote $CONF_DIR/config"
fi

if command -v omarchy-shell >/dev/null; then
  # Omarchy shell plugin. Plugins may not contain symlinks, so install a copy; re-run to update.
  omarchy-plugin-validate "$HERE/plugin"
  rm -rf "$PLUGIN_DIR"
  mkdir -p "$(dirname "$PLUGIN_DIR")"
  cp -r "$HERE/plugin" "$PLUGIN_DIR"
  chmod 755 "$PLUGIN_DIR"/bin/*
  ln -sf "$PLUGIN_DIR/bin/sea-trader-status" "$BIN/sea-trader-status"
  ln -sf "$PLUGIN_DIR/bin/sea-trader-open" "$BIN/sea-trader-open"
  echo "Installed plugin to $PLUGIN_DIR (scripts linked into $BIN)"

  omarchy-shell shell rescanPlugins >/dev/null
  enabled=false
  for _ in $(seq 40); do
    enabled=$(omarchy-plugin-list --json | jq -r --arg id "$PLUGIN_ID" '(.[] | select(.id == $id) | .enabled | tostring) // empty')
    [[ -n "$enabled" ]] && break
    sleep 0.05
  done
  [[ -n "$enabled" ]] || { echo "The shell did not pick up $PLUGIN_ID; try: omarchy restart shell" >&2; exit 1; }
  if [[ "$enabled" != true ]]; then
    omarchy-plugin-enable "$PLUGIN_ID" --section right
  fi
  echo "Done. Click the anchor in the bar to open Sea Trader."
  exit 0
fi

# Legacy Waybar setup.
install -m 755 "$HERE/plugin/bin/sea-trader-status" "$BIN/sea-trader-status"
install -m 755 "$HERE/plugin/bin/sea-trader-open" "$BIN/sea-trader-open"
echo "Installed scripts to $BIN"

if [[ -f "$WAYBAR_CONF" ]] && ! grep -q '"custom/sea-trader"' "$WAYBAR_CONF"; then
  cp "$WAYBAR_CONF" "$WAYBAR_CONF.bak-sea-trader"
  python3 - "$WAYBAR_CONF" "$HERE/waybar-module.jsonc" <<'PY'
import re, sys
path, module_path = sys.argv[1], sys.argv[2]
text = open(path).read()
module = open(module_path).read()
text, n = re.subn(r'("modules-right"\s*:\s*\[)', r'\1\n    "custom/sea-trader",', text, count=1)
if n == 0:
    print("Could not find modules-right; add \"custom/sea-trader\" to a module list manually.")
i = text.index("{")
text = text[: i + 1] + "\n" + module + text[i + 1 :]
open(path, "w").write(text)
PY
  echo "Added custom/sea-trader to $WAYBAR_CONF (backup: $WAYBAR_CONF.bak-sea-trader)"
fi
if [[ -f "$WAYBAR_CSS" ]] && ! grep -q "custom-sea-trader" "$WAYBAR_CSS"; then
  cat "$HERE/waybar-style.css" >>"$WAYBAR_CSS"
  echo "Appended styles to $WAYBAR_CSS"
fi

if command -v omarchy-restart-waybar >/dev/null; then
  omarchy-restart-waybar
elif pgrep -x waybar >/dev/null; then
  pkill -SIGUSR2 waybar || true
fi
echo "Done. Click the ⚓ in Waybar to open Sea Trader."
