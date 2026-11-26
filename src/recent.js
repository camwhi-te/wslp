// @ts-check
'use strict';

/**
 * Helpers for WSL remote authorities and the "recently opened" list.
 * Kept free of the `vscode` module so they can be unit tested with plain Node.
 */

const AUTHORITY_PREFIX = 'wsl+';

/**
 * @param {string | undefined} authority  e.g. "wsl+Ubuntu-22.04"
 * @returns {string | undefined}
 */
function distroFromAuthority(authority) {
    if (!authority || !authority.toLowerCase().startsWith(AUTHORITY_PREFIX)) {
        return undefined;
    }
    let name = authority.slice(AUTHORITY_PREFIX.length);
    try {
        name = decodeURIComponent(name);
    } catch {
        // Leave as-is.
    }
    return name || undefined;
}

/** @param {string} distro */
function authorityForDistro(distro) {
    return AUTHORITY_PREFIX + distro;
}

/**
 * @typedef {{ scheme: string, authority: string, path: string }} UriLike
 * @typedef {{ uri: UriLike, isWorkspace: boolean, label: string }} RecentEntry
 */

/**
 * Picks out the recent folders / workspaces that live in `distro`, in MRU order.
 *
 * @param {any} recentlyOpened  Result of the `_workbench.getRecentlyOpened` command.
 * @param {string} distro
 * @param {(raw: any) => UriLike} toUri  Revives serialized URIs.
 * @returns {RecentEntry[]}
 */
function recentForDistro(recentlyOpened, distro, toUri) {
    const entries = recentlyOpened && Array.isArray(recentlyOpened.workspaces) ? recentlyOpened.workspaces : [];
    /** @type {RecentEntry[]} */
    const out = [];
    const seen = new Set();
    for (const entry of entries) {
        const isWorkspace = !entry.folderUri && !!(entry.workspace && entry.workspace.configPath);
        const raw = entry.folderUri || (entry.workspace && entry.workspace.configPath);
        if (!raw) {
            continue;
        }
        let uri;
        try {
            uri = toUri(raw);
        } catch {
            continue;
        }
        if (uri.scheme !== 'vscode-remote') {
            continue;
        }
        const d = distroFromAuthority(uri.authority);
        if (!d || d.toLowerCase() !== distro.toLowerCase()) {
            continue;
        }
        const key = uri.path;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push({ uri, isWorkspace, label: entry.label || uri.path });
    }
    return out;
}

module.exports = { distroFromAuthority, authorityForDistro, recentForDistro };
