#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Remove Wayland Wallpaper Engine.
#
#   ./uninstall.sh           keep your settings and the linux-wallpaperengine build
#   ./uninstall.sh --purge   remove those too
set -uo pipefail

UUID="wayland-wallpaperengine@bhuwanjoshi-01.github.io"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"

systemctl --user disable --now wwe.service 2>/dev/null
rm -f "$CONFIG/systemd/user/wwe.service"
systemctl --user daemon-reload

gnome-extensions disable "$UUID" 2>/dev/null
rm -rf "$DATA/gnome-shell/extensions/$UUID"
rm -f "$HOME/.local/bin/wwe"

if [[ "${1:-}" == "--purge" ]]; then
    rm -rf "$CONFIG/wwe" \
        "${XDG_CACHE_HOME:-$HOME/.cache}/wwe" \
        "$DATA/wayland-wallpaperengine" \
        "$HOME/.local/opt/linux-wallpaperengine"
fi
echo "Wayland Wallpaper Engine removed."
