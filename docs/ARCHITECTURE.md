# Architecture

## Components

| Path | What |
|---|---|
| `bin/wwe` | Python CLI (standard library only; uses `gi` for monitor detection if available). Finds Steam libraries and workshop items, stores the config, picks a backend, and supervises the renderer. |
| `extension/<uuid>/extension.js` | GNOME Shell extension: renderer window handling, background clones, pausing, shell overrides. |
| `extension/<uuid>/background-clone.js` | The actors placed inside GNOME's background actors (`CloneHolder`, `CoverClone`). |
| `extension/<uuid>/input.js` | Pointer forwarding and desktop-only audio. |
| `extension/<uuid>/picker.js` | Top bar wallpaper picker; talks to `wwe` only. |
| `systemd/wwe.service` | User unit that runs `wwe run` with the graphical session. |
| `install.sh`, `uninstall.sh` | Per-user install / removal; `install.sh` also bootstraps itself when piped from curl. |
| `scripts/deps.sh` | Distribution package names (apt, dnf, pacman, zypper). |
| `scripts/build-engine.sh` | Clones linux-wallpaperengine at a pinned commit, applies `patches/`, builds, installs to `~/.local/opt`. |
| `patches/linux-wallpaperengine/` | Downstream engine patches, meant to be upstreamed. |

## Why GNOME needs special handling

A wallpaper on Wayland needs a protocol that lets a client draw *below* every window. wlroots compositors and KWin provide `zwlr_layer_shell_v1`, and linux-wallpaperengine supports it. Mutter (GNOME) has no equivalent, so a regular client cannot place a surface on the background, and the background belongs to GNOME Shell.

The extension therefore does the compositing itself.

### Renderer window

`wwe run` starts the renderer as an ordinary toplevel window:

- linux-wallpaperengine with `--window 0x0xWxH`; patch `0001` gives it the Wayland `app_id` `linux-wallpaperengine`;
- mpv with `--wayland-app-id=wwe-video`.

The extension recognises these windows by `app_id`. For unpatched engine builds it falls back to the title `wallpaperengine`. Then:

1. **Never in the way.** The window is made sticky and lowered (and lowered again when raised). Its actors are made non-reactive so pointer input falls through. It gives keyboard focus back if it gets it. Its actor has opacity 0, which clones ignore.
2. **First frame.** A window minimized before it ever drew has no buffer, so clones of it stay empty. The window therefore stays mapped (invisible, at the bottom, click-through) until `actor.get_texture().get_preferred_size()` reports content, and only then gets minimized. There is no timeout: a renderer started on the lock screen draws nothing until unlock.
3. **Fullscreen, but only while minimized.** GNOME keeps resizing and moving a normal window whenever the usable area changes (panels, docks, lock screen). That made video wallpapers jump and leave black bands. Fullscreen windows always get the whole monitor, and a *minimized* fullscreen window does not count for `get_monitor_in_fullscreen`, so panels stay visible. The window is only made fullscreen after it is minimized, and fullscreen is removed again before it is ever shown.
4. **Hidden from the shell.** Several entry points filter renderer windows out:
   - `Shell.Global.get_window_actors`, `Meta.Display.get_tab_list`
   - `Workspace._isOverviewWindow`, `WorkspaceThumbnail._isOverviewWindow` (the latter receives window actors)
   - `Shell.WindowTracker.get_window_app`, `Shell.App.get_windows/get_n_windows`, `Shell.AppSystem.get_running` (docks, dash-to-panel)
   - `Meta.Window.is_skip_taskbar` (attention notifications), `WindowManager._shouldAnimateActor`

### Background clones

`BackgroundManager._createBackgroundActor` is wrapped, so every `Meta.BackgroundActor` (desktop, overview workspaces, lock screen, and backgrounds other extensions create) gets a `CloneHolder` child containing a `CoverClone` of the renderer.

