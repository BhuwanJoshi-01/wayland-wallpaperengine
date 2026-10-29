#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Fetch, patch, build and install linux-wallpaperengine (Almamu) into
# ~/.local/opt/linux-wallpaperengine.
#
#   scripts/build-engine.sh                 pinned, tested commit
#   scripts/build-engine.sh --yes           install missing build packages without asking
#   ENGINE_REF=main scripts/build-engine.sh
#   ENGINE_SRC=~/src/linux-wallpaperengine scripts/build-engine.sh   reuse a checkout
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/deps.sh
source "$REPO_DIR/scripts/deps.sh"

ENGINE_URL="${ENGINE_URL:-https://github.com/Almamu/linux-wallpaperengine.git}"
# last upstream commit tested with this project
ENGINE_REF="${ENGINE_REF:-b016d7d1fdcf4e5fd2f9c9fa420a8aaa07fee02d}"
ENGINE_SRC="${ENGINE_SRC:-${XDG_CACHE_HOME:-$HOME/.cache}/wwe/linux-wallpaperengine}"
PREFIX="${PREFIX:-$HOME/.local/opt/linux-wallpaperengine}"
JOBS="${JOBS:-$(( $(nproc) > 2 ? $(nproc) - 2 : 1 ))}"

ASSUME_YES=0
for arg in "$@"; do
    case "$arg" in
        -y|--yes) ASSUME_YES=1 ;;
        -h|--help) sed -n '4,11p' "$0"; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 1 ;;
    esac
done

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

ask() { # ask <question>: true for yes (default yes, reads the terminal even when piped)
    ((ASSUME_YES)) && return 0
    [[ -r /dev/tty ]] || return 1
    local reply
    read -r -p "$1 [Y/n] " reply </dev/tty || return 1
    [[ -z "$reply" || "$reply" =~ ^[Yy] ]]
}

# --- build dependencies
if [[ "$(deps_pm)" == unknown ]]; then
    say "unknown distribution: make sure the build dependencies from the linux-wallpaperengine README are installed"
else
    missing="$(deps_missing build)"
    if [[ -n "$missing" ]]; then
        echo "Missing build packages: $missing"
        if ask "Install them now with sudo?"; then
            # shellcheck disable=SC2086
            deps_install $missing
        else
            die "install the packages above and run this again"
        fi
    fi
fi

# --- source
if [[ -d "$ENGINE_SRC/.git" ]]; then
    say "using existing checkout $ENGINE_SRC"
    git -C "$ENGINE_SRC" fetch --quiet origin || true
else
    say "cloning $ENGINE_URL"
    mkdir -p "$(dirname "$ENGINE_SRC")"
    git clone --quiet "$ENGINE_URL" "$ENGINE_SRC"
fi

cd "$ENGINE_SRC" || exit 1
# drop previously applied patches (tracked and new files) before switching refs
git checkout --quiet -- . 2>/dev/null || true
git clean --quiet -fd -- src 2>/dev/null || true
git checkout --quiet "$ENGINE_REF"
git submodule update --init --recursive --quiet

for patch in "$REPO_DIR"/patches/linux-wallpaperengine/*.patch; do
    [[ -e "$patch" ]] || continue
    if git apply --check "$patch" 2>/dev/null; then
        say "applying $(basename "$patch")"
        git apply "$patch"
    elif git apply --reverse --check "$patch" 2>/dev/null; then
        say "already applied: $(basename "$patch")"
    else
        die "patch $(basename "$patch") does not apply to $ENGINE_REF"
    fi
done

# --- build
say "configuring (the first run downloads CEF, ~300 MB)"
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" >/dev/null

say "building with $JOBS jobs (this takes a while)"
nice -n 10 cmake --build build -j "$JOBS"

# --- install
say "installing to $PREFIX"
rm -rf "$PREFIX"
cmake --install build --strip >/dev/null

# CEF ships unstripped (~1.4 GB); stripping brings the install to ~330 MB
strip --strip-unneeded "$PREFIX"/libcef.so "$PREFIX"/libEGL.so "$PREFIX"/libGLESv2.so \
    "$PREFIX"/libvk_swiftshader.so 2>/dev/null || true

# CEF aborts (SIGTRAP) when icudtl.dat sits in the same directory as
# libcef.so, which is what the upstream install produces: web wallpapers then
# crash on start. Keep the resources next to the executable and move libcef
# with its own libraries into lib/ (already in the binaries' RUNPATH).
mkdir -p "$PREFIX/lib"
for f in libcef.so libEGL.so libGLESv2.so libvk_swiftshader.so vk_swiftshader_icd.json chrome-sandbox; do
    [[ -e "$PREFIX/$f" ]] && mv "$PREFIX/$f" "$PREFIX/lib/"
done
[[ -e "$PREFIX/v8_context_snapshot.bin" ]] && cp "$PREFIX/v8_context_snapshot.bin" "$PREFIX/lib/"
# install(DIRECTORY) drops the executable bit
[[ -e "$PREFIX/lib/chrome-sandbox" ]] && chmod 0755 "$PREFIX/lib/chrome-sandbox"

# test/benchmark binaries and headers from bundled submodules
( cd "$PREFIX" && rm -rf api-test bm_* fast*-float ffr-float fft-float psdpng-float st-float \
    testcpp-float tkfc-float tr-float run-test262 function_source include )

"$PREFIX/linux-wallpaperengine" --help >/dev/null 2>&1 || die "the installed engine does not start; see the output above"
say "done: $PREFIX/linux-wallpaperengine"
