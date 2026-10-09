import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {GlassController} from './glass.js';

const SOCKET_NAME = 'clui-gnome-shell.sock';
const PROTOCOL = 1;
const MAX_LINE_LENGTH = 4 * 1024 * 1024;
const MAX_QUEUED_BYTES = 1024 * 1024;
const READ_CHUNK = 65536;
const ACTIVATE_TIMEOUT_MS = 2000;
const ACCELERATOR_PATTERN = /^(?:<(?:Control|Shift|Alt|Super)>)+[A-Za-z0-9_]+$/;
const SHORTCUT_MODES = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;

class Peer {
    constructor(connection, onMessage, onClose) {
        this._connection = connection;
        this._onMessage = onMessage;
        this._onClose = onClose;
        this._cancellable = new Gio.Cancellable();
        this._input = connection.get_input_stream();
        this._output = connection.get_output_stream();
        this._encoder = new TextEncoder();
        this._decoder = new TextDecoder();
        this._pending = new Uint8Array(0);
        this._queue = [];
        this._queuedBytes = 0;
        this._writing = false;
        this._closed = false;
        this.pid = Peer.credentialsPid(connection);
        this._read();
    }

    static credentialsPid(connection) {
        try {
            return connection.get_socket().get_credentials().get_unix_pid();
        } catch {
            return -1;
        }
    }

    _read() {
        this._input.read_bytes_async(READ_CHUNK, GLib.PRIORITY_DEFAULT, this._cancellable, (stream, result) => {
            if (this._closed)
                return;
            try {
                const data = stream.read_bytes_finish(result)?.toArray() ?? null;
                if (!data || data.length === 0) {
                    this.close();
                    return;
                }
                this._consume(data);
            } catch (e) {
                console.error(`Clui CC: peer read failed: ${e}`);
                this.close();
                return;
            }
            if (!this._closed)
                this._read();
        });
    }

    _consume(data) {
        const merged = new Uint8Array(this._pending.length + data.length);
        merged.set(this._pending);
        merged.set(data, this._pending.length);
        let start = 0;
        let index = merged.indexOf(10, start);
        while (index >= 0 && !this._closed) {
            const line = this._decoder.decode(merged.subarray(start, index));
            start = index + 1;
            this._dispatch(line);
            index = merged.indexOf(10, start);
        }
        this._pending = merged.slice(start);
        if (this._pending.length > MAX_LINE_LENGTH)
            this.close();
    }

    _dispatch(line) {
        if (line.length === 0 || line.length > MAX_LINE_LENGTH)
            return;
        let message = null;
        try {
            message = JSON.parse(line);
        } catch {
            return;
        }
        if (!message || typeof message.type !== 'string')
            return;
        try {
            this._onMessage(message);
        } catch (e) {
            console.error(`Clui CC: failed to handle ${message.type}: ${e}`);
        }
    }

    send(message) {
        if (this._closed)
            return;
        const chunk = this._encoder.encode(`${JSON.stringify(message)}\n`);
        this._queuedBytes += chunk.length;
        if (this._queuedBytes > MAX_QUEUED_BYTES) {
            this.close();
            return;
        }
        this._queue.push(chunk);
        this._flush();
    }

    _flush() {
        if (this._writing || this._closed || this._queue.length === 0)
            return;
        this._writing = true;
        const chunk = this._queue[0];
        this._output.write_bytes_async(new GLib.Bytes(chunk), GLib.PRIORITY_DEFAULT, this._cancellable, (stream, result) => {
            this._writing = false;
            if (this._closed)
                return;
            let written = 0;
            try {
                written = stream.write_bytes_finish(result);
            } catch {
                this.close();
                return;
            }
            this._queuedBytes = Math.max(this._queuedBytes - written, 0);
            if (written < chunk.length)
                this._queue[0] = chunk.subarray(written);
            else
                this._queue.shift();
            this._flush();
        });
    }

