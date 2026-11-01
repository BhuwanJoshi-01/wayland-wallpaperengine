// Wayland Wallpaper Engine - top bar wallpaper picker
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Wallpaper Engine's own app runs under Proton and cannot apply wallpapers
// there, so this menu is the picker: thumbnails of every subscribed workshop
// item, search, volume, pausing, random, and a switch to follow the app.
// All state lives in the wwe config.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

const COLUMNS = 4;
const THUMB_WIDTH = 168;
const THUMB_HEIGHT = 95;
const GRID_HEIGHT = 440;
const VOLUME_DEBOUNCE_MS = 250;
const WORKSHOP_URI = 'steam://url/SteamWorkshopPage/431960';

// St.BoxLayout's "vertical" property became "orientation" in GNOME 48
const VERTICAL = parseInt(Config.PACKAGE_VERSION, 10) >= 48
    ? {orientation: Clutter.Orientation.VERTICAL}
    : {vertical: true};

function wweBinary() {
    return GLib.find_program_in_path('wwe') ??
        GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'wwe']);
}

// wwe does the actual work (scanning the workshop, changing the config); the
// running `wwe run` applies changes by itself.
function runWwe(args, cancellable) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = Gio.Subprocess.new([wweBinary(), ...args],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            reject(e);
            return;
        }
        proc.communicate_utf8_async(null, cancellable, (p, res) => {
            try {
                const [, stdout, stderr] = p.communicate_utf8_finish(res);
                if (p.get_successful())
                    resolve(stdout);
                else
                    reject(new Error(stderr.trim() || `wwe ${args.join(' ')} failed`));
            } catch (e) {
                reject(e);
            }
        });
    });
}

function logFailure(e) {
    console.error(`[wayland-wallpaperengine] ${e.message}`);
}

