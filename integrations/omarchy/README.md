# Sea Trader for Omarchy

A bar widget that shows how many of your ships need orders, sends desktop notifications when a decision
comes up, and opens the game as a floating window on a Hyprland special workspace.

```
⚓ 3     ← 3 ships need you (accent colour); red and blinking when a decision has a deadline
```

- **Click:** show or hide the floating game window.
- **Right-click:** refresh now.
- **Hover:** list of pending actions per game.
- **Notification "Open game" button:** opens the window.

On Omarchy 4 and later this is an Omarchy shell plugin (`ulfendk.sea-trader`). On older, Waybar-based
Omarchy releases the installer adds a Waybar module instead.

## Install

1. In the game, go to **Settings → Omarchy status bar → Create status bar token** and copy the token.
2. Run:

   ```sh
   git clone https://github.com/ulfendk/sea-trader.git
   ./sea-trader/integrations/omarchy/install.sh
   ```

   The installer:
   - writes `~/.config/sea-trader/config` (URL, API URL, token) if it does not exist yet
   - **Omarchy 4+:** copies [`plugin/`](plugin) to `~/.config/omarchy/plugins/ulfendk.sea-trader`, links
     `sea-trader-status` and `sea-trader-open` into `~/.local/bin`, and enables the widget in the right
     section of the bar
   - **Waybar:** copies the scripts to `~/.local/bin`, adds `custom/sea-trader` to the start of
     `modules-right` in `~/.config/waybar/config.jsonc` (backup kept as `config.jsonc.bak-sea-trader`),
     appends styles to `style.css` and restarts Waybar

   To skip the prompts, set `SEA_TRADER_URL`, `SEA_TRADER_TOKEN` and optionally `SEA_TRADER_API`
   (defaults to `<url>/api`) in the environment.

   Re-run the installer after `git pull` to update the plugin. Move the widget with
   `omarchy bar move ulfendk.sea-trader --section left`, and remove it with
   `omarchy plugin remove ulfendk.sea-trader`.

   Needs `curl`, `jq`, `hyprctl`, `notify-send` and Chromium or another Chromium-based browser. All of these
   ship with Omarchy.

## Configuration

`~/.config/sea-trader/config`:

```sh
SEA_TRADER_URL=https://seatrader.example.com/
SEA_TRADER_API=https://seatrader.example.com/api
SEA_TRADER_TOKEN=<token from Settings>
```

The token is kept here rather than in `~/.config/omarchy/shell.json`, so it stays out of dotfile repos. The
widget's refresh interval (default 60 seconds) can be changed in the bar settings or with
`omarchy bar set`.

## How the floating window works

On first click, `sea-trader-open` launches the game with `chromium --app=<url>` using its own profile
(`~/.local/share/sea-trader/browser`) with the exec rules
`[workspace special:seatrader silent; float; size 1280 840; center]`. Later clicks toggle the
`seatrader` special workspace, so the game slides in and out like a scratchpad and keeps running in the
background. You sign in once in that window; it counts as its own device under Settings.

You can override these in the config file:

| Variable               | Default                                              |
| ---------------------- | ---------------------------------------------------- |
| `SEA_TRADER_BROWSER`   | first of `chromium`, `google-chrome-stable`, `brave` |
| `SEA_TRADER_SIZE`      | `1280 840`                                           |
| `SEA_TRADER_WORKSPACE` | `seatrader`                                          |

To toggle it from the keyboard on Omarchy 4+, add this to `~/.config/hypr/bindings.lua` (pick a free combo;
`SUPER ALT + S` is taken by the scratchpad):

```lua
o.bind("SUPER + CTRL + ALT + S", "Sea Trader", "~/.local/bin/sea-trader-open")
```
