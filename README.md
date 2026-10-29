# Wayland Wallpaper Engine

Live wallpapers and **Steam Wallpaper Engine** workshop items on Linux **Wayland**, including **GNOME**, where no existing tool could put them on the desktop.

- **Scene** and **web** wallpapers are rendered by [linux-wallpaperengine](https://github.com/Almamu/linux-wallpaperengine).
- **Video** wallpapers (workshop items or any `.mp4`/`.webm`/`.mkv` file) play through `mpv`, which uses hardware decoding.
- On **GNOME**, a small GNOME Shell extension places the renderer behind your desktop.
- On **KDE Plasma, Hyprland, Sway, niri** and other compositors with `wlr-layer-shell`, linux-wallpaperengine draws on the background layer directly.
- The wallpaper **pauses itself** whenever an app is focused or a window is fullscreen, so it uses no CPU or GPU while you work or play; it plays (with sound) when you are on the desktop.
- `wwe` is a single command to list, pick, set, randomize and autostart wallpapers.

> You need to own [Wallpaper Engine](https://store.steampowered.com/app/431960/) on Steam. Its assets are required for scene wallpapers, and the workshop items are what you subscribe to there. This project is not affiliated with Wallpaper Engine or Valve.

## Why

On GNOME Wayland, linux-wallpaperengine has nowhere to draw. Its Wayland backend needs the `wlr-layer-shell` protocol, and GNOME's compositor (mutter) does not implement it. The X11 root-window trick doesn't work either. GUIs such as [linux-wallpaperengine-gui](https://github.com/AzPepoze/linux-wallpaperengine-gui) inherit the same limitation.

## How it works (GNOME)

```
 wwe.service ── wwe run ──exec──▶ linux-wallpaperengine --window 0x0xWxH   (scene / web)
                                 mpv --wayland-app-id=wwe-video            (video)
                                          │  normal Wayland window
                                          ▼
 GNOME Shell + extension ─┬─ keeps the window minimized and out of overview / alt-tab / dock
                          ├─ paints a live Clutter.Clone of it inside every background actor
                          │  (desktop, overview workspaces, lock screen)
                          └─ SIGSTOP / SIGCONT the renderer while something is fullscreen
```

The window-cloning technique comes from [Hanabi](https://github.com/jeffshee/gnome-ext-hanabi). Hanabi ships its own GTK video renderer. This project uses the same trick to host linux-wallpaperengine, so scene and web wallpapers work as well as videos. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Compatibility

| Desktop | Backend | Status |
|---|---|---|
| GNOME 50 (Wayland) | extension + window clone | working: scene, web, video |
| KDE Plasma 6 (Wayland) | layer-shell (linux-wallpaperengine) | should work, needs testing |
| Hyprland / Sway / niri / river | layer-shell | should work, needs testing |
| X11 desktops | linux-wallpaperengine `--screen-root` | upstream behaviour |

Some individual wallpapers don't render correctly. Those are linux-wallpaperengine limitations; see its [issue tracker](https://github.com/Almamu/linux-wallpaperengine/issues).

## Install

```bash
git clone https://github.com/BhuwanJoshi-01/wayland-wallpaperengine.git
cd wayland-wallpaperengine

# Ubuntu / Debian build dependencies (build-engine.sh prints whatever is missing)
sudo apt install build-essential cmake git pkg-config libxrandr-dev libxinerama-dev libxcursor-dev \
  libxi-dev libgl-dev libglew-dev freeglut3-dev libsdl2-dev liblz4-dev libavcodec-dev libavformat-dev \
  libavutil-dev libswscale-dev libxxf86vm-dev libglm-dev libglfw3-dev libmpv-dev libpulse-dev \
  libfftw3-dev libfreetype-dev libdbus-1-dev zlib1g-dev libwayland-dev wayland-protocols \
  libxkbcommon-dev libegl-dev mpv zenity

./install.sh
```

`install.sh` builds a pinned and patched linux-wallpaperengine into `~/.local/opt/linux-wallpaperengine`. It also installs `wwe` to `~/.local/bin`, the GNOME extension, and a `wwe.service` systemd user unit that starts with your session.

On GNOME, **log out and back in once** after the first install so that GNOME Shell loads the extension.

## Usage

```bash
wwe list                       # subscribed workshop items (* = current)
wwe set 3652531378             # apply a workshop item
wwe set ~/Videos/rain.mp4      # any video file
wwe pick                       # choose from a dialog
wwe random --type scene
wwe set 1748506393 --volume 30 # with sound
wwe set 3652531378 --fps 60 --scaling fit
wwe properties                 # list the current wallpaper's settings
wwe set 3730181927 -p schemecolor="0.2 0.4 1"
wwe stop | start | restart | status
wwe doctor                     # diagnose the setup
```

Settings are stored in `~/.config/wwe/config.json`:

| key | default | meaning |
|---|---|---|
| `wallpaper` | `null` | workshop id, project folder or video file |
| `fps` | `30` | frame limit for scene/web wallpapers |
| `silent` / `volume` | `true` / `15` | sound |
| `scaling` | `fill` | `fill`, `fit`, `stretch`, `default` |
| `pause` | `focus` | GNOME: `focus` plays only while the desktop is focused (no CPU/GPU use otherwise), `fullscreen` pauses only for fullscreen apps, `never` |
| `gpu` | `igpu` | `dgpu` renders on the NVIDIA GPU (PRIME offload) |
| `backend` | `auto` | force `gnome` or `layer-shell` |
| `video_player` | `auto` | `mpv` or `engine` for video items |
| `properties` | `{}` | wallpaper property overrides |
| `extra_args` | `[]` | extra linux-wallpaperengine arguments |

Logs: `journalctl --user -u wwe -f`. Extension logs: `journalctl -f /usr/bin/gnome-shell | grep -i wallpaper`.

## Uninstall

```bash
./uninstall.sh          # keep config and the engine build
./uninstall.sh --purge  # remove everything
```

## Roadmap

- One renderer per monitor (multi-monitor currently mirrors the primary monitor's wallpaper)
- Settings / wallpaper browser UI (GNOME extension preferences, thumbnails from `preview.jpg`)
- Playlists and timed rotation
- Mouse interaction forwarding for interactive wallpapers
- Older GNOME versions (45–49)
- Packaging: extensions.gnome.org, AUR, deb, Flatpak

Contributions are welcome. Testing reports for KDE and wlroots compositors are especially useful.

## Credits

- [Almamu/linux-wallpaperengine](https://github.com/Almamu/linux-wallpaperengine): the Wallpaper Engine renderer (GPL-3.0)
- [jeffshee/gnome-ext-hanabi](https://github.com/jeffshee/gnome-ext-hanabi): window-as-wallpaper technique for GNOME (GPL-3.0)
- [AzPepoze/linux-wallpaperengine-gui](https://github.com/AzPepoze/linux-wallpaperengine-gui): GUI for linux-wallpaperengine

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
