#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Remove Wayland Wallpaper Engine.  --purge also deletes the config and the
# built linux-wallpaperengine.
set -uo pipefail

UUID="wayland-wallpaperengine@bhuwanjoshi-01.github.io"

systemctl --user disable --now wwe.service 2>/dev/null
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/wwe.service"
systemctl --user daemon-reload

gnome-extensions disable "$UUID" 2>/dev/null
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
rm -f "$HOME/.local/bin/wwe"

if [[ "${1:-}" == "--purge" ]]; then
    rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/wwe" \
        "${XDG_CACHE_HOME:-$HOME/.cache}/wwe" \
        "$HOME/.local/opt/linux-wallpaperengine"
fi
echo "uninstalled"
