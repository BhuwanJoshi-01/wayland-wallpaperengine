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
//   3. SIGSTOPs the renderer while it is not being looked at (by default:
//      whenever an app has focus, plus fullscreen windows and the lock
//      screen) and SIGCONTs it afterwards,
//   4. forwards the pointer and plays wallpaper audio only while the desktop
//      is focused (input.js),
//   5. adds a top bar wallpaper picker (picker.js).
//
// Technique adapted from the Hanabi extension (GPL-3.0-or-later):
// https://github.com/jeffshee/gnome-ext-hanabi

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as WindowManager from 'resource:///org/gnome/shell/ui/windowManager.js';
import * as Workspace from 'resource:///org/gnome/shell/ui/workspace.js';
import * as WorkspaceThumbnail from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

import {CloneHolder} from './background-clone.js';
import {InputBridge, isDesktopWindow} from './input.js';
import {WallpaperMenu} from './picker.js';

// Wayland app_ids of renderer windows: the patched linux-wallpaperengine build
// and mpv started with --wayland-app-id. The window title is the fallback for
// unpatched linux-wallpaperengine builds, which set no app_id.
const APP_IDS = new Set(['linux-wallpaperengine', 'wwe-video']);
const FALLBACK_TITLE = 'wallpaperengine';

// how often to check for a renderer's first frame before minimizing it; there
// is no time limit: a renderer started on the lock screen draws nothing until
// the session is unlocked
const CONTENT_POLL_MS = 200;

function hasContent(actor) {
    const [ok, width, height] = actor.get_texture()?.get_preferred_size() ?? [false, 0, 0];
    return ok && width > 0 && height > 0;
}

const SURFACE_ACTOR_TYPE = GObject.type_from_name('MetaSurfaceActor');

// wwe's config; the extension only reads "pause":
//   "focus"      (default) play only while the desktop is focused, like
//                Wallpaper Engine's "pause when another application is focused"
//   "fullscreen" pause only while another window is fullscreen
//   "never"
const CONFIG_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'wwe', 'config.json']);
const PAUSE_MODES = new Set(['focus', 'fullscreen', 'never']);

// The renderer's main surface: the largest visible surface actor. Cloning it
// instead of the whole window actor leaves out whatever mutter draws around
// the client's buffer, e.g. the black background (and centring offset) it adds
// to fullscreen windows whose buffer does not fill the monitor.
function contentActor(windowActor) {
    let best = null;
    const walk = actor => {
        if (actor.visible && GObject.type_is_a(actor.constructor.$gtype, SURFACE_ACTOR_TYPE) &&
            actor.width * actor.height > (best ? best.width * best.height : 0))
            best = actor;
        actor.get_children().forEach(child => walk(child));
    };
    walk(windowActor);
    return best ?? windowActor;
}

// Runs kill(1) without a shell; resolves to true if it succeeded.
function runKill(args) {
    return new Promise(resolve => {
        const proc = Gio.Subprocess.new(['kill', ...args], Gio.SubprocessFlags.STDERR_SILENCE);
        proc.wait_check_async(null, (p, res) => {
            try {
                resolve(p.wait_check_finish(res));
            } catch {
                resolve(false);
            }
        });
    });
}

// The desktop is what the user is looking at: nothing or the desktop itself
// focused, outside the overview and lock screen. Drives audio and pausing.
function desktopActive() {
    if (Main.sessionMode.isLocked || Main.overview.visible)
        return false;
    const focus = global.display.focus_window;
    return !focus || isDesktopWindow(focus) || isRenderer(focus);
}

