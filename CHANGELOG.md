# Changelog

## 0.1.2 (2026-10-30)

- Fix: after logging in, the live wallpaper did not appear and the overview lost its workspace view. The extension looked up mutter's surface actor type when it loaded, which at login is before any window exists, and every later attempt to attach the wallpaper failed. The type is now looked up when needed, and an error while attaching can no longer break GNOME's own backgrounds.

## 0.1.1 (2026-10-29)

- Extension passes the extensions.gnome.org review checker (Shexli) with no findings: the config is read asynchronously, the config monitor's signal and the blur-my-shell refresh timer are cleaned up in `disable()`, and the use of the lock-screen session mode is documented there.
- CI runs Shexli on every push.

## 0.1.0 (2026-10-29)

First public release.

- GNOME Shell extension (GNOME 46–50, tested on 50) that shows the wallpaper renderer as the desktop, overview and lock screen background.
- Scene and web wallpapers through a patched linux-wallpaperengine; video wallpapers through mpv.
- Mouse interaction (parallax, cursor effects, clicks on the desktop) via a control socket (engine patch 0002).
- Wallpaper audio only while the desktop is focused; live volume changes.
- Pauses the renderer (SIGSTOP) while an app is focused, the overview or lock screen is open, or a window is fullscreen.
- Top bar wallpaper picker with thumbnails, search, volume, random, pause switch and Steam Workshop link.
- `wwe` CLI: list, set, random, pick, properties, config, sync, doctor, service control; supervisor with crash handling.
- Audio visualiser input (records the speaker output; GNOME shows it as microphone use) is opt-in: `audio_processing=auto` enables it for wallpapers that use it.
- One-command installer with dependency handling for apt, dnf, pacman and zypper.
- Engine install layout fix for web wallpapers (CEF aborted when `icudtl.dat` was next to `libcef.so`).
