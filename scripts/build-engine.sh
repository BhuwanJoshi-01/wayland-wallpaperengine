#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Fetch, patch, build and install linux-wallpaperengine (Almamu) into
# ~/.local/opt/linux-wallpaperengine.
#
#   scripts/build-engine.sh            # pinned, tested commit
#   ENGINE_REF=main scripts/build-engine.sh
#   ENGINE_SRC=~/src/linux-wallpaperengine scripts/build-engine.sh   # reuse a checkout
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_URL="${ENGINE_URL:-https://github.com/Almamu/linux-wallpaperengine.git}"
# last commit tested with this project
ENGINE_REF="${ENGINE_REF:-b016d7d1fdcf4e5fd2f9c9fa420a8aaa07fee02d}"
ENGINE_SRC="${ENGINE_SRC:-${XDG_CACHE_HOME:-$HOME/.cache}/wwe/linux-wallpaperengine}"
PREFIX="${PREFIX:-$HOME/.local/opt/linux-wallpaperengine}"
JOBS="${JOBS:-$(( $(nproc) > 2 ? $(nproc) - 2 : 1 ))}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

check_deps() {
    local missing=()
    if command -v dpkg >/dev/null; then
        local pkgs=(build-essential cmake git pkg-config libxrandr-dev libxinerama-dev libxcursor-dev
            libxi-dev libgl-dev libglew-dev freeglut3-dev libsdl2-dev liblz4-dev libavcodec-dev
            libavformat-dev libavutil-dev libswscale-dev libxxf86vm-dev libglm-dev libglfw3-dev
            libmpv-dev libpulse-dev libfftw3-dev libfreetype-dev libdbus-1-dev zlib1g-dev
            libwayland-dev wayland-protocols libxkbcommon-dev libegl-dev)
        for p in "${pkgs[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
        if ((${#missing[@]})); then
            echo "Missing build dependencies. Install them with:"
            echo "  sudo apt install ${missing[*]}"
            exit 1
        fi
    else
        say "non-Debian system: make sure the dependencies from the linux-wallpaperengine README are installed"
    fi
}

check_deps

if [[ -d "$ENGINE_SRC/.git" ]]; then
    say "using existing checkout $ENGINE_SRC"
    git -C "$ENGINE_SRC" fetch --quiet origin || true
else
    say "cloning $ENGINE_URL"
    mkdir -p "$(dirname "$ENGINE_SRC")"
    git clone --quiet "$ENGINE_URL" "$ENGINE_SRC"
fi

cd "$ENGINE_SRC"
# drop our previously applied patches before moving to the requested ref
git checkout --quiet -- . 2>/dev/null || true
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
        echo "patch $(basename "$patch") does not apply to $ENGINE_REF" >&2
        exit 1
    fi
done

say "configuring (first run downloads CEF, ~300 MB)"
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" >/dev/null

say "building with $JOBS jobs"
nice -n 10 cmake --build build -j "$JOBS"

say "installing to $PREFIX"
rm -rf "$PREFIX"
cmake --install build --strip >/dev/null
# CEF ships unstripped (~1.4 GB); stripping brings the install to ~330 MB
strip --strip-unneeded "$PREFIX"/libcef.so "$PREFIX"/libEGL.so "$PREFIX"/libGLESv2.so \
    "$PREFIX"/libvk_swiftshader.so 2>/dev/null || true
# test/benchmark binaries from bundled submodules
( cd "$PREFIX" && rm -rf api-test bm_* fast*-float ffr-float fft-float psdpng-float st-float \
    testcpp-float tkfc-float tr-float run-test262 include function_source )

say "done: $PREFIX/linux-wallpaperengine"