    close() {
        if (this._closed)
            return;
        this._closed = true;
        this._queue = [];
        this._queuedBytes = 0;
        this._pending = new Uint8Array(0);
        this._cancellable.cancel();
        try {
            this._connection.close(null);
        } catch {}
        this._onClose(this);
    }
}

export default class CluiExtension extends Extension {
    enable() {
        this._peer = null;
        this._xid = 0;
        this._action = Meta.KeyBindingAction.NONE;
        this._pendingActivateId = 0;
        this._shownWindow = null;
        this._shownId = 0;
        this._signals = [];
        this._service = null;
        this._incomingId = 0;
        this._glass = null;
        try {
            this._glass = new GlassController({
                isClientWindow: window => this._isClientWindow(window),
                send: message => this._peer?.send(message),
            });
        } catch (e) {
            console.error(`Clui CC: glass unavailable: ${e}`);
            this._glass = null;
        }
        this._connectSignal(global.display, 'accelerator-activated', (display, action) => this._onAccelerator(action));
        this._connectSignal(global.display, 'window-created', (display, window) => this._onWindowCreated(window));
        this._connectSignal(global.display, 'notify::focus-window', () => this._peer?.send({type: 'focus-changed'}));
        this._startServer();
    }

    disable() {
        this._clearPendingActivate();
        this._disconnectShown();
        this._ungrab();
        for (const [object, id] of this._signals) {
            try {
                object.disconnect(id);
            } catch {}
        }
        this._signals = [];
        const glass = this._glass;
        this._glass = null;
        try {
            glass?.destroy();
        } catch (e) {
            console.error(`Clui CC: glass teardown failed: ${e}`);
        }
        const peer = this._peer;
        this._peer = null;
        peer?.close();
        this._stopServer();
    }

    _connectSignal(object, name, handler) {
        this._signals.push([object, object.connect(name, handler)]);
    }

    _socketPath() {
        return GLib.build_filenamev([GLib.get_user_runtime_dir(), SOCKET_NAME]);
    }

    _unlinkSocket() {
        try {
            Gio.File.new_for_path(this._socketPath()).delete(null);
        } catch {}
    }

    _socketServed() {
        try {
            const connection = new Gio.SocketClient().connect(Gio.UnixSocketAddress.new(this._socketPath()), null);
            connection.close(null);
            return true;
        } catch {
            return false;
        }
    }

    _startServer() {
        this._ownsSocket = false;
        if (this._socketServed()) {
            console.error('Clui CC: socket already served by another shell instance');
            return;
        }
        this._unlinkSocket();
        try {
            this._service = new Gio.SocketService();
            this._service.add_address(Gio.UnixSocketAddress.new(this._socketPath()), Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT, null);
            this._incomingId = this._service.connect('incoming', (service, connection) => {
                this._accept(connection);
                return true;
            });
            this._service.start();
            this._ownsSocket = true;
        } catch (e) {
            console.error(`Clui CC: socket unavailable: ${e}`);
            this._stopServer();
        }
    }

    _stopServer() {
        if (this._service) {
            try {
                if (this._incomingId)
                    this._service.disconnect(this._incomingId);
                this._service.stop();
                this._service.close();
            } catch {}
        }
        this._service = null;
        this._incomingId = 0;
        if (this._ownsSocket)
            this._unlinkSocket();
        this._ownsSocket = false;
    }

    _accept(connection) {
        if (this._peer) {
            try {
                connection.close(null);
            } catch {}
            return;
        }
        const peer = new Peer(connection, message => this._onMessage(peer, message), closed => this._onPeerClosed(closed));
        this._peer = peer;
    }

    _onPeerClosed(peer) {
        if (this._peer !== peer)
            return;
        this._peer = null;
        this._xid = 0;
        this._clearPendingActivate();
        this._disconnectShown();
        this._ungrab();
        try {
            this._glass?.reset();
        } catch (e) {
            console.error(`Clui CC: glass reset failed: ${e}`);
        }
    }

