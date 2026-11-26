// @ts-check
'use strict';

const vscode = require('vscode');
const wsl = require('./wsl');
const { State } = require('./state');
const { distroFromAuthority, authorityForDistro, recentForDistro } = require('./recent');

const CONFIG = 'wslp';

/** @type {State | undefined} */
let state;

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('wslp.switchDistro', () => withPlatformCheck(() => pickAndSwitch(false))),
        vscode.commands.registerCommand('wslp.shutdownDistro', () => withPlatformCheck(shutdownCommand)),
        vscode.commands.registerCommand('wslp.disableWindowRestore', disableWindowRestore)
    );

    if (process.platform !== 'win32') {
        // WSL only exists on Windows; nothing to do automatically elsewhere.
        return;
    }

    const current = currentDistro();
    try {
        state = new State(context.globalStorageUri.fsPath);
        state.registerWindow(process.pid, current);
        context.subscriptions.push({ dispose: () => state && state.unregisterWindow(process.pid) });
    } catch (e) {
        log(`Could not initialise state: ${errorMessage(e)}`);
        return;
    }

    // Don't block activation on UI.
    void (async () => {
        await handlePendingShutdown(current);
        if (state && state.claimLaunch(process.ppid)) {
            await promptOnLaunch(current);
        }
    })().catch(e => log(`Startup flow failed: ${errorMessage(e)}`));
}

function deactivate() {
    if (state) {
        state.unregisterWindow(process.pid);
    }
}

// ---------------------------------------------------------------------------
// Startup

/**
 * @param {string | undefined} current
 */
async function promptOnLaunch(current) {
    const config = vscode.workspace.getConfiguration(CONFIG);
    const isWslWindow = vscode.env.remoteName === 'wsl';
    const isEmptyLocalWindow =
        !vscode.env.remoteName && !vscode.workspace.workspaceFolders && !vscode.workspace.workspaceFile;

    if (isWslWindow && config.get('promptOnLaunch', true)) {
        await pickAndSwitch(true);
    } else if (isEmptyLocalWindow && config.get('promptInEmptyWindow', true)) {
        await pickAndSwitch(true);
    }
}

/**
 * Runs in the window we just switched into: offers to shut down the distro
 * the previous window was connected to.
 *
 * @param {string | undefined} current
 */
async function handlePendingShutdown(current) {
    if (!state) {
        return;
    }
    const pending = state.takePendingShutdown();
    if (!pending) {
        return;
    }
    const prev = pending.distro;
    if (current && current.toLowerCase() === prev.toLowerCase()) {
        return;
    }

    const others = state.otherWindowsUsing(prev, [process.pid, pending.fromPid]);
    if (others > 0) {
        log(`Not shutting down ${prev}: ${others} other window(s) still connected.`);
        return;
    }

    let running;
    try {
        running = await wsl.listRunning();
    } catch (e) {
        log(`Could not list running distros: ${errorMessage(e)}`);
        return;
    }
    if (!running.some(r => r.toLowerCase() === prev.toLowerCase())) {
        return;
    }

    const mode = vscode.workspace.getConfiguration(CONFIG).get('shutdownPrevious', 'ask');
    if (mode === 'never') {
        return;
    }
    if (mode === 'always') {
        await doShutdown(prev, false);
        return;
    }

    const SHUT = `Shut down ${prev}`;
    const ALWAYS = 'Always';
    const NEVER = 'Never';
    const choice = await vscode.window.showInformationMessage(
        `WSL distribution "${prev}" is still running in the background from your previous window. Shut it down to free its memory and CPU?`,
        SHUT,
        ALWAYS,
        NEVER
    );
    if (choice === ALWAYS) {
        await vscode.workspace.getConfiguration(CONFIG).update('shutdownPrevious', 'always', vscode.ConfigurationTarget.Global);
    } else if (choice === NEVER) {
        await vscode.workspace.getConfiguration(CONFIG).update('shutdownPrevious', 'never', vscode.ConfigurationTarget.Global);
        return;
    }
    if (choice === SHUT || choice === ALWAYS) {
        await doShutdown(prev, true);
    }
}

// ---------------------------------------------------------------------------
// Picker

/**
 * @typedef {vscode.QuickPickItem & { distro?: wsl.Distro }} DistroItem
 * @typedef {vscode.QuickPickItem & { open?: () => Thenable<unknown> }} TargetItem
 */

