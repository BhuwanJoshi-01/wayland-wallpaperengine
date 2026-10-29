#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Distribution packages needed to build linux-wallpaperengine and to run wwe.
# Sourced by install.sh and scripts/build-engine.sh.
#
#   deps_missing build|runtime   print the missing package names
#   deps_install <packages...>    install them with the system package manager (sudo)

deps_pm() {
    if command -v apt-get >/dev/null; then echo apt
    elif command -v dnf >/dev/null; then echo dnf
    elif command -v pacman >/dev/null; then echo pacman
    elif command -v zypper >/dev/null; then echo zypper
    else echo unknown
    fi
}

deps_list() { # deps_list build|runtime
    case "$(deps_pm):$1" in
        apt:build) echo build-essential cmake git pkg-config libxrandr-dev libxinerama-dev libxcursor-dev \
            libxi-dev libgl-dev libegl-dev libglew-dev freeglut3-dev libsdl2-dev liblz4-dev libavcodec-dev \
            libavformat-dev libavutil-dev libswscale-dev libxxf86vm-dev libglm-dev libglfw3-dev libmpv-dev \
            libpulse-dev libfftw3-dev libfreetype-dev libdbus-1-dev zlib1g-dev libwayland-dev \
            wayland-protocols libxkbcommon-dev ;;
        apt:runtime) echo python3 python3-gi mpv zenity dconf-cli ;;
        dnf:build) echo gcc gcc-c++ cmake git pkgconf-pkg-config libXrandr-devel libXinerama-devel \
            libXcursor-devel libXi-devel mesa-libGL-devel mesa-libEGL-devel glew-devel freeglut-devel \
            SDL2-devel lz4-devel ffmpeg-free-devel libXxf86vm-devel glm-devel glfw-devel mpv-devel \
            pulseaudio-libs-devel fftw-devel freetype-devel dbus-devel zlib-devel wayland-devel \
            wayland-protocols-devel libxkbcommon-devel ;;
        dnf:runtime) echo python3 python3-gobject mpv zenity dconf ;;
        pacman:build) echo base-devel cmake git pkgconf libxrandr libxinerama libxcursor libxi libxxf86vm \
            mesa glew freeglut sdl2 lz4 ffmpeg glm glfw mpv libpulse fftw freetype2 dbus zlib wayland \
            wayland-protocols libxkbcommon ;;
        pacman:runtime) echo python python-gobject mpv zenity dconf ;;
        zypper:build) echo gcc-c++ cmake git pkgconf libXrandr-devel libXinerama-devel libXcursor-devel \
            libXi-devel Mesa-libGL-devel Mesa-libEGL-devel glew-devel freeglut-devel SDL2-devel liblz4-devel \
            ffmpeg-devel libXxf86vm-devel glm-devel libglfw-devel mpv-devel libpulse-devel fftw3-devel \
            freetype2-devel dbus-1-devel zlib-devel wayland-devel wayland-protocols-devel libxkbcommon-devel ;;
        zypper:runtime) echo python3 python3-gobject mpv zenity dconf ;;
    esac
}

deps_installed() { # deps_installed <package>
    case "$(deps_pm)" in
        apt) dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed" ;;
        dnf|zypper) rpm -q --whatprovides "$1" >/dev/null 2>&1 ;;
        pacman) pacman -Qi "$1" >/dev/null 2>&1 || pacman -Qg "$1" >/dev/null 2>&1 ;;
        *) return 0 ;;
    esac
}

deps_missing() { # deps_missing build|runtime
    local p missing=()
    for p in $(deps_list "$1"); do
        deps_installed "$p" || missing+=("$p")
    done
    echo "${missing[*]}"
}

deps_install() { # deps_install <packages...>
    case "$(deps_pm)" in
        apt) sudo apt-get update && sudo apt-get install -y "$@" ;;
        dnf) sudo dnf install -y "$@" ;;
        pacman) sudo pacman -S --needed --noconfirm "$@" ;;
        zypper) sudo zypper install -y "$@" ;;
        *) echo "Unknown package manager: install these yourself: $*" >&2; return 1 ;;
    esac
}
