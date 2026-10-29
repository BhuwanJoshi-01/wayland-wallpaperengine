# Architecture

## Components

| Path | What |
|---|---|
| `bin/wwe` | Python CLI. Discovers Steam libraries and workshop items, stores config, picks a backend, and `exec`s the renderer. |
| `extension/wayland-wallpaperengine@bhuwanjoshi-01.github.io/` | GNOME Shell extension (GNOME 50, ESM). |
| `systemd/wwe.service` | User unit that runs `wwe run` with the graphical session. |
| `scripts/build-engine.sh` | Clones linux-wallpaperengine at a pinned commit, applies `patches/`, builds, strips, and installs to `~/.local/opt`. |
| `patches/linux-wallpaperengine/` | Small downstream patches. Each one should be upstreamed eventually. |

## Why GNOME needs special handling

Desktop wallpapers on Wayland need a protocol that lets a client draw *below* every window. wlroots compositors and KWin provide `zwlr_layer_shell_v1`, and linux-wallpaperengine already supports it. Mutter does not implement it and has no equivalent, so a regular client can't place a surface on the background.

The only code that controls the background in GNOME is GNOME Shell itself, so the extension does the compositing:

1. `wwe run` starts the renderer as an **ordinary toplevel window** sized to the primary monitor's logical size.
   - linux-wallpaperengine: `--window 0x0xWxH`. Our patch gives it the Wayland `app_id` `linux-wallpaperengine`.
   - mpv: `--wayland-app-id=wwe-video`.
2. The extension watches `window-created` and recognizes renderer windows by `app_id`. It falls back to the title `wallpaperengine` for unpatched engine builds.
3. Renderer windows are made sticky and kept minimized. Minimizing is also re-applied on `shown` and `notify::minimized`. Several shell entry points filter them out:
   - `Shell.Global.get_window_actors`, `Meta.Display.get_tab_list`
   - `Workspace._isOverviewWindow`, `WorkspaceThumbnail._isOverviewWindow`
   - `Shell.WindowTracker.get_window_app`, `Shell.App.get_windows/get_n_windows`, `Shell.AppSystem.get_running` (docks and dash-to-panel)
   - `WindowManager._shouldAnimateActor` (no minimize animation)
4. `BackgroundManager._createBackgroundActor` is wrapped, so every `Meta.BackgroundActor` gets a child `Clutter.Clone` whose source is the renderer's `Meta.WindowActor`. A clone paints its source even when the source is hidden, and mutter still sends frame callbacks to a surface that is painted only through a clone. The renderer therefore keeps animating while minimized.
5. When `display.get_monitor_in_fullscreen(i)` is true for any monitor, the renderer's process group gets `SIGSTOP`. Because systemd starts `wwe run` as a session leader and it `exec`s, the group is the renderer plus its CEF helpers. It gets `SIGCONT` when fullscreen ends and when the extension is disabled.

## Backend selection (`wwe run`)

```
WAYLAND_DISPLAY set and XDG_CURRENT_DESKTOP contains GNOME  -> gnome
otherwise                                                     -> layer-shell
                                                                 (linux-wallpaperengine --screen-root <output> for
                                                                  every connected DRM output)
```

Force a backend with `"backend"` in `~/.config/wwe/config.json`.

## Known limitations

- Multi-monitor on GNOME: a single renderer is cloned onto every monitor. The extension already assigns renderers to monitors in launch order, so running one renderer per monitor only needs `wwe run` to supervise several children.
- No mouse input reaches the wallpaper on GNOME, because the window is never focused or under the pointer.
- Monitor hot-plug and resolution changes need a `wwe restart`.
