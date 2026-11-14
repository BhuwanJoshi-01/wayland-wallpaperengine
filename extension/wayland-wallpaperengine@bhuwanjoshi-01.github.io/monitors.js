// Wayland Wallpaper Engine - monitors that show nothing but the desktop
// SPDX-License-Identifier: GPL-3.0-or-later
//
// With several monitors, a monitor without windows keeps showing the
// wallpaper while an app is focused on another one, so the wallpaper keeps
// playing there (pause.js). This module tracks where windows are and reports
// when that may have changed.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isDesktopWindow, isRenderer} from './renderer.js';

// Windows that cover part of the desktop. Menus, tooltips and docks do not.
const APP_WINDOW_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
]);

function coversDesktop(win, workspace) {
    return APP_WINDOW_TYPES.has(win.get_window_type()) &&
        !win.minimized && win.showing_on_its_workspace() && win.located_on_workspace(workspace) &&
        !isRenderer(win) && !isDesktopWindow(win);
}

function overlaps(a, b) {
    return a.x < b.x + b.width && b.x < a.x + a.width &&
        a.y < b.y + b.height && b.y < a.y + a.height;
}

export class EmptyMonitors {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._last = '';
        this._idleId = 0;
        this._windowSignals = new Map();

        const changed = () => this._queueCheck();
        this._signals = [
            [global.display, global.display.connect('window-created', (_display, win) => {
                this._watch(win);
                changed();
            })],
            [global.workspace_manager, global.workspace_manager.connect('active-workspace-changed', changed)],
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', changed)],
        ];
        global.display.list_all_windows().forEach(win => this._watch(win));
        this._last = this.indices.join();
    }

    destroy() {
        if (this._idleId) {
            GLib.Source.remove(this._idleId);
            this._idleId = 0;
        }
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        for (const win of [...this._windowSignals.keys()])
            this._unwatch(win);
    }

    // Indices of the monitors that no window covers on the active workspace.
    get indices() {
        const workspace = global.workspace_manager.get_active_workspace();
        const frames = global.display.list_all_windows()
            .filter(win => coversDesktop(win, workspace))
            .map(win => win.get_frame_rect());
        const empty = [];
        for (let i = 0; i < global.display.get_n_monitors(); i++) {
            const monitor = global.display.get_monitor_geometry(i);
            if (!frames.some(frame => overlaps(frame, monitor)))
                empty.push(i);
        }
        return empty;
    }

    _watch(win) {
        if (this._windowSignals.has(win))
            return;
        const changed = () => this._queueCheck();
        this._windowSignals.set(win, [
            win.connect('position-changed', changed),
            win.connect('size-changed', changed),
            win.connect('shown', changed),
            win.connect('notify::minimized', changed),
            win.connect('notify::on-all-workspaces', changed),
            win.connect('workspace-changed', changed),
            win.connect('unmanaged', () => {
                this._unwatch(win);
                changed();
            }),
        ]);
    }

    _unwatch(win) {
        this._windowSignals.get(win).forEach(id => win.disconnect(id));
        this._windowSignals.delete(win);
    }

    // Windows move every frame while dragged: check once per main loop
    // iteration, and report only real changes.
    _queueCheck() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            const indices = this.indices.join();
            if (indices !== this._last) {
                this._last = indices;
                this._onChanged();
            }
            return GLib.SOURCE_REMOVE;
        });
    }
}
