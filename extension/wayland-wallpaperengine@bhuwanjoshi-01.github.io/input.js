// Wayland Wallpaper Engine - input and audio bridge
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The renderer window is hidden, so it never receives pointer events and has
// no idea whether the desktop is in front. This module tells it:
//
//   * pointer position (always, for parallax / cursor effects) and button
//     state (only for presses that start on the desktop) - sent ~60 times a
//     second to the patched linux-wallpaperengine over its control socket
//     (WWE_CONTROL_SOCKET, see patches/0002-external-control-socket.patch)
//   * mute / unmute: wallpaper audio plays only while the desktop is focused,
//     like Wallpaper Engine on Windows. linux-wallpaperengine gets "M 0|1" on
//     the same socket, mpv a JSON IPC command.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const CONTROL_DIR = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'wwe']);
const ENGINE_SOCKET = GLib.build_filenamev([CONTROL_DIR, 'engine.sock']);
const MPV_SOCKET = GLib.build_filenamev([CONTROL_DIR, 'mpv.sock']);

const ENGINE_APP_ID = 'linux-wallpaperengine';
const MPV_APP_ID = 'wwe-video';

const POINTER_POLL_MS = 16;
// renderers bind their socket during startup; re-send the audio state a few
// times after one appears in case the first message raced the bind
const AUDIO_RESYNC_DELAYS_MS = [300, 1500, 4000];

const encoder = new TextEncoder();

// The desktop itself: a DESKTOP-type window, or the window of the Desktop
// Icons (DING) extension, which cannot set that type on Wayland.
export function isDesktopWindow(win) {
    if (!win)
        return false;
    if (win.get_window_type() === Meta.WindowType.DESKTOP)
        return true;
    return win.get_wm_class() === 'gjs' && (win.get_title() ?? '').startsWith('Desktop Icons');
}

export class InputBridge {
    constructor({getRenderers, desktopActive}) {
        this._getRenderers = getRenderers;
        this._desktopActive = desktopActive;
    }

    enable() {
        this._paused = false;
        this._muted = null;
        this._pressed = 0;
        this._pressOnDesktop = false;
        this._last = null;
        this._pollId = 0;
        this._resyncIds = new Set();

        this._engineAddress = Gio.UnixSocketAddress.new(ENGINE_SOCKET);
        this._socket = Gio.Socket.new(Gio.SocketFamily.UNIX, Gio.SocketType.DATAGRAM,
            Gio.SocketProtocol.DEFAULT);
        // never stall the compositor on a full socket (e.g. renderer SIGSTOPped)
        this._socket.set_blocking(false);

        this._signals = [
            [global.display, global.display.connect('notify::focus-window', () => this._syncAudio())],
            [Main.overview, Main.overview.connect('showing', () => this._syncAudio())],
            [Main.overview, Main.overview.connect('hidden', () => this._syncAudio())],
            [Main.sessionMode, Main.sessionMode.connect('updated', () => this.update())],
        ];

        this.update();
    }

    disable() {
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];

        this._stopPolling();
        for (const id of this._resyncIds)
            GLib.source_remove(id);
        this._resyncIds.clear();

        this._socket.close();
        this._socket = null;
    }

    // renderer added/removed, or session state changed
    update() {
        const wantPolling = !this._paused && !Main.sessionMode.isLocked && this._engineWindow() !== null;
        if (wantPolling && !this._pollId) {
            this._last = null;
            this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POINTER_POLL_MS, () => {
                this._pollPointer();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!wantPolling) {
            this._stopPolling();
        }
        this._syncAudio(true);
    }

    rendererAdded() {
        this.update();
        for (const delay of AUDIO_RESYNC_DELAYS_MS) {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._resyncIds.delete(id);
                this._syncAudio(true);
                return GLib.SOURCE_REMOVE;
            });
            this._resyncIds.add(id);
        }
    }

    setPaused(paused) {
        if (this._paused === paused)
            return;
        this._paused = paused;
        this.update();
    }

    _stopPolling() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
    }

    _engineWindow() {
        return this._getRenderers().find(w => w.get_wm_class() === ENGINE_APP_ID) ?? null;
    }

    // ------------------------------------------------------------------
    // pointer
    // ------------------------------------------------------------------

    _pollPointer() {
        const win = this._engineWindow();
        if (!win)
            return;

        const [x, y, mods] = global.get_pointer();
        const pressed =
            (mods & Clutter.ModifierType.BUTTON1_MASK ? 1 : 0) |
            (mods & Clutter.ModifierType.BUTTON3_MASK ? 2 : 0);

        // decide once per press whether it belongs to the wallpaper, so drags
        // that start on a window never click the wallpaper (and vice versa)
        if (pressed && !this._pressed)
            this._pressOnDesktop = this._pointerOnDesktop(x, y);
        this._pressed = pressed;
        const buttons = this._pressOnDesktop ? pressed : 0;

        const rect = win.get_frame_rect();
        const message = `P ${x - rect.x} ${y - rect.y} ${buttons}`;
        if (message === this._last)
            return;
        this._last = message;
        this._sendEngine(message);
    }

    _pointerOnDesktop(x, y) {
        const actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        for (let a = actor; a; a = a.get_parent()) {
            if (a instanceof Meta.WindowActor)
                return isDesktopWindow(a.meta_window);
            if (a === Main.layoutManager._backgroundGroup)
                return true;
        }
        return actor === global.stage;
    }

    // ------------------------------------------------------------------
    // audio
    // ------------------------------------------------------------------

    _syncAudio(force = false) {
        if (!this._socket)
            return;
        const muted = !this._desktopActive();
        if (!force && muted === this._muted)
            return;
        this._muted = muted;

        for (const win of this._getRenderers()) {
            const appId = win.get_wm_class();
            if (appId === ENGINE_APP_ID)
                this._sendEngine(`M ${muted ? 1 : 0}`);
            else if (appId === MPV_APP_ID)
                this._sendMpv(['set_property', 'mute', muted]);
        }
    }

    // ------------------------------------------------------------------
    // transports
    // ------------------------------------------------------------------

    _sendEngine(text) {
        try {
            this._socket.send_to(this._engineAddress, encoder.encode(text), null);
        } catch {
            // renderer not listening (yet), or its queue is full
        }
    }

    _sendMpv(command) {
        const client = new Gio.SocketClient();
        client.connect_async(Gio.UnixSocketAddress.new(MPV_SOCKET), null, (c, res) => {
            try {
                const conn = c.connect_finish(res);
                conn.get_output_stream().write_all(
                    encoder.encode(`${JSON.stringify({command})}\n`), null);
                conn.close(null);
            } catch {
                // mpv not listening (yet)
            }
        });
    }
}
