#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Install Wayland Wallpaper Engine for the current user.
#
#   curl -fsSL https://raw.githubusercontent.com/BhuwanJoshi-01/wayland-wallpaperengine/main/install.sh | bash
#
# or from a checkout:
#
#   ./install.sh                 install (builds linux-wallpaperengine if missing)
#   ./install.sh --yes           do not ask before installing distribution packages
#   ./install.sh --rebuild       rebuild linux-wallpaperengine even if installed
#   ./install.sh --no-engine     skip linux-wallpaperengine (use your own build)
#   ./install.sh --dev           symlink files into place (for development)
set -euo pipefail

REPO_URL="${WWE_REPO_URL:-https://github.com/BhuwanJoshi-01/wayland-wallpaperengine.git}"
UUID="wayland-wallpaperengine@bhuwanjoshi-01.github.io"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == Linux ]] || die "this only works on Linux"
[[ $EUID -ne 0 ]] || die "run this as your normal user, not root (it asks for sudo when it needs it)"

# --- bootstrap: when piped from curl there is no checkout yet
SELF="${BASH_SOURCE[0]:-}"
if [[ -z "$SELF" || ! -f "$(dirname "$SELF")/bin/wwe" ]]; then
    command -v git >/dev/null || die "git is required (e.g. sudo apt install git)"
    SRC="${XDG_DATA_HOME:-$HOME/.local/share}/wayland-wallpaperengine/src"
    if [[ -d "$SRC/.git" ]]; then
        say "updating $SRC"
        git -C "$SRC" pull --ff-only --quiet
    else
        say "downloading Wayland Wallpaper Engine to $SRC"
        mkdir -p "$(dirname "$SRC")"
        git clone --quiet --depth 1 "$REPO_URL" "$SRC"
    fi
    # read prompts from the terminal, not from the curl pipe
    if [[ -r /dev/tty ]]; then
        exec bash "$SRC/install.sh" "$@" </dev/tty
    fi
    exec bash "$SRC/install.sh" "$@"
fi

REPO_DIR="$(cd "$(dirname "$SELF")" && pwd)"
# shellcheck source=scripts/deps.sh
source "$REPO_DIR/scripts/deps.sh"

BIN_DIR="$HOME/.local/bin"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENGINE="$HOME/.local/opt/linux-wallpaperengine/linux-wallpaperengine"

DEV=0 ENGINE_MODE=auto ASSUME_YES=0
for arg in "$@"; do
    case "$arg" in
        --dev) DEV=1 ;;
        --no-engine) ENGINE_MODE=skip ;;
        --rebuild) ENGINE_MODE=rebuild ;;
        -y|--yes) ASSUME_YES=1 ;;
        -h|--help) sed -n '4,15p' "$0"; exit 0 ;;
        *) die "unknown option: $arg" ;;
    esac
done

ask() { # ask <question>: default yes
    ((ASSUME_YES)) && return 0
    [[ -t 0 ]] || return 1
    local reply
    read -r -p "$1 [Y/n] " reply || return 1
    [[ -z "$reply" || "$reply" =~ ^[Yy] ]]
}

place() { # place <src> <dst>
    rm -rf "$2"
    if ((DEV)); then ln -s "$1" "$2"; else cp -r "$1" "$2"; fi
}

# --- environment checks
command -v systemctl >/dev/null || die "systemd is required (wwe runs as a systemd user service)"
DESKTOP="${XDG_CURRENT_DESKTOP:-}"
IS_GNOME=0
if [[ "$DESKTOP" == *GNOME* ]] || command -v gnome-shell >/dev/null; then
    IS_GNOME=1
    GNOME_MAJOR="$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
    if [[ -n "$GNOME_MAJOR" && ( "$GNOME_MAJOR" -lt 46 || "$GNOME_MAJOR" -gt 50 ) ]]; then
        warn "GNOME $GNOME_MAJOR detected; the extension supports GNOME 46-50 (tested on 50)"
    fi
fi
[[ "${XDG_SESSION_TYPE:-}" == wayland ]] || warn "not a Wayland session (XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-unset})"

# --- runtime packages
if [[ "$(deps_pm)" != unknown ]]; then
    missing_pkgs="$(deps_missing runtime)"
    if [[ -n "$missing_pkgs" ]]; then
        echo "Missing packages: $missing_pkgs"
        if ask "Install them now with sudo?"; then
            # shellcheck disable=SC2086
            deps_install $missing_pkgs
        else
            warn "continuing without: $missing_pkgs (video wallpapers need mpv, the dialog picker needs zenity)"
        fi
    fi
fi

# --- engine
if [[ "$ENGINE_MODE" == rebuild || ( "$ENGINE_MODE" == auto && ! -x "$ENGINE" ) ]]; then
    say "building linux-wallpaperengine (one time, ~10-20 minutes)"
    build_args=()
    ((ASSUME_YES)) && build_args+=(--yes)
    "$REPO_DIR/scripts/build-engine.sh" "${build_args[@]}"
fi

# --- files
say "installing wwe to $BIN_DIR"
mkdir -p "$BIN_DIR"
chmod +x "$REPO_DIR/bin/wwe"
place "$REPO_DIR/bin/wwe" "$BIN_DIR/wwe"

NEED_RELOGIN=0
if ((IS_GNOME)); then
    say "installing the GNOME Shell extension"
    mkdir -p "$EXT_DIR"
    place "$REPO_DIR/extension/$UUID" "$EXT_DIR/$UUID"
    if ! gnome-extensions enable "$UUID" 2>/dev/null; then
        # GNOME discovers new extensions only at login: pre-enable it for the next
        # session. Use dconf directly: a gsettings from conda or another prefix may
        # use a keyfile backend that GNOME Shell never reads.
        key=/org/gnome/shell/enabled-extensions
        current="$(dconf read "$key" 2>/dev/null || true)"
        if [[ "$current" != *"$UUID"* ]]; then
            if [[ -z "$current" || "$current" == "@as []" || "$current" == "[]" ]]; then
                dconf write "$key" "['$UUID']"
            else
                dconf write "$key" "${current%]}, '$UUID']"
            fi
        fi
        NEED_RELOGIN=1
    fi
fi

say "installing the systemd user service"
mkdir -p "$UNIT_DIR"
place "$REPO_DIR/systemd/wwe.service" "$UNIT_DIR/wwe.service"
systemctl --user daemon-reload
systemctl --user enable wwe.service >/dev/null 2>&1
if ((NEED_RELOGIN == 0)); then
    systemctl --user restart wwe.service || true
fi

case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) warn "$BIN_DIR is not in your PATH; add it (e.g. in ~/.profile) to use the wwe command" ;;
esac

echo
"$BIN_DIR/wwe" doctor || true
cat <<EOF

Done. Next:
  wwe list            your Wallpaper Engine workshop items (subscribe in Steam)
  wwe set <id>        apply one, or use the wallpaper icon in the top bar
  wwe doctor          check the setup
EOF
if ((NEED_RELOGIN)); then
    echo
    echo "Log out and back in once so GNOME Shell loads the extension; the wallpaper starts then."
fi
