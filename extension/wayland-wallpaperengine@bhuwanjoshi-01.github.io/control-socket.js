// Wayland Wallpaper Engine - one-way messages to wwe and the renderer
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const encoder = new TextEncoder();

// Sockets live in $XDG_RUNTIME_DIR/wwe: engine.sock (linux-wallpaperengine,
// patches/0002), supervisor.sock (`wwe run`) and mpv.sock (mpv JSON IPC).
export function runtimePath(name) {
    return GLib.build_filenamev([GLib.get_user_runtime_dir(), 'wwe', name]);
}

// Sends datagrams to a UNIX socket without ever blocking the compositor, e.g.
// when the receiver is stopped and its queue is full.
export class DatagramSender {
    constructor(socketName) {
        this._address = Gio.UnixSocketAddress.new(runtimePath(socketName));
        this._socket = Gio.Socket.new(Gio.SocketFamily.UNIX, Gio.SocketType.DATAGRAM, Gio.SocketProtocol.DEFAULT);
        this._socket.set_blocking(false);
    }

    // Returns false if nobody is listening or the receiver's queue is full.
    send(text) {
        try {
            this._socket.send_to(this._address, encoder.encode(text), null);
            return true;
        } catch {
            return false;
        }
    }

    close() {
        this._socket.close();
        this._socket = null;
    }
}