    _onMessage(peer, message) {
        if (this._peer !== peer)
            return;
        switch (message.type) {
        case 'hello':
            this._xid = Number.isSafeInteger(message.xid) && message.xid > 0 ? message.xid : 0;
            peer.send({type: 'hello', protocol: PROTOCOL, version: this.metadata['version-name'] ?? '', glass: this._glass?.available === true});
            this._glass?.refresh();
            break;
        case 'glass':
            this._glass?.setRegions(message);
            break;
        case 'sample':
            if (this._glass)
                this._glass.sample();
            else
                peer.send({type: 'tone', luminance: null});
            break;
        case 'shortcut':
            this._setShortcut(message.accelerator);
            break;
        case 'activate':
            this._activate();
            break;
        }
    }

    _onAccelerator(action) {
        if (action !== Meta.KeyBindingAction.NONE && action === this._action)
            this._peer?.send({type: 'shortcut-activated'});
    }

    _setShortcut(accelerator) {
        this._ungrab();
        if (typeof accelerator !== 'string')
            return;
        const action = ACCELERATOR_PATTERN.test(accelerator)
            ? global.display.grab_accelerator(accelerator, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT)
            : Meta.KeyBindingAction.NONE;
        if (action === Meta.KeyBindingAction.NONE) {
            this._peer?.send({type: 'shortcut-status', state: 'conflict'});
            return;
        }
        this._action = action;
        Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action), SHORTCUT_MODES);
        this._peer?.send({type: 'shortcut-status', state: 'active'});
    }

    _ungrab() {
        if (this._action === Meta.KeyBindingAction.NONE)
            return;
        const action = this._action;
        this._action = Meta.KeyBindingAction.NONE;
        try {
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action), Shell.ActionMode.NONE);
            global.display.ungrab_accelerator(action);
        } catch (e) {
            console.error(`Clui CC: failed to release shortcut: ${e}`);
        }
    }

    _isClientWindow(window) {
        if (!this._peer || !window || window.get_client_type() !== Meta.WindowClientType.X11)
            return false;
        const pid = this._peer.pid;
        if (pid <= 0 && this._xid <= 0)
            return false;
        if (pid > 0 && window.get_pid() !== pid)
            return false;
        if (this._xid <= 0)
            return true;
        const expected = `0x${this._xid.toString(16)}`;
        const description = window.get_description() ?? '';
        return description === expected || description.startsWith(`${expected} `);
    }

    _findWindow() {
        for (const actor of global.get_window_actors()) {
            const window = actor.get_meta_window();
            if (this._isClientWindow(window))
                return window;
        }
        return null;
    }

    _activate() {
        this._clearPendingActivate();
        const window = this._findWindow();
        if (window) {
            this._activateWhenShown(window);
            return;
        }
        this._pendingActivateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ACTIVATE_TIMEOUT_MS, () => {
            this._pendingActivateId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _onWindowCreated(window) {
        try {
            this._glass?.windowCreated(window);
        } catch (e) {
            console.error(`Clui CC: glass window tracking failed: ${e}`);
        }
        if (!this._pendingActivateId || !this._isClientWindow(window))
            return;
        this._clearPendingActivate();
        this._activateWhenShown(window);
    }

    _activateWhenShown(window) {
        this._disconnectShown();
        if (window.get_compositor_private()?.visible) {
            Main.activateWindow(window);
            return;
        }
        this._shownWindow = window;
        this._shownId = window.connect('shown', () => {
            this._disconnectShown();
            Main.activateWindow(window);
        });
    }

    _disconnectShown() {
        if (this._shownWindow && this._shownId) {
            try {
                this._shownWindow.disconnect(this._shownId);
            } catch {}
        }
        this._shownWindow = null;
        this._shownId = 0;
    }

    _clearPendingActivate() {
        if (this._pendingActivateId)
            GLib.source_remove(this._pendingActivateId);
        this._pendingActivateId = 0;
    }
}
