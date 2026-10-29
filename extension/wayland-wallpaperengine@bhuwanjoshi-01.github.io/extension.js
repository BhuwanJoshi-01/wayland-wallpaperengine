// Wayland Wallpaper Engine - GNOME Shell extension
// SPDX-License-Identifier: GPL-3.0-or-later
//
// GNOME's compositor (mutter) does not implement wlr-layer-shell, so
// linux-wallpaperengine / mpv cannot draw on the desktop by themselves.
// Instead they run as ordinary windows (started by `wwe run`), and this
// extension:
//   1. keeps that window minimized and hidden from overview / alt-tab / docks,
//   2. paints a live Clutter.Clone of it inside every background actor
//      (desktop, overview workspaces, lock screen),
//   3. SIGSTOPs the renderer while any monitor has a fullscreen window
//      (games, videos) and SIGCONTs it afterwards.
//
// Technique adapted from the Hanabi extension (GPL-3.0-or-later):
// https://github.com/jeffshee/gnome-ext-hanabi

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as WindowManager from 'resource:///org/gnome/shell/ui/windowManager.js';
import * as Workspace from 'resource:///org/gnome/shell/ui/workspace.js';
import * as WorkspaceThumbnail from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

// Wayland app_ids of renderer windows: the patched linux-wallpaperengine build
// and mpv started with --wayland-app-id. The window title is the fallback for
// unpatched linux-wallpaperengine builds, which set no app_id.
const APP_IDS = new Set(['linux-wallpaperengine', 'wwe-video']);
const FALLBACK_TITLE = 'wallpaperengine';

function isRenderer(win) {
    if (!win)
        return false;
    const wmClass = win.get_wm_class();
    if (wmClass)
        return APP_IDS.has(wmClass);
    return win.get_title() === FALLBACK_TITLE;
}

export default class WaylandWallpaperEngine extends Extension {
    enable() {
        this._injections = new InjectionManager();
        this._holders = new Set();
        this._renderers = new Map(); // Meta.Window -> signal ids
        this._watched = new Map(); // Meta.Window -> signal ids (waiting for app_id/title)
        this._stoppedPids = new Set();
        this._getAllWindowActors = () => global.get_window_actors();

        this._installOverrides();

        this._displaySignals = [
            global.display.connect('window-created', (_display, win) => this._onWindowCreated(win)),
            global.display.connect('in-fullscreen-changed', () => this._updatePause()),
        ];

        for (const actor of this._getAllWindowActors())
            this._onWindowCreated(actor.meta_window);

        this._reloadBackgrounds();
    }

    disable() {
        for (const id of this._displaySignals)
            global.display.disconnect(id);
        this._displaySignals = [];

        for (const [win, ids] of this._watched)
            ids.forEach(id => win.disconnect(id));
        this._watched.clear();

        for (const [win, ids] of this._renderers)
            ids.forEach(id => win.disconnect(id));

        // never leave the renderer frozen
        for (const pid of this._stoppedPids)
            this._signal(pid, 'CONT');
        this._stoppedPids.clear();
        this._renderers.clear();

        this._injections.clear();
        this._injections = null;

        for (const holder of [...this._holders])
            holder.destroy();
        this._holders.clear();

        this._reloadBackgrounds();
    }

    // ------------------------------------------------------------------
    // Renderer window tracking
    // ------------------------------------------------------------------

    _onWindowCreated(win) {
        if (!win || this._renderers.has(win) || this._watched.has(win))
            return;

        if (isRenderer(win)) {
            this._manage(win);
            return;
        }

        // Wayland clients may set app_id/title after the window is created.
        const recheck = () => {
            if (!isRenderer(win))
                return;
            this._unwatch(win);
            this._manage(win);
        };
        this._watched.set(win, [
            win.connect('notify::wm-class', recheck),
            win.connect('notify::title', recheck),
            win.connect('unmanaged', () => this._unwatch(win)),
        ]);
    }

    _unwatch(win) {
        const ids = this._watched.get(win);
        if (!ids)
            return;
        ids.forEach(id => win.disconnect(id));
        this._watched.delete(win);
    }

    _manage(win) {
        // Give each renderer its own monitor, in launch order (one process per monitor).
        const claimed = new Set([...this._renderers.keys()].map(w => w.get_monitor()));
        const nMonitors = global.display.get_n_monitors();
        for (let i = 0; i < nMonitors; i++) {
            if (!claimed.has(i)) {
                if (win.get_monitor() !== i)
                    win.move_to_monitor(i);
                break;
            }
        }

        this._renderers.set(win, [
            win.connect('notify::minimized', () => this._hide(win)),
            win.connect_after('shown', () => this._hide(win)),
            win.connect('unmanaged', () => this._unmanage(win)),
        ]);

        win.stick();
        this._hide(win);

        if (win.get_compositor_private()) {
            this._refreshClones();
        } else {
            GLib.idle_add_once(GLib.PRIORITY_DEFAULT, () => {
                if (this._renderers?.has(win))
                    this._refreshClones();
            });
        }
        this._updatePause();
    }

    _unmanage(win) {
        const ids = this._renderers.get(win);
        if (!ids)
            return;
        ids.forEach(id => win.disconnect(id));
        this._renderers.delete(win);

        const pid = win.get_pid();
        this._stoppedPids.delete(pid);

        this._refreshClones();
    }

    _hide(win) {
        if (!win.minimized)
            win.minimize();
    }

    // ------------------------------------------------------------------
    // Fullscreen pause (SIGSTOP / SIGCONT)
    // ------------------------------------------------------------------

