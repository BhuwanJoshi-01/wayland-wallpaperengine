# Security Policy

## Supported versions

Only the latest release and the `main` branch receive fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub instead:
**Security → Report a vulnerability** on this repository
(<https://github.com/BhuwanJoshi-01/wayland-wallpaperengine/security/advisories/new>).

Include what you found, how to reproduce it, and the impact you expect. You will get an answer within a week, and a fix or mitigation as soon as possible after that.

## Scope

Relevant areas include:

- the GNOME Shell extension, which runs inside your session's compositor;
- the renderer control socket (`$XDG_RUNTIME_DIR/wwe/engine.sock`, mode `0600`) and mpv's IPC socket;
- `install.sh` and the scripts it runs;
- the handling of Wallpaper Engine workshop content (wallpapers are third-party content: web wallpapers run JavaScript inside the bundled Chromium Embedded Framework).

Vulnerabilities in linux-wallpaperengine itself, mpv or CEF should also be reported upstream to those projects.
