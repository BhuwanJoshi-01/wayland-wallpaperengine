#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Build the GNOME Shell extension zip for extensions.gnome.org / GitHub releases.
# Output: dist/<uuid>.shell-extension.zip
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="wayland-wallpaperengine@bhuwanjoshi-01.github.io"
SRC="$REPO_DIR/extension/$UUID"
OUT="$REPO_DIR/dist"

mkdir -p "$OUT"
rm -f "$OUT/$UUID.shell-extension.zip"
( cd "$SRC" && zip -q -r -X "$OUT/$UUID.shell-extension.zip" metadata.json ./*.js stylesheet.css )
cp "$REPO_DIR/LICENSE" "$OUT/LICENSE" && ( cd "$OUT" && zip -q "$UUID.shell-extension.zip" LICENSE && rm LICENSE )
echo "$OUT/$UUID.shell-extension.zip"
