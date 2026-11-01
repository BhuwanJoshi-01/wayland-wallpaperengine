// Wayland Wallpaper Engine - GNOME Shell extension
// SPDX-License-Identifier: GPL-3.0-or-later
//
// GNOME has no wlr-layer-shell, so linux-wallpaperengine and mpv cannot draw
// on the desktop themselves. `wwe run` starts them as ordinary windows, and
// this extension shows a live copy of that window as the background:
//   renderer-tracker.js  finds the renderer windows and keeps them hidden
//   background-clone.js  puts the copy into every background actor
//   overrides.js         leaves the renderer out of the overview, alt-tab, docks
//   pause.js             pauses the renderer while nobody looks at it
//   input.js             forwards the pointer; audio only on the desktop
//   picker.js            top bar wallpaper picker
//
// Technique adapted from the Hanabi extension (GPL-3.0-or-later):
// https://github.com/jeffshee/gnome-ext-hanabi

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BackgroundClones} from './background-clone.js';
import {InputBridge} from './input.js';
import {ShellOverrides} from './overrides.js';
import {PauseController} from './pause.js';
import {WallpaperMenu} from './picker.js';
import {RendererTracker} from './renderer-tracker.js';

export default class WaylandWallpaperEngine extends Extension {
    enable() {
        this._tracker = new RendererTracker(() => this._onRenderersChanged());
        this._clones = new BackgroundClones(monitor => this._tracker.contentFor(monitor));
        this._overrides = new ShellOverrides(backgroundActor => this._clones.attach(backgroundActor));
        this._input = new InputBridge(this._tracker);
        this._pause = new PauseController(this._tracker, paused => this._input.setPaused(paused));
        this._menu = new WallpaperMenu();
        Main.panel.addToStatusArea(this.uuid, this._menu);

        this._clones.attachExisting();
        this._tracker.trackExisting();
        this._onRenderersChanged();
    }

    disable() {
        // The extension uses the unlock-dialog session mode so the lock screen
        // keeps the live background (paused there; the picker hides itself).
        // So this runs when the extension is turned off or the session ends,
        // not when the screen locks.
        this._menu.destroy();
        this._menu = null;
        this._pause.destroy();
        this._pause = null;
        this._input.destroy();
        this._input = null;
        this._overrides.destroy();
        this._overrides = null;
        this._clones.destroy();
        this._clones = null;
        this._tracker.destroy();
        this._tracker = null;
    }

    _onRenderersChanged() {
        this._clones.refresh();
        this._pause.update();
        this._input.update();
    }
}
