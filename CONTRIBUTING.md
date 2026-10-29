# Contributing

Thanks for helping. The most useful contributions right now:

- **Testing** on other distributions (Fedora, Arch, openSUSE), GNOME versions (46–49) and compositors (KDE Plasma, Hyprland, Sway). Open an issue with the result, even when everything works.
- **Bug reports** with `wwe doctor` output and the log (see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)).
- **Pull requests.**

## Development setup

```bash
git clone https://github.com/BhuwanJoshi-01/wayland-wallpaperengine.git
cd wayland-wallpaperengine
./install.sh --dev      # symlinks bin/wwe, the extension and the unit into place
```

With `--dev`, edits to `bin/wwe` take effect on the next `wwe` call (`wwe restart` for the renderer). Extension changes need GNOME Shell to load them again: log out and back in, or use a nested shell (`dbus-run-session gnome-shell --devkit`, needs `mutter-dev-bin` / `mutter-devel`).

Extension logs: `journalctl -f /usr/bin/gnome-shell`.

## Layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together and why some things are done the way they are. Several of them work around specific mutter/Clutter behaviour; the comments next to the code explain which.

## Guidelines

- Match the surrounding code style: GJS ESM with 4-space indentation in the extension, standard-library Python in `bin/wwe`, `bash` with `set -euo pipefail` in scripts.
- The extension must never block the compositor: no synchronous subprocesses or file I/O in hot paths, and no shell (`Gio.Subprocess` with an argv).
- Never let the renderer window get in the way: it must stay click-through, unfocused and invisible.
- Engine changes go into `patches/linux-wallpaperengine/` as small, upstreamable patches. Regenerate them with `git diff` in the engine checkout.
- CI runs syntax checks (`node --check`, `python3 -m py_compile`, `bash -n`, `shellcheck`); run them before pushing.

## Releases

1. Update `CHANGELOG.md` and bump `version` in the extension's `metadata.json`.
2. Tag `vX.Y.Z` and push the tag. The release workflow attaches the extension zip.
3. Upload the zip to [extensions.gnome.org](https://extensions.gnome.org/upload/) (see [docs/PUBLISHING.md](docs/PUBLISHING.md)).
