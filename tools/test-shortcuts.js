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
assertEqual(letterFromKeySymbol('E'.codePointAt(0), false), 'e',
    'Caps Lock does not request uppercase');
assertEqual(letterFromKeySymbol('1'.codePointAt(0), false), '',
    'non-letter keysyms are rejected');

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
