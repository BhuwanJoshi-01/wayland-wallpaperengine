// Wayland Wallpaper Engine - pausing the renderer while nobody looks at it
// SPDX-License-Identifier: GPL-3.0-or-later
//
// A paused renderer uses no CPU or GPU, and without new frames GNOME Shell has
// nothing to repaint; the clones keep showing the last frame. The extension
// decides when to pause and asks `wwe run`, which owns the renderer process,
// to stop or continue it ("pause <pid>" / "resume <pid>" on supervisor.sock).
//
// With several monitors, a monitor without windows still shows the wallpaper,
// so its renderer keeps playing while an app is focused on another monitor
// (muted: input.js plays sound only while the desktop is focused).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DatagramSender} from './control-socket.js';
import {EmptyMonitors} from './monitors.js';
import {desktopActive, isRenderer} from './renderer.js';

// wwe's config; the extension only reads "pause":
//   "focus"      (default) play while the desktop is focused, and on monitors
//                without windows
//   "fullscreen" pause only while another window is fullscreen
//   "never"
const CONFIG_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'wwe', 'config.json']);
const PAUSE_MODES = new Set(['focus', 'fullscreen', 'never']);

export class PauseController {
    constructor(tracker, onPausedChanged) {
        this._tracker = tracker;
        this._onPausedChanged = onPausedChanged;
        this._mode = 'focus';
        this._paused = false;
        this._stoppedPids = new Set();
        this._supervisor = new DatagramSender('supervisor.sock');
        this._reportedUnreachable = false;

        this._configFile = Gio.File.new_for_path(CONFIG_PATH);
        this._configCancellable = new Gio.Cancellable();
        this._configMonitor = this._configFile.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._configMonitorId = this._configMonitor.connect('changed', () => this._loadConfig());

        const update = () => this.update();
        this._signals = [
            [global.display, global.display.connect('in-fullscreen-changed', update)],
            [global.display, global.display.connect('notify::focus-window', update)],
            [global.workspace_manager, global.workspace_manager.connect('active-workspace-changed', update)],
            [Main.overview, Main.overview.connect('showing', update)],
            [Main.overview, Main.overview.connect('hidden', update)],
            [Main.sessionMode, Main.sessionMode.connect('updated', update)],
        ];
        this._emptyMonitors = new EmptyMonitors(update);

        this._loadConfig();
    }

    destroy() {
        this._configCancellable.cancel();
        this._configMonitor.disconnect(this._configMonitorId);
        this._configMonitor.cancel();
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        this._emptyMonitors.destroy();
        this._emptyMonitors = null;

        // never leave a renderer frozen
        for (const pid of this._stoppedPids)
            this._supervisor.send(`resume ${pid}`);
        this._stoppedPids.clear();
        this._supervisor.close();
    }

    update() {
        const playing = this._playingRenderers();
        const pause = playing.size === 0;
        if (pause !== this._paused) {
            this._paused = pause;
            this._onPausedChanged(pause);
        }

        const runningPids = new Set();
        for (const win of this._tracker.windows) {
            const pid = win.get_pid();
            if (pid <= 0)
                continue;
            runningPids.add(pid);
            // a renderer still waiting for its first frame must keep running
            const stop = !playing.has(win) && this._tracker.isReady(win);
            if (stop && !this._stoppedPids.has(pid)) {
                if (this._sendToSupervisor(`pause ${pid}`))
                    this._stoppedPids.add(pid);
            } else if (!stop && this._stoppedPids.has(pid)) {
                this._sendToSupervisor(`resume ${pid}`);
                this._stoppedPids.delete(pid);
            }
        }
        for (const pid of [...this._stoppedPids]) {
            if (!runningPids.has(pid))
                this._stoppedPids.delete(pid);
        }
    }

    // The renderer windows that should play now.
    _playingRenderers() {
        const all = new Set(this._tracker.windows);
        if (this._mode === 'never')
            return all;
        // a fullscreen app (a game) pauses every monitor
        if (Main.sessionMode.isLocked || this._fullscreenApp())
            return new Set();
        if (this._mode === 'fullscreen' || desktopActive())
            return all;
        // An app is focused, or the overview is open (it covers every monitor).
        if (Main.overview.visible)
            return new Set();
        // Monitors without windows still show the wallpaper.
        const shown = this._emptyMonitors.indices.map(i => this._tracker.windowFor(i));
        return new Set(shown.filter(win => win !== null));
    }

    // The renderer windows are fullscreen too; only other visible fullscreen
    // windows on the current workspace count.
    _fullscreenApp() {
        const workspace = global.workspace_manager.get_active_workspace();
        return global.display.list_all_windows().some(w =>
            !isRenderer(w) && w.is_fullscreen() && !w.minimized && w.located_on_workspace(workspace));
    }

    _sendToSupervisor(message) {
        const sent = this._supervisor.send(message);
        if (!sent && !this._reportedUnreachable) {
            this._reportedUnreachable = true;
            console.warn('[wayland-wallpaperengine] cannot reach wwe (supervisor.sock); ' +
                'update wwe with the installer so the wallpaper can pause');
        }
        return sent;
    }

    _loadConfig() {
        this._configCancellable.cancel();
        const cancellable = new Gio.Cancellable();
        this._configCancellable = cancellable;
        this._configFile.load_contents_async(cancellable, (file, result) => {
            if (cancellable.is_cancelled())
                return;
            let mode = 'focus';
            try {
                const [, bytes] = file.load_contents_finish(result);
                const value = JSON.parse(new TextDecoder().decode(bytes)).pause;
                if (PAUSE_MODES.has(value))
                    mode = value;
            } catch {
                // no config yet, or it is being rewritten: keep the default
            }
            this._mode = mode;
            this.update();
        });
    }
}