- The clone's source is the renderer's **main surface actor** (the largest visible `MetaSurfaceActor`), not the window actor. This leaves out what mutter draws around the buffer, e.g. the black backing of fullscreen windows.
- `CloneHolder` reports a **zero preferred size**. Overview backgrounds size themselves height-for-width to keep the monitor's shape. A child with a real size overrides that and squashes the workspace previews.
- `CloneHolder` lays the clone out in **`vfunc_allocate`**, like CSS `background-size: cover`. Resizing a child from an allocation signal re-queues layout forever, and Clutter never paints an actor whose allocation is pending.
- `CoverClone` reports its **allocation as paint volume**. `Clutter.Clone` scales its source while painting but reports the source's unscaled paint volume, so partial redraws of the extra area would skip it.
- A clone paints its source even when the source is hidden (minimized), and mutter sends frame callbacks to a surface that has mapped clones, so the renderer keeps animating.

### Input and audio (`input.js`)

Patch `0002` adds an optional control socket to linux-wallpaperengine: if `WWE_CONTROL_SOCKET` is set, the engine binds a non-blocking `AF_UNIX` datagram socket there and reads one ASCII command per datagram:

```
P <x> <y> <buttons>   pointer in window coordinates (top-left origin); bit 0 left, bit 1 right
M <0|1>               mute / unmute all wallpaper audio (works like automute)
V <0-128>             volume
```

The extension polls `global.get_pointer()` about 60 times a second while a scene/web renderer is running and not paused, and sends `P` when something changed. A button press counts for the wallpaper only if it started on the desktop: the pick at that point is the background group, the stage, or a desktop window (DING). Audio is unmuted only while the desktop is active (see below). mpv gets the equivalent JSON IPC commands on `$XDG_RUNTIME_DIR/wwe/mpv.sock`.

### Pausing

"Desktop active" means nothing or a desktop window is focused, and neither the overview nor the lock screen is showing. With `pause=focus` (default), renderers are stopped with `SIGSTOP` whenever the desktop is not active. With any setting they are also stopped while another window on the current workspace is fullscreen (except `never`). `SIGCONT` resumes them.

`wwe run` starts each renderer in its own process group, so the whole group is signalled, including the CEF helpers of web wallpapers. `kill(1)` is run directly through `Gio.Subprocess` (no shell; dash's `kill` rejects `--`), and signals are queued so quick focus changes cannot be delivered out of order. A renderer still waiting for its first frame is never stopped. The extension reads the `pause` key from `~/.config/wwe/config.json` through a file monitor.

## `wwe run` (supervisor)

`wwe run` resolves the wallpaper, builds the renderer command and keeps it running:

- It polls the mtime of the wwe config and of Wallpaper Engine's `config.json` once a second. When the resulting command changes, it restarts the renderer. If only the volume changed, it sends `V` (engine) or an mpv IPC command instead.
- Crashes restart the renderer up to 3 times per minute; after that it waits for a different wallpaper.
- `audio_processing=auto` passes `--no-audio-processing` unless the wallpaper's `project.json` has `general.supportsaudioprocessing`. The visualiser input records the speaker monitor, which GNOME shows as microphone use.

Backend selection:

```
WAYLAND_DISPLAY set and XDG_CURRENT_DESKTOP contains GNOME   -> gnome
otherwise                                                      -> layer-shell
    (linux-wallpaperengine --screen-root <output> for every connected DRM output)
```

## Engine install layout

`cmake --install` puts `libcef.so` next to `icudtl.dat`. With that layout CEF aborts with `SIGTRAP` as soon as a web wallpaper starts. `build-engine.sh` keeps the resources (`icudtl.dat`, `*.pak`, `locales/`) next to the executable and moves `libcef.so` with its own libraries (`libEGL.so`, `libGLESv2.so`, `libvk_swiftshader.so`, `chrome-sandbox`, …) into `lib/`, which is already in the binaries' `RUNPATH`.

## Known limitations

- Multi-monitor on GNOME: one renderer is cloned onto every monitor. The extension already assigns renderers to monitors in launch order, so one renderer per monitor only needs `wwe run` to start several.
- The Wallpaper Engine app under Proton cannot apply wallpapers (its renderer has no Windows desktop to draw on), so it never saves a selection. The picker and `wwe` are the way to choose.
- Monitor hot-plug or resolution changes need `wwe restart`.
