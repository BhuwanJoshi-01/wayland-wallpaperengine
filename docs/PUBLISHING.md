# Publishing (maintainers)

## GitHub release

```bash
git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z
awk -v v=X.Y.Z '$0 ~ "^## "v" " {p=1; next} /^## / {p=0} p' CHANGELOG.md > /tmp/notes.md
gh release create vX.Y.Z --title vX.Y.Z --notes-file /tmp/notes.md
```

Publishing the release triggers the `release` workflow, which builds `wayland-wallpaperengine@bhuwanjoshi-01.github.io.shell-extension.zip` (`scripts/pack-extension.sh`) and attaches it.

## extensions.gnome.org

1. Build the zip: `scripts/pack-extension.sh` (output in `dist/`), or download it from the GitHub release.
   It must pass [Shexli](https://pypi.org/project/shexli/) with no findings (CI checks this):
   `python3 -m venv /tmp/shexli && /tmp/shexli/bin/pip install shexli "tree-sitter<0.26" && /tmp/shexli/bin/shexli "$PWD/dist/<uuid>.shell-extension.zip"`
2. Log in at <https://extensions.gnome.org/upload/> and upload it.
3. Review notes worth mentioning in the upload form:
   - The extension needs the `wwe` tool and linux-wallpaperengine from this repository. It shows nothing on its own, and its description says so.
   - It spawns `kill(1)` through `Gio.Subprocess` (no shell) to pause and resume its own renderer processes, and runs `wwe` from the picker.
   - It overrides some shell methods through `InjectionManager` to hide the renderer window (overview, alt-tab, docks), and restores them in `disable()`.
   - It keeps running in the `unlock-dialog` session mode so the lock screen shows the live background. The picker is hidden there.

Each new version needs the `version` in `metadata.json` bumped before upload.

## Spreading the word

Good places to announce a release: r/wallpaperengine, r/gnome, r/linux, r/linux_gaming, the Wallpaper Engine Steam discussions (Linux threads), and the linux-wallpaperengine GitHub discussions. Show a short screen recording of the desktop, the picker and the pause behaviour.