// Accepts a Meta.Window or a Meta.WindowActor (some shell code, e.g.
// WorkspaceThumbnail._isOverviewWindow, passes actors).
function isRenderer(win) {
    if (win instanceof Meta.WindowActor)
        win = win.meta_window;
    if (!(win instanceof Meta.Window))
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
        this._contentWaits = new Map(); // Meta.Window -> GLib source id
        this._getAllWindowActors = () => global.get_window_actors();

        this._installOverrides();

        this._input = new InputBridge({
            getRenderers: () => [...this._renderers.keys()],
            desktopActive,
        });
        this._input.enable();

        // the extension also runs on the lock screen (for the live background);
        // the picker must never be usable there
        this._menu = new WallpaperMenu();
        Main.panel.addToStatusArea(this.uuid, this._menu);
        this._sessionSignal = Main.sessionMode.connect('updated', () => {
            this._syncMenuVisibility();
            this._updatePause();
        });
        this._syncMenuVisibility();

        this._loadConfig();
        this._configMonitor = Gio.File.new_for_path(CONFIG_PATH)
            .monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._configMonitor.connect('changed', () => {
            this._loadConfig();
            this._updatePause();
        });

        this._displaySignals = [
            global.display.connect('window-created', (_display, win) => this._onWindowCreated(win)),
            global.display.connect('in-fullscreen-changed', () => this._updatePause()),
            global.display.connect('notify::focus-window', () => this._updatePause()),
        ];
        this._overviewSignals = [
            Main.overview.connect('showing', () => this._updatePause()),
            Main.overview.connect('hidden', () => this._updatePause()),
        ];
        this._workspaceSignal = global.workspace_manager.connect('active-workspace-changed',
            () => this._updatePause());

        for (const actor of this._getAllWindowActors())
            this._onWindowCreated(actor.meta_window);

        this._reloadBackgrounds();
    }

    disable() {
        for (const id of this._displaySignals)
            global.display.disconnect(id);
        this._displaySignals = [];
        global.workspace_manager.disconnect(this._workspaceSignal);
        this._overviewSignals.forEach(id => Main.overview.disconnect(id));
        this._overviewSignals = [];
        this._configMonitor.cancel();
        this._configMonitor = null;

        this._input.disable();
        this._input = null;

        Main.sessionMode.disconnect(this._sessionSignal);
        this._menu.destroy();
        this._menu = null;

        for (const id of this._contentWaits.values())
            GLib.source_remove(id);
        this._contentWaits.clear();

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

    _loadConfig() {
        let mode = 'focus';
        try {
            const [, bytes] = GLib.file_get_contents(CONFIG_PATH);
            const value = JSON.parse(new TextDecoder().decode(bytes)).pause;
            if (PAUSE_MODES.has(value))
                mode = value;
        } catch {
            // no config yet, or it is being rewritten: keep the default
        }
        this._pauseMode = mode;
    }

    _syncMenuVisibility() {
        const allowed = !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter;
        if (!allowed)
            this._menu.menu.close();
        this._menu.visible = allowed;
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
            win.connect('focus', () => this._giveAwayFocus(win)),
            win.connect_after('raised', () => win.lower()),
            win.connect('unmanaged', () => this._unmanage(win)),
        ]);

        // The window may be on screen briefly (until its first frame, see
        // _hide). Make sure it can never get in the way: bottom of the stack,
        // invisible, click-through, and not fullscreen while visible (that
        // hides panels and docks; minimized and fullscreen is fine).
        win.stick();
        if (win.is_fullscreen() && !win.minimized)
            win.unmake_fullscreen();
        win.lower();
        this._makeInputTransparent(win);
        if (win.has_focus())
            this._giveAwayFocus(win);
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
        this._input.rendererAdded();
    }

    _unmanage(win) {
        const ids = this._renderers.get(win);
        if (!ids)
            return;
        ids.forEach(id => win.disconnect(id));
        this._renderers.delete(win);

        this._cancelContentWait(win);

        const pid = win.get_pid();
        this._stoppedPids.delete(pid);

        this._refreshClones();
        this._input.update();
    }

    // Picking skips non-reactive actors, so pointer input falls through to
    // whatever is below (desktop icons, the background).
    _makeInputTransparent(win) {
        const actor = win.get_compositor_private();
        if (!actor)
            return;
        const walk = a => {
            a.reactive = false;
            for (const child of a.get_children())
                walk(child);
        };
        walk(actor);
        // surface actors can be added later (e.g. subsurfaces)
        if (!actor._wweChildAddedId) {
            actor._wweChildAddedId = actor.connect('child-added', (_a, child) => walk(child));
            actor.get_first_child()?.connect('child-added', (_a, child) => walk(child));
        }
    }

    _giveAwayFocus(win) {
        const time = global.get_current_time();
        // get_tab_list is overridden to leave out renderer windows
        const next = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .find(w => w !== win && !w.minimized);
        if (next)
            next.activate(time);
        else
            global.display.unset_input_focus(time);
    }

    // Mutter keeps the last buffer of a minimized window, so the clones keep
    // showing (and animating) it. A window minimized before its first frame
    // never gets a buffer at all, so minimize only once the surface has content.
    _hide(win) {
        const actor = win.get_compositor_private();
        if (!actor)
            return;
        // invisible while briefly shown; clones paint with their own opacity
        actor.opacity = 0;

        if (hasContent(actor)) {
            this._cancelContentWait(win);
            if (!win.minimized)
                win.minimize();
            // Only now, while minimized: GNOME keeps resizing and moving a
            // normal window whenever the usable area changes (panels, lock
            // screen), which makes the wallpaper jump and leaves black bands.
            // Fullscreen windows always get the whole monitor, and a minimized
            // one does not count as fullscreen (panels stay visible).
            if (!win.is_fullscreen())
                win.make_fullscreen();
            this._refreshClones();
            this._updatePause();
            return;
        }

        // needs to be mapped once to get a buffer; harmless while waiting
        // (below everything, opacity 0, click-through) - but never while
        // fullscreen, which would hide panels and docks
        this._makeInputTransparent(win);
        if (win.is_fullscreen())
            win.unmake_fullscreen();
        if (win.minimized)
            win.unminimize();
        if (this._contentWaits.has(win))
            return;
        this._contentWaits.set(win, GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONTENT_POLL_MS, () => {
            if (hasContent(actor)) {
                this._contentWaits.delete(win);
                this._hide(win);
                this._refreshClones();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        }));
    }

    _cancelContentWait(win) {
        const id = this._contentWaits.get(win);
        if (id) {
            GLib.source_remove(id);
            this._contentWaits.delete(win);
        }
    }

    // ------------------------------------------------------------------
    // Pausing (SIGSTOP / SIGCONT): a stopped renderer uses no CPU or GPU, and
    // with no new frames GNOME Shell has nothing to repaint either. The clones
    // keep showing the last frame.
    // ------------------------------------------------------------------

    _shouldPause() {
        if (this._pauseMode === 'never')
            return false;
        // nobody is looking at it
        if (Main.sessionMode.isLocked)
            return true;
        // our own renderer windows are fullscreen too; only other visible
        // fullscreen windows on the current workspace count
        const workspace = global.workspace_manager.get_active_workspace();
        const fullscreen = global.display.list_all_windows().some(w =>
            !isRenderer(w) && w.is_fullscreen() && !w.minimized && w.located_on_workspace(workspace));
        if (fullscreen)
            return true;
        return this._pauseMode === 'focus' && !desktopActive();
    }

    _updatePause() {
        if (!this._renderers)
            return;
        const pause = this._shouldPause();
        this._input?.setPaused(pause);

        for (const win of this._renderers.keys()) {
            const pid = win.get_pid();
            if (pid <= 0)
                continue;
            // a renderer still waiting for its first frame must keep running
            const actor = win.get_compositor_private();
            const ready = actor && hasContent(actor) && !this._contentWaits.has(win);
            const stop = pause && ready;
            if (stop && !this._stoppedPids.has(pid)) {
                this._signal(pid, 'STOP');
                this._stoppedPids.add(pid);
            } else if (!stop && this._stoppedPids.has(pid)) {
                this._signal(pid, 'CONT');
                this._stoppedPids.delete(pid);
            }
        }
    }

    // `wwe run` starts each renderer in its own process group, so signal the
    // whole group (it includes the CEF helpers of web wallpapers), falling
    // back to the single pid. Signals are queued so that a quick STOP/CONT
    // sequence (focus changes) can never be delivered out of order.
    _signal(pid, sig) {
        this._signalQueue = (this._signalQueue ?? Promise.resolve())
            .then(() => runKill(['-s', sig, '--', `-${pid}`]))
            .then(ok => ok || runKill(['-s', sig, `${pid}`]))
            .catch(e => console.error(`[wayland-wallpaperengine] kill -s ${sig} ${pid}: ${e.message}`));
    }

    // ------------------------------------------------------------------
    // Background clones
    // ------------------------------------------------------------------

    _rendererActorFor(monitor) {
        const candidates = [...this._renderers.keys()]
            .map(win => [win, win.get_compositor_private()])
            .filter(([, actor]) => actor);
        const match = candidates.find(([win]) => win.get_monitor() === monitor) ?? candidates[0];
        return match ? contentActor(match[1]) : null;
    }

    _attachHolder(backgroundActor) {
        // the clone is laid out by hand (cover scaling), so it must not drive
        // the holder's size: the holder just fills the background actor
        const holder = new CloneHolder({
            x_expand: true,
            y_expand: true,
            reactive: false,
            clip_to_allocation: true,
        });
        holder._wpeClone = holder.clone;
        holder._wpeMonitor = backgroundActor.monitor;
        holder._wpeSourceIds = [];

        backgroundActor.layout_manager = new Clutter.BinLayout();
        backgroundActor.add_child(holder);

        this._holders.add(holder);
        holder.connect('destroy', () => {
            this._untrackSource(holder);
            this._holders?.delete(holder);
        });

        this._fillHolder(holder);
    }

    _fillHolder(holder) {
        const source = this._rendererActorFor(holder._wpeMonitor);
        if (holder._wpeClone.source !== source) {
            this._untrackSource(holder);
            holder._wpeClone.set_source(source);
            if (source) {
                holder._wpeSourceRef = source;
                holder._wpeSourceIds = [
                    source.connect('notify::width', () => holder.queue_relayout()),
                    source.connect('notify::height', () => holder.queue_relayout()),
                ];
            }
        }
        holder.visible = source !== null;
        holder.queue_relayout();
    }

    _untrackSource(holder) {
        for (const id of holder._wpeSourceIds)
            holder._wpeSourceRef?.disconnect(id);
        holder._wpeSourceIds = [];
        holder._wpeSourceRef = null;
    }

    _refreshClones() {
        for (const holder of this._holders)
            this._fillHolder(holder);
    }

    _reloadBackgrounds() {
        // async (returns a promise) since GNOME 48
        Promise.resolve(Main.layoutManager._updateBackgrounds()).catch(logError);
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

        // Wayland clients cannot set skip-taskbar themselves. Shell code that asks
        // (window attention notifications, docks) then ignores the renderer.
        inj.overrideMethod(Meta.Window.prototype, 'is_skip_taskbar',
            original => function () {
                return isRenderer(this) || original.call(this);
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
