#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Install Wayland Wallpaper Engine for the current user.
#
#   ./install.sh              build linux-wallpaperengine if missing, install everything
#   ./install.sh --dev        symlink files into place (edit the repo, changes apply live)
#   ./install.sh --no-engine  skip building linux-wallpaperengine
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="wayland-wallpaperengine@bhuwanjoshi-01.github.io"
BIN_DIR="$HOME/.local/bin"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENGINE="$HOME/.local/opt/linux-wallpaperengine/linux-wallpaperengine"

DEV=0
BUILD_ENGINE=1
for arg in "$@"; do
    case "$arg" in
        --dev) DEV=1 ;;
        --no-engine) BUILD_ENGINE=0 ;;
        -h|--help) sed -n '4,9p' "$0"; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 1 ;;
    esac
done

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

place() { # place <src> <dst>
    rm -rf "$2"
    if ((DEV)); then ln -s "$1" "$2"; else cp -r "$1" "$2"; fi
}

if ((BUILD_ENGINE)) && [[ ! -x "$ENGINE" ]]; then
    say "building linux-wallpaperengine"
    "$REPO_DIR/scripts/build-engine.sh"
fi

say "installing wwe to $BIN_DIR"
mkdir -p "$BIN_DIR"
place "$REPO_DIR/bin/wwe" "$BIN_DIR/wwe"
chmod +x "$REPO_DIR/bin/wwe"

if [[ "${XDG_CURRENT_DESKTOP:-}" == *GNOME* ]] || command -v gnome-shell >/dev/null; then
    say "installing GNOME Shell extension $UUID"
    mkdir -p "$EXT_DIR"
    place "$REPO_DIR/extension/$UUID" "$EXT_DIR/$UUID"
    if ! gnome-extensions enable "$UUID" 2>/dev/null; then
        # GNOME only discovers new extensions at login; pre-enable it for the next session.
        # Talk to dconf directly: a gsettings from conda/other prefixes may use a
        # keyfile backend that GNOME Shell never reads.
        KEY=/org/gnome/shell/enabled-extensions
        current=$(dconf read "$KEY")
        if [[ "$current" != *"$UUID"* ]]; then
            if [[ -z "$current" || "$current" == "@as []" || "$current" == "[]" ]]; then
                dconf write "$KEY" "['$UUID']"
            else
                dconf write "$KEY" "${current%]}, '$UUID']"
            fi
        fi
        NEED_RELOGIN=1
    fi
fi

say "installing systemd user service"
mkdir -p "$UNIT_DIR"
place "$REPO_DIR/systemd/wwe.service" "$UNIT_DIR/wwe.service"
systemctl --user daemon-reload
systemctl --user enable wwe.service >/dev/null 2>&1

command -v mpv >/dev/null || echo "note: install mpv for video wallpapers on GNOME:  sudo apt install mpv"

echo
"$BIN_DIR/wwe" doctor || true
echo
echo "Next:"
echo "  wwe list              # your subscribed Wallpaper Engine items"
echo "  wwe set <id>          # apply one (or: wwe pick)"
if [[ "${NEED_RELOGIN:-0}" == 1 ]]; then
    echo
    echo "Log out and back in once so GNOME Shell loads the extension."
fi
