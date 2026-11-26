// @ts-check
'use strict';

/**
 * Thin wrapper around wsl.exe. Runs on the Windows side (the extension is a
 * "ui" extension), so wsl.exe is always on PATH.
 */

const cp = require('child_process');

/**
 * @typedef {Object} Distro
 * @property {string} name
 * @property {boolean} isDefault
 * @property {boolean} running
 * @property {string} state   Raw (possibly localized) state column from `wsl -l -v`.
 * @property {number | undefined} version
 */

/**
 * wsl.exe writes UTF-16LE unless WSL_UTF8=1 is honoured (newer builds only),
 * so sniff for NUL bytes and decode accordingly.
 * @param {Buffer} buf
 * @returns {string}
 */
function decodeWslOutput(buf) {
    if (!buf || buf.length === 0) {
        return '';
    }
    let text = buf.includes(0) ? buf.toString('utf16le') : buf.toString('utf8');
    // Strip BOM and any stray NULs.
    return text.replace(/^﻿/, '').replace(/\u0000/g, '');
}

/**
 * Parse `wsl.exe --list --verbose`. The header row is localized, so it is
 * skipped positionally rather than matched by text.
 *
 *   NAME            STATE           VERSION
 * * Ubuntu          Running         2
 *   Debian          Stopped         2
 *
 * @param {string} text
 * @returns {Omit<Distro, 'running'>[]}
 */
function parseListVerbose(text) {
    const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim().length > 0);
    /** @type {Omit<Distro, 'running'>[]} */
    const result = [];
    for (const line of lines.slice(1)) {
        const isDefault = /^\s*\*/.test(line);
        const parts = line.replace(/^\s*\*?\s*/, '').split(/\s+/);
        if (parts.length < 3) {
            continue;
        }
        // Distro names can't contain whitespace, but localized states can
        // (e.g. German "Wird ausgeführt"), so: name, ...state, version.
        const name = parts[0];
        const versionText = parts[parts.length - 1];
        const state = parts.slice(1, -1).join(' ');
        const version = Number(versionText);
        result.push({ name, isDefault, state, version: Number.isFinite(version) ? version : undefined });
    }
    return result;
}

/**
 * Parse `wsl.exe --list --quiet` (one name per line).
 * @param {string} text
 * @returns {string[]}
 */
function parseListQuiet(text) {
    return text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
}

/**
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function runWsl(args, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        cp.execFile(
            'wsl.exe',
            args,
            {
                encoding: 'buffer',
                windowsHide: true,
                timeout: timeoutMs,
                env: { ...process.env, WSL_UTF8: '1' },
            },
            (err, stdout, stderr) => {
                // A non-zero exit is normal for e.g. "no running distributions".
                if (err && typeof err.code !== 'number') {
                    reject(err);
                    return;
                }
                resolve({
                    code: err && typeof err.code === 'number' ? err.code : 0,
                    stdout: decodeWslOutput(stdout),
                    stderr: decodeWslOutput(stderr),
                });
            }
        );
    });
}

/**
 * @returns {Promise<Distro[]>}
 */
async function listDistros() {
    const [verbose, running] = await Promise.all([
        runWsl(['--list', '--verbose']),
        runWsl(['--list', '--quiet', '--running']),
    ]);
    if (verbose.code !== 0) {
        throw new Error((verbose.stdout + verbose.stderr).trim() || `wsl.exe exited with code ${verbose.code}`);
    }
    const runningNames = new Set(
        running.code === 0 ? parseListQuiet(running.stdout).map(n => n.toLowerCase()) : []
    );
    return parseListVerbose(verbose.stdout).map(d => ({
        ...d,
        running: runningNames.has(d.name.toLowerCase()),
    }));
}

/**
 * @returns {Promise<string[]>}
 */
async function listRunning() {
    const res = await runWsl(['--list', '--quiet', '--running']);
    return res.code === 0 ? parseListQuiet(res.stdout) : [];
}

/**
 * @param {string} name
 */
async function terminate(name) {
    const res = await runWsl(['--terminate', name], 60000);
    if (res.code !== 0) {
        throw new Error((res.stdout + res.stderr).trim() || `wsl.exe --terminate exited with code ${res.code}`);
    }
}

module.exports = {
    decodeWslOutput,
    parseListVerbose,
    parseListQuiet,
    listDistros,
    listRunning,
    terminate,
};
