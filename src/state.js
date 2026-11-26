// @ts-check
'use strict';

/**
 * Cross-window coordination via small files in the extension's global storage
 * directory. Every VS Code window runs its own local extension host, so plain
 * files (with atomic create) are the simplest reliable shared state.
 */

const fs = require('fs');
const path = require('path');

/** How long a pending shutdown request stays valid after a switch. */
const PENDING_TTL_MS = 5 * 60 * 1000;

/**
 * @typedef {Object} PendingShutdown
 * @property {string} distro      Distro the user switched away from.
 * @property {number} fromPid     Extension host pid of the window that switched.
 * @property {number} createdAt
 */

/**
 * @param {number} pid
 */
function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // EPERM means it exists but we may not signal it.
        return /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM';
    }
}

class State {
    /**
     * @param {string} dir
     * @param {(pid: number) => boolean} [alive]
     */
    constructor(dir, alive = isAlive) {
        this.dir = dir;
        this.windowsDir = path.join(dir, 'windows');
        this.pendingFile = path.join(dir, 'pending-shutdown.json');
        this.alive = alive;
        fs.mkdirSync(this.windowsDir, { recursive: true });
    }

    /**
     * Returns true exactly once per VS Code application run, for whichever
     * window gets here first. All windows of one run share the same main
     * process, which is the parent of each window's extension host.
     * Reloading a window (including our own switch) keeps the same parent,
     * so it does not count as a new launch.
     *
     * @param {number} mainPid
     */
    claimLaunch(mainPid) {
        const lock = path.join(this.dir, `launch-${mainPid}.lock`);
        try {
            fs.writeFileSync(lock, String(Date.now()), { flag: 'wx' });
        } catch (e) {
            if (/** @type {NodeJS.ErrnoException} */ (e).code === 'EEXIST') {
                return false;
            }
            throw e;
        }
        for (const f of safeReaddir(this.dir)) {
            if (/^launch-\d+\.lock$/.test(f) && f !== path.basename(lock)) {
                safeUnlink(path.join(this.dir, f));
            }
        }
        return true;
    }

    /**
     * @param {number} pid
     * @param {string | undefined} distro
     */
    registerWindow(pid, distro) {
        fs.writeFileSync(path.join(this.windowsDir, `${pid}.json`), JSON.stringify({ pid, distro: distro ?? null }));
    }

    /** @param {number} pid */
    unregisterWindow(pid) {
        safeUnlink(path.join(this.windowsDir, `${pid}.json`));
    }

    /**
     * Number of other live windows connected to `distro`. Records left behind
     * by crashed windows are cleaned up on the way.
     *
     * @param {string} distro
     * @param {number[]} excludePids
     */
    otherWindowsUsing(distro, excludePids) {
        let count = 0;
        for (const f of safeReaddir(this.windowsDir)) {
            const m = /^(\d+)\.json$/.exec(f);
            if (!m) {
                continue;
            }
            const pid = Number(m[1]);
            if (excludePids.includes(pid)) {
                continue;
            }
            if (!this.alive(pid)) {
                safeUnlink(path.join(this.windowsDir, f));
                continue;
            }
            try {
                const rec = JSON.parse(fs.readFileSync(path.join(this.windowsDir, f), 'utf8'));
                if (typeof rec.distro === 'string' && rec.distro.toLowerCase() === distro.toLowerCase()) {
                    count++;
                }
            } catch {
                // Ignore unreadable records.
            }
        }
        return count;
    }

    /** @param {PendingShutdown} pending */
    setPendingShutdown(pending) {
        fs.writeFileSync(this.pendingFile, JSON.stringify(pending));
    }

    /**
     * Reads and removes the pending shutdown request, if one is still fresh.
     * @param {number} [now]
     * @returns {PendingShutdown | undefined}
     */
    takePendingShutdown(now = Date.now()) {
        let raw;
        try {
            raw = fs.readFileSync(this.pendingFile, 'utf8');
        } catch {
            return undefined;
        }
        safeUnlink(this.pendingFile);
        try {
            const p = JSON.parse(raw);
            if (typeof p.distro !== 'string' || typeof p.createdAt !== 'number') {
                return undefined;
            }
            if (now - p.createdAt > PENDING_TTL_MS) {
                return undefined;
            }
            return p;
        } catch {
            return undefined;
        }
    }
}

/** @param {string} dir */
function safeReaddir(dir) {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}

/** @param {string} file */
function safeUnlink(file) {
    try {
        fs.unlinkSync(file);
    } catch {
        // Already gone.
    }
}

module.exports = { State, PENDING_TTL_MS };
