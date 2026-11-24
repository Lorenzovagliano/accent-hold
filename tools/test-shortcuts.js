#!/usr/bin/env -S gjs -m

import GLib from 'gi://GLib';
import {
    buildAccelerators,
    letterFromKeySymbol,
} from '../extension/shortcutUtils.js';

function assertEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

const table = {
    e: ['é'],
    E: ['É'],
    b: [],
    '?': ['¿'],
    é: ['ê'],
    x: 'not-an-array',
};

assertEqual(buildAccelerators(table), [
    '<Shift><Control><Super>e',
    '<Control><Super>e',
], 'accelerators follow the active ASCII letter table');

assertEqual(letterFromKeySymbol('e'.codePointAt(0), false), 'e',
    'lowercase shortcut');
assertEqual(letterFromKeySymbol('e'.codePointAt(0), true), 'E',
    'Shift requests uppercase');
// Ctrl can affect the keysym's case, so verify both keysyms against the
// explicit Shift/Caps Lock state for every supported ASCII letter.
for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
    for (const symbol of [letter, letter.toUpperCase()]) {
        for (const [shifted, capsLocked, uppercase] of [
            [false, false, false],
            [true, false, true],
            [false, true, true],
            [true, true, false],
        ]) {
            assertEqual(
                letterFromKeySymbol(symbol.codePointAt(0), shifted, capsLocked),
                uppercase ? letter.toUpperCase() : letter,
                `${symbol}: Shift=${shifted}, Caps Lock=${capsLocked}`,
            );
        }
    }
}
assertEqual(letterFromKeySymbol('1'.codePointAt(0), false), '',
    'non-letter keysyms are rejected');
assertEqual(letterFromKeySymbol('1'.codePointAt(0), false, true), '',
    'Caps Lock does not turn non-letter keysyms into letters');

const [ok, bytes] = GLib.file_get_contents('extension/accents.json');
if (!ok)
    throw new Error('cannot read extension/accents.json');
const defaultTable = JSON.parse(new TextDecoder().decode(bytes));
const defaultAccelerators = buildAccelerators(defaultTable);
assertEqual(defaultAccelerators.length, 20,
    'all built-in lowercase and uppercase letters have shortcuts');
assertEqual(defaultAccelerators.includes('<Control><Super>e'), true,
    'built-in lowercase shortcut');
assertEqual(defaultAccelerators.includes('<Shift><Control><Super>e'), true,
    'built-in uppercase shortcut');

print('OK: direct shortcut helpers');
