import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// Sea Trader status for the Omarchy bar. The heavy lifting (API call, desktop
// notifications, window toggling) lives in the bundled bin/ scripts, which
// read the server URL and token from ~/.config/sea-trader/config.
BarWidget {
  id: root
  moduleName: "ulfendk.sea-trader"

  readonly property string binDir: decodeURIComponent(String(Qt.resolvedUrl("bin")).replace(/^file:\/\//, ""))
  readonly property string icon: String.fromCodePoint(0xf0031) // nf-md-anchor
  readonly property int interval: Math.max(15, Number(setting("interval", 60)) || 60)

  property string status: "loading" // idle | pending | urgent | offline | loading
  property string label: icon
  property string tooltip: "Sea Trader: checking…"

  function refresh() {
    if (!statusProc.running) statusProc.running = true
  }

  function open() {
    if (root.bar) root.bar.run(Util.shellQuote(root.binDir + "/sea-trader-open"))
  }

  function apply(raw) {
    var data
    try {
      data = JSON.parse(String(raw || "").trim())
    } catch (e) {
      root.status = "offline"
      root.label = root.icon + " !"
      root.tooltip = "Sea Trader: unexpected output from sea-trader-status"
      return
    }
    root.status = data["class"] || "idle"
    root.label = data.text || root.icon
    root.tooltip = data.tooltip || ""
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  IpcHandler {
    target: "ulfendk.sea-trader"

    function refresh(): void {
      root.broadcast("refresh")
    }
  }

  Process {
    id: statusProc
    command: [root.binDir + "/sea-trader-status"]
    environment: ({ "SEA_TRADER_ICON": root.icon })
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.apply(text)
    }
  }

  Timer {
    interval: root.interval * 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  // Blink the whole widget while a decision has a deadline; animating a
  // wrapper leaves WidgetButton's own dimmed/opacity binding intact.
  Item {
    id: blinker
    anchors.fill: parent

    SequentialAnimation on opacity {
      running: root.status === "urgent"
      loops: Animation.Infinite
      alwaysRunToEnd: true
      NumberAnimation { to: 0.4; duration: 600; easing.type: Easing.InOutQuad }
      NumberAnimation { to: 1.0; duration: 600; easing.type: Easing.InOutQuad }
    }

    WidgetButton {
      id: button
      anchors.fill: parent
      bar: root.bar
      text: root.vertical ? root.icon : root.label
      foreground: root.status === "pending" ? Color.accent : (root.bar ? root.bar.barForeground : Color.foreground)
      active: root.status === "urgent"
      dimmed: root.status === "offline" || root.status === "loading"
      tooltipText: root.tooltip
      onPressed: function(mouseButton) {
        if (mouseButton === Qt.RightButton) root.refresh()
        else root.open()
      }
    }
  }
}
