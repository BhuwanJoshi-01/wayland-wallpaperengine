// Wayland Wallpaper Engine - shell overrides
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The renderer windows exist only to be cloned into the backgrounds, so the
// shell is told to leave them out everywhere a user would see or reach them.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as WindowManager from 'resource:///org/gnome/shell/ui/windowManager.js';
import * as Workspace from 'resource:///org/gnome/shell/ui/workspace.js';
import * as WorkspaceThumbnail from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

import {isRenderer} from './renderer.js';

export class ShellOverrides {
    constructor(onBackgroundActorCreated) {
        this._injections = new InjectionManager();
        const inject = (prototype, method, override) =>
            this._injections.overrideMethod(prototype, method, override);

        inject(Background.BackgroundManager.prototype, '_createBackgroundActor', original => function () {
            const backgroundActor = original.call(this);
            onBackgroundActorCreated(backgroundActor);
            return backgroundActor;
        });

        // overview window previews and workspace thumbnails
        for (const prototype of [Workspace.Workspace.prototype, WorkspaceThumbnail.WorkspaceThumbnail.prototype]) {
            inject(prototype, '_isOverviewWindow', original => function (win) {
                return !isRenderer(win) && original.call(this, win);
            });
        }

        inject(Shell.Global.prototype, 'get_window_actors', original => function () {
            return original.call(this).filter(actor => !isRenderer(actor.meta_window));
        });

        // alt-tab and focus changes
        inject(Meta.Display.prototype, 'get_tab_list', original => function (type, workspace) {
            return original.call(this, type, workspace).filter(win => !isRenderer(win));
        });

        // Wayland clients cannot set skip-taskbar themselves; window attention
        // notifications and docks ask for it
        inject(Meta.Window.prototype, 'is_skip_taskbar', original => function () {
            return isRenderer(this) || original.call(this);
        });

        // no minimize or map animations
        inject(WindowManager.WindowManager.prototype, '_shouldAnimateActor', original => function (actor, types) {
            return !isRenderer(actor.meta_window) && original.call(this, actor, types);
        });

        // the dash, docks, dash-to-panel and the app switcher
        inject(Shell.WindowTracker.prototype, 'get_window_app', original => function (win) {
            return isRenderer(win) ? null : original.call(this, win);
        });
        inject(Shell.App.prototype, 'get_windows', original => function () {
            return original.call(this).filter(win => !isRenderer(win));
        });
        inject(Shell.App.prototype, 'get_n_windows', () => function () {
            return this.get_windows().length;
        });
        inject(Shell.AppSystem.prototype, 'get_running', original => function () {
            return original.call(this).filter(app => app.get_n_windows() > 0);
        });
    }

    destroy() {
        this._injections.clear();
        this._injections = null;
    }
}
