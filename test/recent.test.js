'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { distroFromAuthority, authorityForDistro, recentForDistro } = require('../src/recent');

test('distroFromAuthority', () => {
    assert.strictEqual(distroFromAuthority('wsl+Ubuntu-22.04'), 'Ubuntu-22.04');
    assert.strictEqual(distroFromAuthority('WSL+Debian'), 'Debian');
    assert.strictEqual(distroFromAuthority('ssh-remote+host'), undefined);
    assert.strictEqual(distroFromAuthority('wsl+'), undefined);
    assert.strictEqual(distroFromAuthority(undefined), undefined);
    assert.strictEqual(authorityForDistro('Debian'), 'wsl+Debian');
});

test('recentForDistro filters to the distro, keeps order, dedupes', () => {
    const recent = {
        workspaces: [
            { folderUri: { scheme: 'vscode-remote', authority: 'wsl+Ubuntu', path: '/home/me/a' } },
            { folderUri: { scheme: 'file', authority: '', path: '/c:/proj' } },
            { folderUri: { scheme: 'vscode-remote', authority: 'wsl+Debian', path: '/home/me/b' } },
            { workspace: { configPath: { scheme: 'vscode-remote', authority: 'wsl+ubuntu', path: '/home/me/x.code-workspace' } } },
            { folderUri: { scheme: 'vscode-remote', authority: 'wsl+Ubuntu', path: '/home/me/a' } },
            { folderUri: { scheme: 'vscode-remote', authority: 'ssh-remote+box', path: '/srv' } },
            {},
        ],
    };
    const res = recentForDistro(recent, 'Ubuntu', u => u);
    assert.deepStrictEqual(
        res.map(r => [r.uri.path, r.isWorkspace]),
        [
            ['/home/me/a', false],
            ['/home/me/x.code-workspace', true],
        ]
    );
});

test('recentForDistro tolerates bad input', () => {
    assert.deepStrictEqual(recentForDistro(undefined, 'Ubuntu', u => u), []);
    assert.deepStrictEqual(recentForDistro({ workspaces: 'nope' }, 'Ubuntu', u => u), []);
});
