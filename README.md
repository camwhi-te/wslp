# WSLP — WSL Picker

Choose which WSL distribution to work in when VS Code starts.

## The problem

VS Code reopens the last window you had open. If you shut down while working in WSL distro **A**, the next launch reconnects to **A**, even if you want to work in **B** today. Switching to **B** then leaves **A** running in the background, using memory and CPU until you run `wsl --terminate A` yourself.

## What WSLP does

- **Asks on launch.** On the first window of each VS Code session, WSLP lists your WSL distributions. The current one comes first, so pressing <kbd>Enter</kbd> keeps it. If you pick another, WSLP shows that distribution's recent folders and opens your choice **in the same window**, so no extra window is left behind.
- **Cleans up the old distro.** After the switch, WSLP offers to shut down the distribution you left (`wsl --terminate`). It only offers this when no other VS Code window is still connected to that distribution. Pick **Always** or **Never** to stop being asked.
- **Optional: skip connecting to A at all.** Run **WSLP: Start With Picker Instead of Reopening Last Window**. This sets `window.restoreWindows` to `none`, so VS Code starts with an empty local window and WSLP asks which distribution to open. Nothing boots until you pick, which is the cheapest option. (This setting applies to local windows too.)

Reloading a window or opening another window later in the same session does not trigger the prompt. Only a fresh launch of VS Code does.

## Commands

| Command | |
|---|---|
| `WSLP: Switch WSL Distribution…` | Move this window to another distribution. |
| `WSLP: Shut Down WSL Distribution…` | Terminate a running distribution. Warns if windows are still using it. |
| `WSLP: Start With Picker Instead of Reopening Last Window` | Sets `window.restoreWindows: "none"`. |

## Settings

| Setting | Default | |
|---|---|---|
| `wslp.promptOnLaunch` | `true` | Ask when VS Code starts in a restored WSL window. |
| `wslp.promptInEmptyWindow` | `true` | Ask when VS Code starts with an empty local window. |
| `wslp.shutdownPrevious` | `"ask"` | `ask` / `always` / `never`: what to do with the distribution you switched away from. |
| `wslp.excludeDistros` | Docker / Rancher Desktop distros | Distributions hidden from the picker. |

## Install

WSLP must run on the **Windows** side of VS Code (it's a `ui` extension that calls `wsl.exe`). From a Windows terminal in this folder:

```powershell
npx @vscode/vsce package
code --install-extension wslp-0.1.0.vsix
```

## Develop

There are no runtime dependencies and no build step. The source is plain JavaScript in `src/`.

```sh
npm test   # unit tests for wsl.exe parsing, cross-window state, recent-folder filtering
```

To debug, open this folder in a **local** (Windows) VS Code window and press <kbd>F5</kbd>.

## Known limitations

- **A** still boots briefly when VS Code restores it, because WSLP can only ask once the window has opened. Use the `restoreWindows` command above to avoid that.
- Only VS Code windows count as "using" a distribution. A WSL terminal outside VS Code, Docker, or a `\\wsl$` Explorer window will be stopped by a shutdown. That's why the default is `ask`.
- In an empty WSL window (no folder open), WSLP can't tell which distribution the window is connected to, so it won't offer to shut it down after a switch.
- The recent-folder list uses VS Code's internal `_workbench.getRecentlyOpened` command. If that ever breaks, you still get the **Empty window** option.
