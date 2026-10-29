# Accessibility

Wayland Wallpaper Engine changes your desktop background. It should never get in the way of using your computer, including with assistive technology.

## What we do

- **Nothing to interact with by default.** The wallpaper window is hidden, click-through and never takes keyboard focus, so screen readers, keyboard navigation and focus order are unaffected.
- **Motion can be stopped.** By default the wallpaper pauses whenever an application is focused (`wwe config pause=focus`). `wwe stop` turns it off completely, and `wwe set` with a static image or a calm wallpaper reduces motion. Animated wallpapers can be a problem for people sensitive to motion or flashing; Wallpaper Engine content is made by third parties and is not reviewed for flashing.
- **Sound only when you ask for it.** Wallpaper audio plays only while the desktop is focused and can be muted (`wwe config silent=true`).
- **Everything works from the command line.** Every setting in the top bar picker is also available through `wwe`, which works with any terminal and screen reader.
- **The picker** is a regular GNOME Shell menu with labelled items and keyboard focus on the wallpaper tiles and search field.

## Known limitations

- Wallpaper thumbnails in the picker are images with the wallpaper title as text; the type (scene, video, web) is shown as a small badge.
- GNOME's "reduce animation" setting is not yet used to pause animated wallpapers automatically.

## Reporting barriers

If something in this project gets in your way, please [open an issue](https://github.com/BhuwanJoshi-01/wayland-wallpaperengine/issues/new/choose) and describe your setup (assistive technology, GNOME version) and what happened.
