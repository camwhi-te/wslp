'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { State, PENDING_TTL_MS } = require('../src/state');

function tmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wslp-test-'));
}

test('claimLaunch succeeds once per main process', () => {
    const s = new State(tmp());
    assert.strictEqual(s.claimLaunch(100), true);
    assert.strictEqual(s.claimLaunch(100), false);
    assert.strictEqual(s.claimLaunch(100), false);
    // New app run (different main pid) prompts again and clears the old lock.
    assert.strictEqual(s.claimLaunch(200), true);
    assert.ok(!fs.existsSync(path.join(s.dir, 'launch-100.lock')));
});

test('otherWindowsUsing counts live windows on the distro', () => {
    const alive = new Set([1, 2, 3]);
    const s = new State(tmp(), pid => alive.has(pid));
    s.registerWindow(1, 'Ubuntu');
    s.registerWindow(2, 'ubuntu');
    s.registerWindow(3, 'Debian');
    s.registerWindow(4, 'Ubuntu'); // dead
    s.registerWindow(5, undefined);

    assert.strictEqual(s.otherWindowsUsing('Ubuntu', [1]), 1);
    assert.strictEqual(s.otherWindowsUsing('Ubuntu', []), 2);
    assert.strictEqual(s.otherWindowsUsing('Debian', [1]), 1);
    // Dead window record was cleaned up.
    assert.ok(!fs.existsSync(path.join(s.windowsDir, '4.json')));

    s.unregisterWindow(2);
    assert.strictEqual(s.otherWindowsUsing('Ubuntu', [1]), 0);
});

test('pending shutdown is taken once and expires', () => {
    const s = new State(tmp());
    assert.strictEqual(s.takePendingShutdown(), undefined);

    s.setPendingShutdown({ distro: 'Ubuntu', fromPid: 9, createdAt: 1000 });
    assert.deepStrictEqual(s.takePendingShutdown(1000 + 10), { distro: 'Ubuntu', fromPid: 9, createdAt: 1000 });
    assert.strictEqual(s.takePendingShutdown(1000 + 10), undefined);

    s.setPendingShutdown({ distro: 'Ubuntu', fromPid: 9, createdAt: 1000 });
    assert.strictEqual(s.takePendingShutdown(1000 + PENDING_TTL_MS + 1), undefined);
});
