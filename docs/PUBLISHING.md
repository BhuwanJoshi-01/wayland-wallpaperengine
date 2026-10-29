# Publishing (maintainers)

## GitHub release

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

The `release` workflow builds `wayland-wallpaperengine@bhuwanjoshi-01.github.io.shell-extension.zip` (`scripts/pack-extension.sh`) and attaches it to the GitHub release.

## extensions.gnome.org

1. Build the zip: `scripts/pack-extension.sh` (output in `dist/`).
2. Log in at <https://extensions.gnome.org/upload/> and upload it.
3. Review notes worth mentioning in the upload form:
   - The extension needs the `wwe` tool and linux-wallpaperengine from this repository. It shows nothing on its own, and its description says so.
   - It spawns `kill(1)` through `Gio.Subprocess` (no shell) to pause and resume its own renderer processes, and runs `wwe` from the picker.
   - It overrides some shell methods through `InjectionManager` to hide the renderer window (overview, alt-tab, docks), and restores them in `disable()`.
   - It keeps running in the `unlock-dialog` session mode so the lock screen shows the live background. The picker is hidden there.

Each new version needs the `version` in `metadata.json` bumped before upload.

## Spreading the word

Good places to announce a release: r/wallpaperengine, r/gnome, r/linux, r/linux_gaming, the Wallpaper Engine Steam discussions (Linux threads), and the linux-wallpaperengine GitHub discussions. Show a short screen recording of the desktop, the picker and the pause behaviour.
