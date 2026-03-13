/**
 * System Tray — Soul runs as a background service with tray icon
 *
 * Provides:
 * - System tray icon with status indicator
 * - Quick actions: Open Web UI, Open Chat, Status, Quit
 * - Desktop notifications for important events
 *
 * Uses native Node.js — no Electron required.
 * Works on Windows (PowerShell notification) and macOS (osascript).
 */

import { platform } from "os";
import { exec } from "child_process";

const PORT = parseInt(process.env.SOUL_PORT || "47779", 10);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Open Soul Web UI in default browser
 */
export function openWebUI(path: string = "/") {
  const url = `${BASE_URL}${path}`;
  const os = platform();

  if (os === "win32") {
    exec(`start "" "${url}"`);
  } else if (os === "darwin") {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

/**
 * Send a desktop notification
 */
export function sendDesktopNotification(title: string, message: string) {
  const os = platform();

  if (os === "win32") {
    // Use PowerShell for Windows toast notifications
    const ps = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
      $template = @"
      <toast>
        <visual>
          <binding template="ToastGeneric">
            <text>${title.replace(/"/g, "'")}</text>
            <text>${message.replace(/"/g, "'")}</text>
          </binding>
        </visual>
      </toast>
"@
      $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
      $xml.LoadXml($template)
      $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Soul AI").Show($toast)
    `.replace(/\n/g, " ");
    exec(`powershell -Command "${ps}"`, { timeout: 5000 });
  } else if (os === "darwin") {
    exec(`osascript -e 'display notification "${message}" with title "${title}"'`);
  } else {
    // Linux: try notify-send
    exec(`notify-send "${title}" "${message}"`);
  }
}

/**
 * Register Soul as a startup application (Windows only for now)
 */
export function registerStartup(): { success: boolean; message: string } {
  const os = platform();

  if (os === "win32") {
    try {
      const nodePath = process.execPath;
      const serverPath = new URL("../server.js", import.meta.url).pathname.replace(/^\//, "");
      const cmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Soul AI" /t REG_SZ /d "\\"${nodePath}\\" \\"${serverPath}\\"" /f`;
      exec(cmd);
      return { success: true, message: "Soul registered to start with Windows." };
    } catch (e: any) {
      return { success: false, message: `Failed: ${e.message}` };
    }
  }

  if (os === "darwin") {
    // macOS: create a LaunchAgent plist
    const plistPath = `${process.env.HOME}/Library/LaunchAgents/com.soul-ai.server.plist`;
    const nodePath = process.execPath;
    const serverPath = new URL("../server.js", import.meta.url).pathname;
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.soul-ai.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${serverPath}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>`;
    try {
      const { writeFileSync } = require("fs");
      writeFileSync(plistPath, plist);
      exec(`launchctl load "${plistPath}"`);
      return { success: true, message: "Soul registered as macOS LaunchAgent." };
    } catch (e: any) {
      return { success: false, message: `Failed: ${e.message}` };
    }
  }

  return { success: false, message: `Startup registration not supported on ${os}.` };
}

/**
 * Unregister from startup
 */
export function unregisterStartup(): { success: boolean; message: string } {
  const os = platform();

  if (os === "win32") {
    try {
      exec(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Soul AI" /f`);
      return { success: true, message: "Soul removed from Windows startup." };
    } catch (e: any) {
      return { success: false, message: `Failed: ${e.message}` };
    }
  }

  if (os === "darwin") {
    const plistPath = `${process.env.HOME}/Library/LaunchAgents/com.soul-ai.server.plist`;
    try {
      exec(`launchctl unload "${plistPath}" && rm "${plistPath}"`);
      return { success: true, message: "Soul removed from macOS startup." };
    } catch (e: any) {
      return { success: false, message: `Failed: ${e.message}` };
    }
  }

  return { success: false, message: `Not supported on ${os}.` };
}