export const WallpaperMenu = GObject.registerClass(
class WallpaperMenu extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Wallpaper Engine');
        this.add_child(new St.Icon({
            icon_name: 'preferences-desktop-wallpaper-symbolic',
            style_class: 'system-status-icon',
        }));

        this._items = [];
        this._state = {};
        this._volumeTimeoutId = 0;
        this._syncingUi = false;
        this._cancellable = new Gio.Cancellable();

        this._header = new PopupMenu.PopupMenuItem('', {reactive: false, style_class: 'wwe-header'});
        this._header.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.menu.addMenuItem(this._header);

        const searchItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._search = new St.Entry({
            hint_text: 'Search wallpapers…',
            can_focus: true,
            x_expand: true,
            style_class: 'search-entry wwe-search',
        });
        this._search.clutter_text.connect('text-changed', () => this._fillGrid());
        searchItem.add_child(this._search);
        this.menu.addMenuItem(searchItem);

        const gridItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._scroll = new St.ScrollView({
            style: `height: ${GRID_HEIGHT}px;`,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
        });
        this._grid = new St.BoxLayout({...VERTICAL, style_class: 'wwe-grid'});
        this._scroll.set_child(this._grid);
        gridItem.add_child(this._scroll);
        this.menu.addMenuItem(gridItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const volumeItem = new PopupMenu.PopupBaseMenuItem({activate: false});
        this._volumeIcon = new St.Icon({icon_name: 'audio-volume-high-symbolic', style_class: 'popup-menu-icon'});
        this._volume = new Slider(0.5);
        this._volume.x_expand = true;
        this._volume.connect('notify::value', () => this._volumeChanged());
        volumeItem.add_child(this._volumeIcon);
        volumeItem.add_child(this._volume);
        this.menu.addMenuItem(volumeItem);

        this._pauseOnFocus = new PopupMenu.PopupSwitchMenuItem('Pause when an app is focused', true);
        this._pauseOnFocus.connect('toggled', (_item, state) => {
            if (!this._syncingUi)
                this._run(['config', `pause=${state ? 'focus' : 'fullscreen'}`]);
        });
        this.menu.addMenuItem(this._pauseOnFocus);

        this._follow = new PopupMenu.PopupSwitchMenuItem('Follow the Wallpaper Engine app', false);
        this._follow.connect('toggled', (_item, state) => {
            if (!this._syncingUi)
                this._run(state ? ['sync'] : ['sync', '--off']).then(() => this._refresh());
        });
        this.menu.addMenuItem(this._follow);

        this.menu.addAction('Random wallpaper', () => {
            this._run(['random']).then(() => this._refresh());
        });
        this.menu.addAction('Browse Steam Workshop', () => {
            Gio.AppInfo.launch_default_for_uri_async(WORKSHOP_URI, null, null, null);
        });

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._refresh();
        });

        // the extension also runs on the lock screen, for the live background
        this._sessionId = Main.sessionMode.connect('updated', () => this._syncVisibility());
        this._syncVisibility();
    }

    destroy() {
        if (this._volumeTimeoutId) {
            GLib.Source.remove(this._volumeTimeoutId);
            this._volumeTimeoutId = 0;
        }
        Main.sessionMode.disconnect(this._sessionId);
        this._cancellable.cancel();
        super.destroy();
    }

    _syncVisibility() {
        const allowed = !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter;
        if (!allowed)
            this.menu.close();
        this.visible = allowed;
    }

    // Resolves to wwe's output, or to null if it failed (the failure is logged).
    async _run(args) {
        try {
            return await runWwe(args, this._cancellable);
        } catch (e) {
            if (!this._cancellable.is_cancelled())
                logFailure(e);
            return null;
        }
    }

    async _refresh() {
        try {
            const [items, state] = await Promise.all([
                runWwe(['list', '--json'], this._cancellable).then(JSON.parse),
                runWwe(['state'], this._cancellable).then(JSON.parse),
            ]);
            this._items = items;
            this._state = state;
        } catch (e) {
            if (!this._cancellable.is_cancelled()) {
                this._header.label.text = `wwe is not working: ${e.message}`;
                logFailure(e);
            }
            return;
        }
        // the menu may have been destroyed while wwe was running
        if (this._cancellable.is_cancelled())
            return;

        const s = this._state;
        const origin = s.source === 'wallpaper-engine' && s.origin === 'wallpaper-engine'
            ? 'from Wallpaper Engine' : 'chosen here';
        this._header.label.text = s.current_title ? `${s.current_title}  ·  ${origin}` : 'No wallpaper';

        this._syncingUi = true;
        this._follow.setToggleState(s.source === 'wallpaper-engine');
        this._pauseOnFocus.setToggleState((s.pause ?? 'focus') === 'focus');
        this._volume.value = s.silent ? 0 : (s.volume ?? 50) / 100;
        this._syncingUi = false;
        this._updateVolumeIcon();

        this._fillGrid();
    }

    _fillGrid() {
        this._grid.destroy_all_children();
        const query = this._search.text.trim().toLowerCase();
        const items = this._items.filter(i => !query ||
            i.title.toLowerCase().includes(query) || i.type.includes(query) || i.id.includes(query));

        if (items.length === 0) {
            this._grid.add_child(new St.Label({
                text: this._items.length ? 'No matches' : 'No wallpapers yet. Subscribe to some in the Steam Workshop.',
                style_class: 'wwe-empty',
            }));
            return;
        }

        let row = null;
        items.forEach((item, index) => {
            if (index % COLUMNS === 0) {
                row = new St.BoxLayout({style_class: 'wwe-row'});
                this._grid.add_child(row);
            }
            row.add_child(this._makeTile(item));
        });
    }

    _makeTile(item) {
        const current = item.id === this._state.current_id;
        const box = new St.BoxLayout({...VERTICAL});

        const thumb = new St.Widget({
            style_class: 'wwe-thumb',
            layout_manager: new Clutter.BinLayout(),
            width: THUMB_WIDTH,
            height: THUMB_HEIGHT,
        });
        if (item.preview) {
            const uri = Gio.File.new_for_path(item.preview).get_uri();
            thumb.style = `background-image: url("${uri}"); background-size: cover; background-position: center;`;
        }
        thumb.add_child(new St.Label({
            text: item.type,
            style_class: `wwe-badge wwe-badge-${item.type}`,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            x_expand: true,
            y_expand: true,
        }));

        const label = new St.Label({text: item.title || item.id, style_class: 'wwe-title'});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        label.width = THUMB_WIDTH;

        box.add_child(thumb);
        box.add_child(label);

        const button = new St.Button({
            child: box,
            style_class: current ? 'wwe-tile wwe-tile-current' : 'wwe-tile',
            can_focus: true,
            reactive: true,
        });
        button.connect('clicked', () => {
            this.menu.close();
            this._run(['set', item.id]);
        });
        return button;
    }

    _volumeChanged() {
        this._updateVolumeIcon();
        if (this._syncingUi)
            return;
        if (this._volumeTimeoutId)
            GLib.Source.remove(this._volumeTimeoutId);
        this._volumeTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, VOLUME_DEBOUNCE_MS, () => {
            this._volumeTimeoutId = 0;
            const volume = Math.round(this._volume.value * 100);
            this._run(['config', `volume=${volume}`, `silent=${volume === 0}`]);
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateVolumeIcon() {
        const v = this._volume.value;
        const name = v === 0 ? 'muted' : v < 0.34 ? 'low' : v < 0.67 ? 'medium' : 'high';
        this._volumeIcon.icon_name = `audio-volume-${name}-symbolic`;
    }
});
