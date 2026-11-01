// Wayland Wallpaper Engine - pointer and audio for the hidden renderer
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The renderer window never receives input and cannot tell whether the
// desktop is in front, so this module tells it:
//   * the pointer position (parallax, cursor effects) and buttons, for presses
//     that start on the desktop: "P x y buttons" on engine.sock
//   * mute while the desktop is not focused: "M 0|1" on engine.sock, or the
//     mute property over mpv's JSON IPC

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DatagramSender, runtimePath} from './control-socket.js';
import {ENGINE_APP_ID, VIDEO_APP_ID, desktopActive, isDesktopWindow} from './renderer.js';

const POINTER_POLL_MS = 16;
// a renderer binds its socket during startup: repeat the mute state for a
// while after one appears, in case the first message came too early
const AUDIO_RESYNC_INTERVAL_MS = 500;
const AUDIO_RESYNC_COUNT = 8;

const encoder = new TextEncoder();

export class InputBridge {
    constructor(tracker) {
        this._tracker = tracker;
        this._paused = false;
        this._muted = null;
        this._pressedButtons = 0;
        this._pressStartedOnDesktop = false;
        this._lastPointerMessage = null;
        this._knownRenderers = new Set();
        this._pollId = 0;
        this._resyncId = 0;
        this._engine = new DatagramSender('engine.sock');
        this._mpvCancellable = new Gio.Cancellable();

        const syncAudio = () => this._syncAudio();
        this._signals = [
            [global.display, global.display.connect('notify::focus-window', syncAudio)],
            [Main.overview, Main.overview.connect('showing', syncAudio)],
            [Main.overview, Main.overview.connect('hidden', syncAudio)],
            [Main.sessionMode, Main.sessionMode.connect('updated', () => this.update())],
        ];
    }

    destroy() {
        this._stopPolling();
        this._stopAudioResync();
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        this._mpvCancellable.cancel();
        this._engine.close();
    }

    // renderers or session state changed
    update() {
        const renderers = new Set(this._tracker.windows);
        const added = [...renderers].some(win => !this._knownRenderers.has(win));
        this._knownRenderers = renderers;

        const wantPolling = !this._paused && !Main.sessionMode.isLocked && this._engineWindow() !== null;
        if (wantPolling && !this._pollId)
            this._startPolling();
        else if (!wantPolling)
            this._stopPolling();

        this._syncAudio(true);
        if (added)
            this._startAudioResync();
    }

    setPaused(paused) {
        if (this._paused === paused)
            return;
        this._paused = paused;
        this.update();
    }

    _engineWindow() {
        return this._tracker.windows.find(win => win.get_wm_class() === ENGINE_APP_ID) ?? null;
    }

    _startPolling() {
        this._stopPolling();
        this._lastPointerMessage = null;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POINTER_POLL_MS, () => {
            this._sendPointer();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling() {
        if (this._pollId) {
            GLib.Source.remove(this._pollId);
            this._pollId = 0;
        }
    }

    _startAudioResync() {
        this._stopAudioResync();
        let remaining = AUDIO_RESYNC_COUNT;
        this._resyncId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUDIO_RESYNC_INTERVAL_MS, () => {
            this._syncAudio(true);
            remaining--;
            if (remaining > 0)
                return GLib.SOURCE_CONTINUE;
            this._resyncId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopAudioResync() {
        if (this._resyncId) {
            GLib.Source.remove(this._resyncId);
            this._resyncId = 0;
        }
    }

    _sendPointer() {
        const win = this._engineWindow();
        if (!win)
            return;

        const [x, y, mods] = global.get_pointer();
        const pressed =
            (mods & Clutter.ModifierType.BUTTON1_MASK ? 1 : 0) |
            (mods & Clutter.ModifierType.BUTTON3_MASK ? 2 : 0);

        // decided once per press, so a drag that starts on a window never
        // clicks the wallpaper, and the other way round
        if (pressed && !this._pressedButtons)
            this._pressStartedOnDesktop = this._pointerOnDesktop(x, y);
        this._pressedButtons = pressed;
        const buttons = this._pressStartedOnDesktop ? pressed : 0;

        const rect = win.get_frame_rect();
        const message = `P ${x - rect.x} ${y - rect.y} ${buttons}`;
        if (message === this._lastPointerMessage)
            return;
        this._lastPointerMessage = message;
        this._engine.send(message);
    }

    _pointerOnDesktop(x, y) {
        const actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        for (let a = actor; a; a = a.get_parent()) {
            if (a instanceof Meta.WindowActor)
                return isDesktopWindow(a.meta_window);
            if (a instanceof Meta.BackgroundGroup)
                return true;
        }
        return actor === global.stage;
    }

    _syncAudio(force = false) {
        const muted = !desktopActive();
        if (!force && muted === this._muted)
            return;
        this._muted = muted;

        for (const win of this._tracker.windows) {
            const appId = win.get_wm_class();
            if (appId === ENGINE_APP_ID)
                this._engine.send(`M ${muted ? 1 : 0}`);
            else if (appId === VIDEO_APP_ID)
                this._sendMpv(['set_property', 'mute', muted]);
        }
    }

    _sendMpv(command) {
        const client = new Gio.SocketClient();
        const address = Gio.UnixSocketAddress.new(runtimePath('mpv.sock'));
        client.connect_async(address, this._mpvCancellable, (_client, result) => {
            try {
                const connection = client.connect_finish(result);
                connection.get_output_stream().write_all(encoder.encode(`${JSON.stringify({command})}\n`), null);
                connection.close(null);
            } catch {
                // mpv is not listening (yet), or this was cancelled
            }
        });
    }
}
