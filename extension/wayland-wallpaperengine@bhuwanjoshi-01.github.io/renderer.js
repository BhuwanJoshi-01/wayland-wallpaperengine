// Wayland Wallpaper Engine - recognising renderer and desktop windows
// SPDX-License-Identifier: GPL-3.0-or-later

import GObject from 'gi://GObject';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Wayland app_ids of the renderers `wwe run` starts: the patched
// linux-wallpaperengine build and mpv (--wayland-app-id). Unpatched
// linux-wallpaperengine builds set no app_id, only this title.
export const ENGINE_APP_ID = 'linux-wallpaperengine';
export const VIDEO_APP_ID = 'wwe-video';
const ENGINE_FALLBACK_TITLE = 'wallpaperengine';

// Accepts a Meta.Window or a Meta.WindowActor: WorkspaceThumbnail._isOverviewWindow passes actors.
export function isRenderer(win) {
    if (win instanceof Meta.WindowActor)
        win = win.meta_window;
    if (!(win instanceof Meta.Window))
        return false;
    const appId = win.get_wm_class();
    if (appId)
        return appId === ENGINE_APP_ID || appId === VIDEO_APP_ID;
    return win.get_title() === ENGINE_FALLBACK_TITLE;
}

// A DESKTOP-type window, or the window of the Desktop Icons (DING)
// extension, which cannot set that type on Wayland.
export function isDesktopWindow(win) {
    if (!win)
        return false;
    if (win.get_window_type() === Meta.WindowType.DESKTOP)
        return true;
    return win.get_wm_class() === 'gjs' && (win.get_title() ?? '').startsWith('Desktop Icons');
}

// The user is looking at the desktop: nothing or the desktop is focused, and
// neither the overview nor the lock screen is showing.
export function desktopActive() {
    if (Main.sessionMode.isLocked || Main.overview.visible)
        return false;
    const focus = global.display.focus_window;
    return !focus || isDesktopWindow(focus) || isRenderer(focus);
}

// The window has drawn its first frame. get_texture() is null until then.
export function hasContent(windowActor) {
    const texture = windowActor.get_texture();
    if (!texture)
        return false;
    const [ok, width, height] = texture.get_preferred_size();
    return ok && width > 0 && height > 0;
}

// The renderer's main surface: the largest visible surface actor. Cloning it
// instead of the window actor leaves out what mutter draws around the
// client's buffer, e.g. the black backing of fullscreen windows.
// GObject registers MetaSurfaceActor with the first surface, which at login is
// after this module has loaded, so the type is looked up on every call.
export function contentActor(windowActor) {
    const surfaceType = GObject.type_from_name('MetaSurfaceActor');
    if (!surfaceType)
        return windowActor;

    let best = null;
    const visit = actor => {
        const isLarger = actor.width * actor.height > (best ? best.width * best.height : 0);
        if (actor.visible && GObject.type_is_a(actor.constructor.$gtype, surfaceType) && isLarger)
            best = actor;
        actor.get_children().forEach(visit);
    };
    visit(windowActor);
    return best ?? windowActor;
}
