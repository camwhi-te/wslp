'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { decodeWslOutput, parseListVerbose, parseListQuiet } = require('../src/wsl');

const VERBOSE = [
    '  NAME                   STATE           VERSION',
    '* Ubuntu-22.04           Running         2',
    '  Debian                 Stopped         2',
    '  docker-desktop         Stopped         2',
    '',
].join('\r\n');

test('decodes UTF-16LE output with BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(VERBOSE, 'utf16le')]);
    assert.strictEqual(decodeWslOutput(buf), VERBOSE);
});

test('decodes UTF-8 output (WSL_UTF8=1)', () => {
    assert.strictEqual(decodeWslOutput(Buffer.from(VERBOSE, 'utf8')), VERBOSE);
});

test('decodes empty output', () => {
    assert.strictEqual(decodeWslOutput(Buffer.alloc(0)), '');
});

test('parses --list --verbose', () => {
    assert.deepStrictEqual(parseListVerbose(VERBOSE), [
        { name: 'Ubuntu-22.04', isDefault: true, state: 'Running', version: 2 },
        { name: 'Debian', isDefault: false, state: 'Stopped', version: 2 },
        { name: 'docker-desktop', isDefault: false, state: 'Stopped', version: 2 },
    ]);
});

test('parses localized header and state columns', () => {
    const de = ['  NAME      STATUS          VERSION', '* Ubuntu    Wird ausgeführt 2'].join('\n');
    assert.deepStrictEqual(parseListVerbose(de), [
        { name: 'Ubuntu', isDefault: true, state: 'Wird ausgeführt', version: 2 },
    ]);
});

test('parses --list --quiet', () => {
    assert.deepStrictEqual(parseListQuiet('Ubuntu-22.04\r\nDebian\r\n\r\n'), ['Ubuntu-22.04', 'Debian']);
});
