// Wayland Wallpaper Engine - the live copy of the renderer inside GNOME's backgrounds
// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';

// A Clutter.Clone scales its source to its own allocation while painting, but
// reports the source's unscaled paint volume. When the clone is bigger than
// the source (cover scaling of a renderer smaller than the monitor), partial
// redraws of the extra area would skip it. Report the allocation instead.
const CoverClone = GObject.registerClass(
class CoverClone extends Clutter.Clone {
    vfunc_get_paint_volume(volume) {
        return volume.set_from_allocation(this);
    }
});

// Container for the clone inside a Meta.BackgroundActor.
//
// * It reports no preferred size: overview backgrounds size themselves
//   height-for-width (to keep the monitor's shape), and a child with a real
//   size would override that and squash the workspace previews.
// * It lays the clone out itself, like CSS background-size: cover. Doing this
//   in vfunc_allocate keeps it inside one layout pass; resizing the child from
//   an allocation signal re-queues layout forever and Clutter then never
//   paints it.
const CloneHolder = GObject.registerClass(
class CloneHolder extends Clutter.Actor {
    _init(monitorIndex) {
        super._init({x_expand: true, y_expand: true, reactive: false, clip_to_allocation: true});
        this.monitorIndex = monitorIndex;
        this._clone = new CoverClone({reactive: false});
        this.add_child(this._clone);
        this._source = null;
        this._sourceSignals = [];
        this.connect('destroy', () => this._untrackSource());
    }

    setSource(source) {
        if (this._clone.source !== source) {
            this._untrackSource();
            this._clone.source = source;
            if (source)
                this._trackSource(source);
        }
        this.visible = source !== null;
        this.queue_relayout();
    }

    _trackSource(source) {
        this._source = source;
        this._sourceSignals = [
            source.connect('notify::width', () => this.queue_relayout()),
            source.connect('notify::height', () => this.queue_relayout()),
            source.connect('destroy', () => {
                this._source = null;
                this._sourceSignals = [];
            }),
        ];
    }

    _untrackSource() {
        this._sourceSignals.forEach(id => this._source.disconnect(id));
        this._sourceSignals = [];
        this._source = null;
    }

    vfunc_get_preferred_width(_forHeight) {
        return [0, 0];
    }

    vfunc_get_preferred_height(_forWidth) {
        return [0, 0];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        const [width, height] = [box.get_width(), box.get_height()];
        const source = this._clone.source;
        let [w, h] = [width, height];
        if (source && source.width > 0 && source.height > 0) {
            const scale = Math.max(width / source.width, height / source.height);
            [w, h] = [Math.ceil(source.width * scale), Math.ceil(source.height * scale)];
        }
        const x = Math.floor((width - w) / 2);
        const y = Math.floor((height - h) / 2);
        this._clone.allocate(new Clutter.ActorBox({x1: x, y1: y, x2: x + w, y2: y + h}));
    }
});

// Puts a clone into every Meta.BackgroundActor: the desktop, the overview
// workspaces, the lock screen, and backgrounds other extensions create (e.g.
// blur-my-shell). New ones arrive through attach(), called by the
// BackgroundManager override in overrides.js.
export class BackgroundClones {
    constructor(sourceFor) {
        this._sourceFor = sourceFor;
        // CloneHolder -> the background actor's layout manager before we replaced it
        this._holders = new Map();
    }

    destroy() {
        for (const [holder, originalLayout] of [...this._holders]) {
            const backgroundActor = holder.get_parent();
            holder.destroy();
            backgroundActor.layout_manager = originalLayout;
        }
        this._holders.clear();
    }

    attachExisting() {
        const visit = actor => {
            if (actor instanceof Meta.BackgroundActor)
                this.attach(actor);
            else
                actor.get_children().forEach(visit);
        };
        visit(global.stage);
    }

    attach(backgroundActor) {
        if (backgroundActor.get_children().some(child => child instanceof CloneHolder))
            return;
        const holder = new CloneHolder(backgroundActor.monitor);
        this._holders.set(holder, backgroundActor.layout_manager);
        holder.connect('destroy', () => this._holders.delete(holder));
        backgroundActor.layout_manager = new Clutter.BinLayout();
        backgroundActor.add_child(holder);
        holder.setSource(this._sourceFor(holder.monitorIndex));
    }

    refresh() {
        for (const holder of this._holders.keys())
            holder.setSource(this._sourceFor(holder.monitorIndex));
    }
}
