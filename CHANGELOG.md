# Changelog

## 0.1.0 (2026-10-29)

First public release.

- GNOME Shell extension (GNOME 46–50, tested on 50) that shows the wallpaper renderer as the desktop, overview and lock screen background.
- Scene and web wallpapers through a patched linux-wallpaperengine; video wallpapers through mpv.
- Mouse interaction (parallax, cursor effects, clicks on the desktop) via a control socket (engine patch 0002).
- Wallpaper audio only while the desktop is focused; live volume changes.
- Pauses the renderer (SIGSTOP) while an app is focused, the overview or lock screen is open, or a window is fullscreen.
- Top bar wallpaper picker with thumbnails, search, volume, random, pause switch and Steam Workshop link.
- `wwe` CLI: list, set, random, pick, properties, config, sync, doctor, service control; supervisor with crash handling.
- Audio visualiser input only for wallpapers that use it (`audio_processing=auto`).
- One-command installer with dependency handling for apt, dnf, pacman and zypper.
- Engine install layout fix for web wallpapers (CEF aborted when `icudtl.dat` was next to `libcef.so`).
