# Wayland Wallpaper Engine

**Your Steam Wallpaper Engine wallpapers as a live desktop background on Linux Wayland, including GNOME.**

Scene, web and video wallpapers from the Steam Workshop play behind your windows. You can interact with them using the mouse, they play sound while you are on the desktop, and they stop completely while you work or game, so they cost no CPU or GPU then.

[![CI](https://github.com/BhuwanJoshi-01/wayland-wallpaperengine/actions/workflows/ci.yml/badge.svg)](https://github.com/BhuwanJoshi-01/wayland-wallpaperengine/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

```bash
curl -fsSL https://raw.githubusercontent.com/BhuwanJoshi-01/wayland-wallpaperengine/main/install.sh | bash
```

> You need to own [Wallpaper Engine](https://store.steampowered.com/app/431960/) on Steam: its assets are required for scene wallpapers, and the workshop items you subscribe to there are the wallpapers. This project is not affiliated with Wallpaper Engine, Kristjan Skutta or Valve.

## Features

- **Scene, web and video wallpapers** from the Steam Workshop. Scene and web wallpapers are rendered by [linux-wallpaperengine](https://github.com/Almamu/linux-wallpaperengine). Videos (workshop items or any `.mp4`/`.webm`/`.mkv`) play through `mpv` with hardware decoding.
- **Works on GNOME (Wayland).** No existing tool could put these wallpapers on the GNOME desktop, because GNOME has no `wlr-layer-shell`. A small GNOME Shell extension does it here.
- **Mouse interaction.** Parallax and cursor effects follow your pointer, and clicks on the desktop reach interactive wallpapers. Clicks on windows never do.
- **Sound on the desktop only.** The wallpaper's audio plays while the desktop is focused and is muted when an app is focused.
- **Pauses when you are not looking.** When an app is focused, the overview is open, the screen is locked or a game is fullscreen, the renderer is frozen (0 % CPU). Measured on an Intel iGPU: 13 % → 0 % renderer CPU, 22 % → 3 % GNOME Shell CPU, 71 % → 7 % GPU.
- **Wallpaper picker** in the top bar: thumbnails of everything you subscribed to, search, volume, random, and a link to the Steam Workshop.
- **The `wwe` command** for everything else: list, set, random, wallpaper properties, settings, diagnostics.
- **Wallpaper properties** (colours, toggles, sliders) can be set per wallpaper.
- **Autostarts** with your session (systemd user service). The wallpaper restarts if it crashes and gives up after repeated failures.
- **Other compositors:** on KDE Plasma, Hyprland, Sway, niri and other compositors with `wlr-layer-shell`, linux-wallpaperengine draws on the background layer directly.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/BhuwanJoshi-01/wayland-wallpaperengine/main/install.sh | bash
```

The installer:

1. downloads this repository to `~/.local/share/wayland-wallpaperengine/src`;
2. checks for the packages it needs and offers to install the missing ones with `sudo`. It knows apt (Ubuntu, Debian, Mint, Pop!_OS), dnf (Fedora), pacman (Arch, Manjaro, EndeavourOS) and zypper (openSUSE);
3. builds a pinned, patched [linux-wallpaperengine](https://github.com/Almamu/linux-wallpaperengine) into `~/.local/opt/linux-wallpaperengine`. This happens once, takes 10–20 minutes, and downloads about 300 MB (Chromium Embedded Framework);
4. installs the `wwe` command, the GNOME Shell extension and the `wwe.service` user service.

On GNOME, **log out and back in once** afterwards so GNOME Shell loads the extension.

Nothing is installed system-wide apart from the distribution packages you agree to. To install from a clone instead:

```bash
git clone https://github.com/BhuwanJoshi-01/wayland-wallpaperengine.git
cd wayland-wallpaperengine
./install.sh            # --yes: no questions, --rebuild: rebuild the engine, --dev: symlink files
```

### Requirements

- Linux with a **Wayland** session and **systemd**
- **GNOME 46–50** (tested on GNOME 50), or a compositor with `wlr-layer-shell` (KDE Plasma 6, Hyprland, Sway, niri, …)
- **Wallpaper Engine** installed through Steam (native or Flatpak Steam; it does not need to run)
- A GPU with OpenGL 3.3

## Usage

Subscribe to wallpapers in the [Steam Workshop](https://steamcommunity.com/app/431960/workshop/) (Steam downloads them even if Wallpaper Engine is never started), then choose one from the **wallpaper icon in the top bar**, or:

```bash
wwe list                         # your subscribed wallpapers (* = current)
wwe set 3652531378               # apply a workshop item by id
wwe set ~/Videos/rain.mp4        # or any video file
wwe random --type scene
wwe pick                         # choose in a dialog
wwe properties                   # settings the current wallpaper offers
wwe set 3730181927 -p schemecolor="0.2 0.4 1"
wwe config volume=70 fps=24      # change settings (applied live)
wwe stop | start | restart | status
wwe doctor                       # check the whole setup
```

Logs: `journalctl --user -u wwe -f`

## Configuration

`~/.config/wwe/config.json`. Change values with `wwe config key=value` or from the picker. Changes apply immediately.

| key | default | meaning |
|---|---|---|
| `wallpaper` | `null` | workshop id, project folder or video file |
| `fps` | `30` | frame limit for scene and web wallpapers |
| `volume` | `50` | 0–100 |
| `silent` | `false` | mute the wallpaper |
| `pause` | `focus` | GNOME: `focus` plays only while the desktop is focused; `fullscreen` pauses only for fullscreen windows; `never` |
| `audio_processing` | `false` | audio visualiser input for wallpapers that react to music. It records what your speakers play, so GNOME shows the microphone indicator meanwhile; off by default. `auto` = only for wallpapers that declare it, `true` = always |
| `automute` | `false` | also mute while another app plays sound |
| `disable_mouse` | `false` | no mouse interaction |
| `scaling` | `fill` | `fill`, `fit`, `stretch`, `default` |
| `gpu` | `igpu` | `dgpu` renders on a discrete NVIDIA GPU (PRIME offload) |
| `source` | `wallpaper-engine` | `wallpaper-engine` follows a selection saved by the Wallpaper Engine app if there is one, else the `wwe set` wallpaper; `manual` always uses the `wwe set` wallpaper |
| `video_player` | `auto` | `mpv` or `engine` for video wallpapers |
| `backend` | `auto` | force `gnome` or `layer-shell` |
| `properties` | `{}` | wallpaper property overrides |
| `extra_args` | `[]` | extra linux-wallpaperengine arguments |

## How it works

On GNOME the wallpaper renderer runs as an ordinary, hidden window. The extension shows a live copy of it inside GNOME's own background, so the wallpaper also appears in the overview and on the lock screen, and it feeds the renderer your mouse position and the audio state over a socket. The same window-copy technique is used by [Hanabi](https://github.com/jeffshee/gnome-ext-hanabi) for videos. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
 wwe.service ── wwe run (supervisor) ──▶ linux-wallpaperengine --window   scene / web
                                          mpv --wayland-app-id=wwe-video   video
                                                │ hidden Wayland window
 GNOME Shell + extension ──────────────────────┤
   • copies the window into the desktop / overview / lock screen background
   • sends pointer and mute commands (control socket, mpv IPC)
   • freezes the renderer (SIGSTOP) while you are not on the desktop
   • top bar wallpaper picker
```

## Compatibility

| | Status |
|---|---|
| GNOME 50, Wayland | ✅ tested: scene, web, video, mouse, audio, pausing |
| GNOME 46–49, Wayland | should work (compatibility code included, not yet tested), please report |
| KDE Plasma 6 / Hyprland / Sway / niri | linux-wallpaperengine on `wlr-layer-shell`, needs testing |
| Ubuntu / Debian | ✅ tested on Ubuntu 26.04 |
| Fedora / Arch / openSUSE | package lists included, needs testing |

Some wallpapers don't render correctly because linux-wallpaperengine doesn't support every Wallpaper Engine feature yet. See its [issue tracker](https://github.com/Almamu/linux-wallpaperengine/issues). The Wallpaper Engine app itself runs under Proton for browsing and subscribing, but it cannot apply wallpapers there. Use the picker or `wwe` for that.

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md). Start with `wwe doctor`.

## Uninstall

```bash
~/.local/share/wayland-wallpaperengine/src/uninstall.sh          # keeps settings and the engine build
~/.local/share/wayland-wallpaperengine/src/uninstall.sh --purge  # removes everything
```

## Contributing

Bug reports, testing on other distributions and desktops (there is a [test report](https://github.com/BhuwanJoshi-01/wayland-wallpaperengine/issues/new?template=test_report.yml) form), and pull requests are very welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: see [SECURITY.md](SECURITY.md). Accessibility: [ACCESSIBILITY.md](ACCESSIBILITY.md).

## Credits

- [Almamu/linux-wallpaperengine](https://github.com/Almamu/linux-wallpaperengine): the Wallpaper Engine renderer (GPL-3.0). This project builds it with two small patches in [`patches/`](patches/linux-wallpaperengine).
- [jeffshee/gnome-ext-hanabi](https://github.com/jeffshee/gnome-ext-hanabi): the window-as-wallpaper technique for GNOME (GPL-3.0).
- [mpv](https://mpv.io) for video playback.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