    _updatePause() {
        let fullscreen = false;
        const nMonitors = global.display.get_n_monitors();
        for (let i = 0; i < nMonitors; i++) {
            if (global.display.get_monitor_in_fullscreen(i))
                fullscreen = true;
        }

        for (const win of this._renderers.keys()) {
            const pid = win.get_pid();
            if (pid <= 0)
                continue;
            if (fullscreen && !this._stoppedPids.has(pid)) {
                this._signal(pid, 'STOP');
                this._stoppedPids.add(pid);
            } else if (!fullscreen && this._stoppedPids.has(pid)) {
                this._signal(pid, 'CONT');
                this._stoppedPids.delete(pid);
            }
        }
    }

    _signal(pid, sig) {
        // The launcher starts the renderer with setsid, so signal the whole
        // process group (includes CEF helpers for web wallpapers); fall back to
        // the single pid if it is not a group leader.
        try {
            GLib.spawn_async(null,
                ['sh', '-c', `kill -${sig} -- -${pid} 2>/dev/null || kill -${sig} ${pid}`],
                null, GLib.SpawnFlags.SEARCH_PATH, null);
        } catch (e) {
            console.error(`[wayland-wallpaperengine] kill -${sig} ${pid} failed: ${e.message}`);
        }
    }

    // ------------------------------------------------------------------
    // Background clones
    // ------------------------------------------------------------------

    _rendererActorFor(monitor) {
        const candidates = [...this._renderers.keys()]
            .map(win => [win, win.get_compositor_private()])
            .filter(([, actor]) => actor);
        const match = candidates.find(([win]) => win.get_monitor() === monitor) ?? candidates[0];
        return match ? match[1] : null;
    }

    _attachHolder(backgroundActor) {
        const holder = new Clutter.Actor({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            reactive: false,
        });
        const clone = new Clutter.Clone({
            x_expand: true,
            y_expand: true,
            reactive: false,
        });
        holder.add_child(clone);
        holder._wpeClone = clone;
        holder._wpeMonitor = backgroundActor.monitor;

        backgroundActor.layout_manager = new Clutter.BinLayout();
        backgroundActor.add_child(holder);

        this._holders.add(holder);
        holder.connect('destroy', () => this._holders?.delete(holder));

        this._fillHolder(holder);
    }

    _fillHolder(holder) {
        const source = this._rendererActorFor(holder._wpeMonitor);
        if (holder._wpeClone.source !== source)
            holder._wpeClone.set_source(source);
        holder.visible = source !== null;
    }

    _refreshClones() {
        for (const holder of this._holders)
            this._fillHolder(holder);
    }

    _reloadBackgrounds() {
        Main.layoutManager._updateBackgrounds().catch(logError);
        Main.screenShield?._dialog?._updateBackgrounds?.();
        try {
            Main.overview._overview._controls._workspacesDisplay._updateWorkspacesViews();
        } catch {
            // overview internals differ or another extension (e.g. DING) interferes
        }
        // blur-my-shell caches background clones; make it rebuild them
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            if (Main.extensionManager._enabledExtensions?.includes('blur-my-shell@aunetx'))
                Main.layoutManager.emit('monitors-changed');
            return GLib.SOURCE_REMOVE;
        });
    }

    // ------------------------------------------------------------------
    // Shell overrides
    // ------------------------------------------------------------------

    _installOverrides() {
        const self = this;
        const inj = this._injections;

        inj.overrideMethod(Background.BackgroundManager.prototype, '_createBackgroundActor',
            original => function () {
                const backgroundActor = original.call(this);
                self._attachHolder(backgroundActor);
                return backgroundActor;
            });

        inj.overrideMethod(Shell.Global.prototype, 'get_window_actors',
            original => {
                self._getAllWindowActors = () => original.call(global);
                return function () {
                    return original.call(this).filter(a => !isRenderer(a.meta_window));
                };
            });

        inj.overrideMethod(Workspace.Workspace.prototype, '_isOverviewWindow',
            original => function (win) {
                return isRenderer(win) ? false : original.call(this, win);
            });

        inj.overrideMethod(WorkspaceThumbnail.WorkspaceThumbnail.prototype, '_isOverviewWindow',
            original => function (win) {
                return isRenderer(win) ? false : original.call(this, win);
            });

        inj.overrideMethod(Meta.Display.prototype, 'get_tab_list',
            original => function (type, workspace) {
                return original.call(this, type, workspace).filter(w => !isRenderer(w));
            });

        // no minimize/map animations for the renderer
        inj.overrideMethod(WindowManager.WindowManager.prototype, '_shouldAnimateActor',
            original => function (actor, types) {
                return isRenderer(actor?.meta_window) ? false : original.call(this, actor, types);
            });

        // keep it out of the dock / dash-to-panel / app switcher
        inj.overrideMethod(Shell.WindowTracker.prototype, 'get_window_app',
            original => function (win) {
                return isRenderer(win) ? null : original.call(this, win);
            });

        inj.overrideMethod(Shell.App.prototype, 'get_windows',
            original => function () {
                return original.call(this).filter(w => !isRenderer(w));
            });

        inj.overrideMethod(Shell.App.prototype, 'get_n_windows',
            () => function () {
                return this.get_windows().length;
            });

        inj.overrideMethod(Shell.AppSystem.prototype, 'get_running',
            original => function () {
                return original.call(this).filter(app => app.get_n_windows() > 0);
            });
    }
}
