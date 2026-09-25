# Sea Trader for Omarchy

A Waybar module that shows how many of your ships need orders, sends desktop notifications (mako) when
a decision comes up, and opens the game as a floating window on a Hyprland special workspace.

```
⚓ 3     ← 3 ships need you (yellow); red and blinking when a decision has a deadline
```

- **Click:** show or hide the floating game window.
- **Right-click:** refresh now.
- **Hover:** list of pending actions per game.
- **Notification "Open game" button:** opens the window.

## Install

1. In the game, go to **Settings → Omarchy status bar → Create status bar token** and copy the token.
2. Run:

   ```sh
   git clone https://github.com/ulfendk/sea-trader.git
   ./sea-trader/integrations/omarchy/install.sh
   ```

   The installer:
   - copies `sea-trader-status` and `sea-trader-open` to `~/.local/bin`
   - writes `~/.config/sea-trader/config` (URL, API URL, token)
   - adds `custom/sea-trader` to the start of `modules-right` in `~/.config/waybar/config.jsonc` (backup kept
     as `config.jsonc.bak-sea-trader`) and appends styles to `style.css`
   - sources `~/.config/hypr/sea-trader.conf` from `hyprland.conf`
   - restarts Waybar and reloads Hyprland

   Needs `curl`, `jq`, `hyprctl`, `notify-send` and Chromium or another Chromium-based browser. All of these
   ship with Omarchy.

## Manual setup

`~/.config/sea-trader/config`:

```sh
SEA_TRADER_URL=https://seatrader.example.com/
SEA_TRADER_API=https://seatrader.example.com/api
SEA_TRADER_TOKEN=<token from Settings>
```

Add [`waybar-module.jsonc`](waybar-module.jsonc) to your Waybar config and `"custom/sea-trader"` to a module
list. Then append [`waybar-style.css`](waybar-style.css) to `style.css`.

## How the floating window works

On first click, `sea-trader-open` launches the game with `chromium --app=<url>` using its own profile
(`~/.local/share/sea-trader/browser`). It uses Hyprland exec rules:
`[workspace special:seatrader silent; float; size 1280 840; center]`. Later clicks run
`togglespecialworkspace seatrader`, so the game slides in and out like a scratchpad and keeps running in
the background. You sign in once in that window; it counts as its own device under Settings.

You can override these in the config file:

| Variable               | Default                                              |
| ---------------------- | ---------------------------------------------------- |
| `SEA_TRADER_BROWSER`   | first of `chromium`, `google-chrome-stable`, `brave` |
| `SEA_TRADER_SIZE`      | `1280 840`                                           |
| `SEA_TRADER_WORKSPACE` | `seatrader`                                          |
| `SEA_TRADER_ICON`      | `⚓`                                                 |

To toggle it from the keyboard, uncomment the `bind` line in `~/.config/hypr/sea-trader.conf`.