/**
 * @param {boolean} isLaunch
 */
async function pickAndSwitch(isLaunch) {
    const current = currentDistro();

    let distros;
    try {
        distros = await wsl.listDistros();
    } catch (e) {
        if (!isLaunch) {
            vscode.window.showErrorMessage(`WSLP: could not list WSL distributions: ${errorMessage(e)}`);
        }
        log(`listDistros failed: ${errorMessage(e)}`);
        return;
    }

    const exclude = new Set(
        vscode.workspace.getConfiguration(CONFIG).get('excludeDistros', []).map(n => String(n).toLowerCase())
    );
    distros = distros.filter(d => !exclude.has(d.name.toLowerCase()));

    if (distros.length === 0) {
        if (!isLaunch) {
            vscode.window.showInformationMessage('WSLP: no WSL distributions found.');
        }
        return;
    }
    // Nothing to choose between.
    if (isLaunch && distros.length === 1 && current && distros[0].name.toLowerCase() === current.toLowerCase()) {
        return;
    }

    const isCurrent = (/** @type {wsl.Distro} */ d) => !!current && d.name.toLowerCase() === current.toLowerCase();
    const rank = (/** @type {wsl.Distro} */ d) => (isCurrent(d) ? 0 : d.isDefault ? 1 : d.running ? 2 : 3);
    distros.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

    /** @type {DistroItem[]} */
    const items = distros.map(d => ({
        label: `$(${isCurrent(d) ? 'check' : 'terminal-linux'}) ${d.name}`,
        description: [
            isCurrent(d) ? 'this window' : undefined,
            d.isDefault ? 'default' : undefined,
            d.running ? 'running' : 'stopped',
        ]
            .filter(Boolean)
            .join(' · '),
        distro: d,
    }));

    const picked = /** @type {DistroItem | undefined} */ (
        await vscode.window.showQuickPick(items, {
            title: 'WSLP: Which WSL distribution do you want to work in?',
            placeHolder: current
                ? `Press Enter to stay in ${current}, or pick another distribution`
                : 'Pick a WSL distribution to open',
            ignoreFocusOut: isLaunch,
        })
    );
    if (!picked || !picked.distro || isCurrent(picked.distro)) {
        return;
    }

    await pickTargetAndOpen(picked.distro.name);
}

/**
 * Second step: which folder in the chosen distro. Opens it in this window.
 * @param {string} target
 * @returns {Promise<boolean>} whether a switch was started
 */
async function pickTargetAndOpen(target) {
    const recents = await getRecentForDistro(target);

    /** @type {TargetItem[]} */
    const items = recents.map(r => ({
        label: `$(${r.isWorkspace ? 'files' : 'folder'}) ${basename(r.uri.path)}`,
        description: r.uri.path,
        open: () =>
            vscode.commands.executeCommand('vscode.openFolder', r.uri, { forceReuseWindow: true }),
    }));
    if (items.length > 0) {
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    }
    items.push({
        label: '$(empty-window) Empty window',
        description: `Connect to ${target} without opening a folder`,
        open: () =>
            vscode.commands.executeCommand('vscode.newWindow', {
                remoteAuthority: authorityForDistro(target),
                reuseWindow: true,
            }),
    });

    const picked = /** @type {TargetItem | undefined} */ (
        await vscode.window.showQuickPick(items, {
            title: `WSLP: Open in ${target}`,
            placeHolder: 'Pick a recent folder',
            matchOnDescription: true,
            ignoreFocusOut: true,
        })
    );
    if (!picked || !picked.open) {
        return false;
    }

    // Leave a note for the window we're about to become, so it can offer to
    // shut down the distro this window was using.
    const prev = currentDistro();
    if (state && prev && prev.toLowerCase() !== target.toLowerCase()) {
        try {
            state.setPendingShutdown({ distro: prev, fromPid: process.pid, createdAt: Date.now() });
        } catch (e) {
            log(`Could not record pending shutdown: ${errorMessage(e)}`);
        }
    }

    await picked.open();
    return true;
}

/**
 * @param {string} distro
 */
