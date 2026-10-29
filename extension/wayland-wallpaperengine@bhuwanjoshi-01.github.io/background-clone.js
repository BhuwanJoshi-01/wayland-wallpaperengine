// Wayland Wallpaper Engine - actors used for the background clone
// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

// A Clutter.Clone scales its source to its own allocation while painting, but
// reports the source's unscaled paint volume. When the clone is bigger than
// the source (cover scaling of a renderer window smaller than the monitor),
// partial redraws of the extra area would skip it. Report the allocation.
export const CoverClone = GObject.registerClass(
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
// * It lays the clone out itself, like CSS background-size: cover (renderer
//   windows are not always monitor sized: GNOME keeps resizable windows such
//   as mpv above panels), so scale uniformly and crop instead of stretching.
//   Doing this in vfunc_allocate keeps it inside one layout pass; resizing the
//   child from an allocation signal re-queues layout forever and Clutter then
//   never paints it.
export const CloneHolder = GObject.registerClass(
class CloneHolder extends Clutter.Actor {
    _init(params) {
        super._init(params);
        this.clone = new CoverClone({reactive: false});
        this.add_child(this.clone);
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
        const source = this.clone.source;
        let [w, h] = [width, height];
        if (source && source.width > 0 && source.height > 0) {
            const scale = Math.max(width / source.width, height / source.height);
            [w, h] = [Math.ceil(source.width * scale), Math.ceil(source.height * scale)];
        }
        const x = Math.floor((width - w) / 2);
        const y = Math.floor((height - h) / 2);
        this.clone.allocate(new Clutter.ActorBox({x1: x, y1: y, x2: x + w, y2: y + h}));
    }
});
