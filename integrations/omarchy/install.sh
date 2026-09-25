#!/usr/bin/env bash
# Installs the Sea Trader Waybar module and floating-window launcher on Omarchy (Hyprland + Waybar + mako).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$HOME/.local/bin"
CONF_DIR="$HOME/.config/sea-trader"
WAYBAR_CONF="${WAYBAR_CONFIG:-$HOME/.config/waybar/config.jsonc}"
WAYBAR_CSS="${WAYBAR_STYLE:-$HOME/.config/waybar/style.css}"
HYPR_CONF="${HYPR_CONFIG:-$HOME/.config/hypr/hyprland.conf}"

for dep in curl jq hyprctl; do
  command -v "$dep" >/dev/null || echo "warning: '$dep' not found (install it for full functionality)"
done

mkdir -p "$BIN" "$CONF_DIR"
install -m 755 "$HERE/sea-trader-status" "$BIN/sea-trader-status"
install -m 755 "$HERE/sea-trader-open" "$BIN/sea-trader-open"
echo "Installed scripts to $BIN"

if [[ ! -f "$CONF_DIR/config" ]]; then
  read -rp "Game URL (e.g. https://seatrader.example.com/): " url
  read -rp "API URL [${url%/}/api]: " api
  api="${api:-${url%/}/api}"
  echo "Create a token in the game: Settings → Omarchy status bar → Create status bar token"
  read -rsp "Status bar token: " token
  echo
  umask 077
  cat >"$CONF_DIR/config" <<CFG
SEA_TRADER_URL=$url
SEA_TRADER_API=$api
SEA_TRADER_TOKEN=$token
CFG
  echo "Wrote $CONF_DIR/config"
fi

# Hyprland
if [[ -f "$HYPR_CONF" ]]; then
  install -m 644 "$HERE/sea-trader.conf" "$(dirname "$HYPR_CONF")/sea-trader.conf"
  if ! grep -q "sea-trader.conf" "$HYPR_CONF"; then
    printf '\nsource = %s\n' "$(dirname "$HYPR_CONF")/sea-trader.conf" >>"$HYPR_CONF"
    echo "Added sea-trader.conf to $HYPR_CONF"
  fi
fi

# Waybar
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
command -v hyprctl >/dev/null && hyprctl reload >/dev/null || true
echo "Done. Click the ⚓ in Waybar to open Sea Trader."