async function getRecentForDistro(distro) {
    try {
        const recent = await vscode.commands.executeCommand('_workbench.getRecentlyOpened');
        return recentForDistro(recent, distro, raw => (raw instanceof vscode.Uri ? raw : vscode.Uri.from(raw)));
    } catch (e) {
        log(`Could not read recently opened list: ${errorMessage(e)}`);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Shutdown command

async function shutdownCommand() {
    let running;
    try {
        running = await wsl.listRunning();
    } catch (e) {
        vscode.window.showErrorMessage(`WSLP: could not list WSL distributions: ${errorMessage(e)}`);
        return;
    }
    if (running.length === 0) {
        vscode.window.showInformationMessage('WSLP: no WSL distributions are running.');
        return;
    }

    const current = currentDistro();
    const picked = await vscode.window.showQuickPick(
        running.map(name => {
            const others = state ? state.otherWindowsUsing(name, [process.pid]) : 0;
            const notes = [];
            if (current && current.toLowerCase() === name.toLowerCase()) {
                notes.push('this window');
            }
            if (others > 0) {
                notes.push(`${others} other window${others === 1 ? '' : 's'}`);
            }
            return { label: name, description: notes.join(' · ') };
        }),
        { title: 'WSLP: Shut down a running WSL distribution', placeHolder: 'Pick a distribution to shut down' }
    );
    if (!picked) {
        return;
    }
    await doShutdown(picked.label, true);
}

/**
 * @param {string} name
 * @param {boolean} confirmIfInUse
 */
async function doShutdown(name, confirmIfInUse) {
    const current = currentDistro();
    const inThisWindow = !!current && current.toLowerCase() === name.toLowerCase();
    const others = state ? state.otherWindowsUsing(name, [process.pid]) : 0;

    if (confirmIfInUse && (inThisWindow || others > 0)) {
        const where = [inThisWindow ? 'this window' : undefined, others > 0 ? `${others} other window(s)` : undefined]
            .filter(Boolean)
            .join(' and ');
        const ok = await vscode.window.showWarningMessage(
            `"${name}" is in use by ${where}. Shutting it down will disconnect ${others + (inThisWindow ? 1 : 0) === 1 ? 'it' : 'them'} and stop everything running inside it.`,
            { modal: true },
            'Shut Down'
        );
        if (ok !== 'Shut Down') {
            return;
        }
    }

    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Shutting down ${name}…` },
            () => wsl.terminate(name)
        );
        vscode.window.setStatusBarMessage(`$(check) WSL distribution ${name} shut down`, 5000);
    } catch (e) {
        vscode.window.showErrorMessage(`WSLP: could not shut down ${name}: ${errorMessage(e)}`);
    }
}

// ---------------------------------------------------------------------------
// Window restore

async function disableWindowRestore() {
    const ok = await vscode.window.showInformationMessage(
        'This sets "window.restoreWindows" to "none", so VS Code starts with an empty window instead of reconnecting to the last WSL distribution. WSLP will then ask which distribution to open, and no distribution starts until you pick one. This applies to all windows, including local ones.',
        { modal: true },
        'Apply'
    );
    if (ok !== 'Apply') {
        return;
    }
    await vscode.workspace.getConfiguration('window').update('restoreWindows', 'none', vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration(CONFIG).update('promptInEmptyWindow', true, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('WSLP: VS Code will no longer reopen your last window on startup.');
}

// ---------------------------------------------------------------------------
// Helpers

/** @returns {string | undefined} */
function currentDistro() {
    if (vscode.env.remoteName !== 'wsl') {
        return undefined;
    }
    const candidates = [vscode.workspace.workspaceFile, ...(vscode.workspace.workspaceFolders || []).map(f => f.uri)];
    for (const uri of candidates) {
        if (uri && uri.scheme === 'vscode-remote') {
            const d = distroFromAuthority(uri.authority);
            if (d) {
                return d;
            }
        }
    }
    // An empty WSL window has no URI to read the authority from.
    return undefined;
}

/**
 * @param {() => Promise<void>} fn
 */
async function withPlatformCheck(fn) {
    if (process.platform !== 'win32') {
        vscode.window.showWarningMessage(
            'WSLP needs to run on the Windows side of VS Code. Install it locally (not in WSL).'
        );
        return;
    }
    await fn();
}

/** @type {vscode.OutputChannel | undefined} */
let channel;
/** @param {string} msg */
function log(msg) {
    if (!channel) {
        channel = vscode.window.createOutputChannel('WSLP');
    }
    channel.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

/** @param {unknown} e */
function errorMessage(e) {
    return e instanceof Error ? e.message : String(e);
}

/** @param {string} p */
function basename(p) {
    const parts = p.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : p;
}

module.exports = { activate, deactivate };
