# Troubleshooting

Start with:

```bash
wwe doctor                      # checks every part of the setup
journalctl --user -u wwe -b     # renderer and supervisor log
journalctl -b /usr/bin/gnome-shell | grep -i wallpaper   # extension errors
```

## The wallpaper shows up as a normal window

The GNOME extension is not running. After the first install you have to **log out and back in once**. Check with:

```bash
gnome-extensions info wayland-wallpaperengine@bhuwanjoshi-01.github.io
```

`State` should be `ACTIVE`. If it says `OUT OF DATE`, your GNOME version is not in the supported range (46–50).

## Nothing changes on the desktop

- `wwe status`: is `wwe.service` running?
- `wwe doctor`: is a wallpaper set (`manual:` line), and is Wallpaper Engine found?
- Some wallpapers crash linux-wallpaperengine. The log then says `renderer keeps crashing`. Try another wallpaper with `wwe random`.

## The wallpaper is frozen

That is intended while an app is focused (`pause=focus`), while the overview or the lock screen is open, and while a window is fullscreen. Click the desktop and it plays again. Use `wwe config pause=fullscreen` to pause only for fullscreen windows, or `pause=never`.

## GNOME shows the microphone indicator

Wallpapers that react to music (Wallpaper Engine marks them with *supports audio processing*) record what your **speakers** play, not your microphone. GNOME shows the indicator for any audio capture. To turn it off for all wallpapers:

```bash
wwe config audio_processing=false
```

## No sound

The wallpaper only plays sound while the desktop is focused. Check `wwe config` for `silent` and `volume`. Video wallpapers need `mpv`.

## Video wallpapers do not play

Install `mpv` (`sudo apt install mpv`, `sudo dnf install mpv`, `sudo pacman -S mpv`). Without mpv, wwe falls back to linux-wallpaperengine's video player, which does not work on all drivers.

## Black bars on a video wallpaper

Many fan-made videos contain black bars in some scenes. Check the file itself, e.g. `ffmpeg -i video.mp4 -vf cropdetect -f null -`. Wallpaper Engine on Windows shows them too.

## High CPU or GPU use

While the wallpaper plays (desktop focused) it renders at `fps` frames per second. Lower it with `wwe config fps=20`. Heavy scene wallpapers (bloom, particles) cost more than videos. On laptops with two GPUs it renders on the integrated GPU by default (`gpu=igpu`).

## Build problems

`scripts/build-engine.sh` prints the missing distribution packages. On distributions other than Ubuntu/Debian the package names are a best effort; if one is wrong, install the equivalent package and run `./install.sh --rebuild`. Please open an issue with the correct name.

## The Wallpaper Engine app does not apply wallpapers

Under Proton, Wallpaper Engine's renderer has no Windows desktop to draw on, so clicking a wallpaper there does nothing and no selection is saved. Use the app (or the Steam Workshop) to find and subscribe to wallpapers, and the top bar picker or `wwe set` to apply them. If the app does not open from Steam, an old instance may still be running in the background:

```bash
WINEPREFIX=~/.steam/steam/steamapps/compatdata/431960/pfx ~/.steam/steam/steamapps/common/Proton*/files/bin/wineserver -k
```

## Reporting a bug

Please include the output of `wwe doctor`, your distribution and GNOME version (`gnome-shell --version`), the wallpaper's workshop id, and the log lines from `journalctl --user -u wwe -b`.
