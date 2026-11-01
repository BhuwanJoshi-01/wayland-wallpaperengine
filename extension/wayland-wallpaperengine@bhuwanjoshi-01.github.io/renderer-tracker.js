// Wayland Wallpaper Engine - finding the renderer windows and keeping them out of the way
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {contentActor, hasContent, isRenderer} from './renderer.js';

// How often to check for a renderer's first frame. There is no time limit: a
// renderer started on the lock screen draws nothing until the session is unlocked.
const CONTENT_POLL_MS = 200;

// Picking skips non-reactive actors, so pointer input falls through to
// whatever is below (desktop icons, the background).
function makeUnreactive(actor) {
    actor.reactive = false;
    actor.get_children().forEach(makeUnreactive);
}

// One renderer window. Its clones in the backgrounds are what the user sees;
// the window itself must never get in the way: sticky, at the bottom of the
// stack, invisible, click-through, never focused, and minimized once it has
// drawn its first frame.
class RendererWindow {
    constructor(win, {onChanged, onUnmanaged}) {
        this.win = win;
        this._onChanged = onChanged;
        this._contentWaitId = 0;
        this._actorSignals = [];
        this._signals = [
            win.connect('notify::minimized', () => this._hide()),
            win.connect_after('shown', () => this._hide()),
            win.connect('focus', () => this._giveAwayFocus()),
            win.connect_after('raised', () => win.lower()),
            win.connect('unmanaged', () => onUnmanaged(this)),
        ];

        win.stick();
        // fullscreen while visible would hide panels and docks
        if (win.is_fullscreen() && !win.minimized)
            win.unmake_fullscreen();
        win.lower();
        this._makeInputTransparent();
        if (win.has_focus())
            this._giveAwayFocus();
        this._hide();
    }

    destroy() {
        this._stopContentWait();
        this._signals.forEach(id => this.win.disconnect(id));
        this._signals = [];
        for (const [actor, id] of this._actorSignals)
            actor.disconnect(id);
        this._actorSignals = [];
    }

    get ready() {
        const actor = this.win.get_compositor_private();
        return actor !== null && hasContent(actor) && this._contentWaitId === 0;
    }

    _makeInputTransparent() {
        const actor = this.win.get_compositor_private();
        if (!actor)
            return;
        makeUnreactive(actor);
        if (this._actorSignals.length > 0)
            return;
        // surface actors can be added later (subsurfaces)
        const surfaceContainer = actor.get_first_child();
        for (const parent of surfaceContainer ? [actor, surfaceContainer] : [actor])
            this._actorSignals.push([parent, parent.connect('child-added', (_parent, child) => makeUnreactive(child))]);
    }

    _giveAwayFocus() {
        const time = global.get_current_time();
        // get_tab_list leaves out renderer windows (see overrides.js)
        const next = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .find(w => w !== this.win && !w.minimized);
        if (next)
            next.activate(time);
        else
            global.display.unset_input_focus(time);
    }

    // Mutter keeps the last buffer of a minimized window, so the clones keep
    // showing (and animating) it. A window minimized before its first frame
    // never gets a buffer, so it is minimized only once it has content.
    _hide() {
        const actor = this.win.get_compositor_private();
        if (!actor)
            return;
        // clones paint with their own opacity
        actor.opacity = 0;

        if (hasContent(actor)) {
            this._stopContentWait();
            if (!this.win.minimized)
                this.win.minimize();
            // Only while minimized: GNOME moves and resizes a normal window
            // whenever the work area changes (panels, lock screen), which makes
            // the wallpaper jump. A fullscreen window always covers its monitor,
            // and a minimized one does not hide the panels.
            if (!this.win.is_fullscreen())
                this.win.make_fullscreen();
            this._onChanged();
            return;
        }

        // It has to be mapped once to get a buffer; until then it is at the
        // bottom, invisible and click-through, and must not be fullscreen.
        this._makeInputTransparent();
        if (this.win.is_fullscreen())
            this.win.unmake_fullscreen();
        if (this.win.minimized)
            this.win.unminimize();

        this._stopContentWait();
        this._contentWaitId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONTENT_POLL_MS, () => {
            if (!hasContent(actor))
                return GLib.SOURCE_CONTINUE;
            this._contentWaitId = 0;
            this._hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopContentWait() {
        if (this._contentWaitId) {
            GLib.Source.remove(this._contentWaitId);
            this._contentWaitId = 0;
        }
    }
}

export class RendererTracker {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._renderers = new Map();
        // windows that may still turn out to be renderers: Wayland clients
        // can set their app_id and title after the window is created
        this._candidates = new Map();
        this._windowCreatedId = global.display.connect('window-created', (_display, win) => this._track(win));
    }

    destroy() {
        global.display.disconnect(this._windowCreatedId);
        for (const win of [...this._candidates.keys()])
            this._forgetCandidate(win);
        for (const renderer of this._renderers.values())
            renderer.destroy();
        this._renderers.clear();
    }

    trackExisting() {
        global.display.list_all_windows().forEach(win => this._track(win));
    }

    get windows() {
        return [...this._renderers.keys()];
    }

    isReady(win) {
        return this._renderers.get(win)?.ready ?? false;
    }

    // The surface to show on a monitor: that monitor's renderer, else any.
    contentFor(monitor) {
        const withActor = this.windows.filter(win => win.get_compositor_private());
        const win = withActor.find(w => w.get_monitor() === monitor) ?? withActor[0];
        return win ? contentActor(win.get_compositor_private()) : null;
    }

    _track(win) {
        if (this._renderers.has(win) || this._candidates.has(win))
            return;
        if (isRenderer(win)) {
            this._manage(win);
            return;
        }
        const recheck = () => {
            if (!isRenderer(win))
                return;
            this._forgetCandidate(win);
            this._manage(win);
        };
        this._candidates.set(win, [
            win.connect('notify::wm-class', recheck),
            win.connect('notify::title', recheck),
            win.connect('unmanaged', () => this._forgetCandidate(win)),
        ]);
    }

    _forgetCandidate(win) {
        this._candidates.get(win).forEach(id => win.disconnect(id));
        this._candidates.delete(win);
    }

    _manage(win) {
        // each renderer gets its own monitor, in launch order (one renderer per monitor)
        const claimed = new Set(this.windows.map(w => w.get_monitor()));
        const free = [...Array(global.display.get_n_monitors()).keys()].find(i => !claimed.has(i));
        if (free !== undefined && win.get_monitor() !== free)
            win.move_to_monitor(free);

        this._renderers.set(win, new RendererWindow(win, {
            onChanged: () => this._onChanged(),
            onUnmanaged: renderer => {
                renderer.destroy();
                this._renderers.delete(win);
                this._onChanged();
            },
        }));
        this._onChanged();
    }
}
