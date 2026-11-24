import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {AccentPicker} from './accentPicker.js';
import {addIndicator} from './panelIndicator.js';
import {
    buildAccelerators,
    letterFromKeySymbol,
} from './shortcutUtils.js';

const KEYBINDING_NAME = 'letter-shortcuts';

// Extension « Accent Hold » : Ctrl+Super+lettre ouvre directement les variantes
// de cette lettre, en respectant Maj et Verr. Maj pour la casse.
export default class AccentHoldExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._table = this._loadTable();
        this._changedIds = [];
        this._bound = false;

        this._picker = new AccentPicker(
            () => this._settings,
            () => this._table,
        );

        this._bind();

        this._indicator = null;
        if (this._settings.get_boolean('show-indicator'))
            this._addIndicator();

        // Re-bind quand l'activation change.
        const rebind = () => {
            this._unbind();
            this._bind();
        };
        // Création / destruction de l'indicateur de barre à la volée.
        const toggleIndicator = () => {
            if (this._settings.get_boolean('show-indicator'))
                this._addIndicator();
            else
                this._removeIndicator();
        };
        // La table détermine désormais les lettres qui ont un raccourci.
        const reloadTable = () => {
            this._unbind();
            this._table = this._loadTable();
            this._bind();
        };
        this._changedIds.push(
            this._settings.connect('changed::enabled', rebind));
        this._changedIds.push(
            this._settings.connect('changed::accents', reloadTable));
        this._changedIds.push(
            this._settings.connect('changed::show-indicator', toggleIndicator));
    }

    disable() {
        this._unbind();
        this._removeIndicator();

        if (this._changedIds && this._settings) {
            for (const id of this._changedIds)
                this._settings.disconnect(id);
        }
        this._changedIds = [];

        if (this._picker) {
            this._picker.destroy();
            this._picker = null;
        }
        this._settings = null;
        this._table = null;
    }

    _addIndicator() {
        if (this._indicator)
            return;
        const iconPath = this.path + '/icons/accent-hold-symbolic.svg';
        this._indicator = addIndicator(
            this.uuid,
            this._settings,
            iconPath,
            () => this.openPreferences(),
            _,
        );
    }

    _removeIndicator() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _bind() {
        if (this._bound)
            return;
        if (!this._settings.get_boolean('enabled'))
            return;

        // Mutter exige que les accélérateurs d'un keybinding proviennent d'une
        // clé GSettings de type `as`. Cette clé est interne et régénérée depuis
        // la table active, afin que les ajouts/retraits JSON prennent effet.
        const accelerators = buildAccelerators(this._table);
        const current = this._settings.get_strv(KEYBINDING_NAME);
        if (current.length !== accelerators.length ||
            current.some((value, i) => value !== accelerators[i]))
            this._settings.set_strv(KEYBINDING_NAME, accelerators);
        if (accelerators.length === 0)
            return;

        const action = Main.wm.addKeybinding(
            KEYBINDING_NAME,
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            // NORMAL (+ OVERVIEW) : pas sur l'écran de verrouillage (sécurité,
            // exigence EGO). Suffit pour saisir des accents dans une app.
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            (_display, _window, event) => {
                const letter = this._letterFromEvent(event);
                if (letter)
                    this._picker.start(letter);
            },
        );
        this._bound = action !== Meta.KeyBindingAction.NONE;
    }

    _unbind() {
        if (!this._bound)
            return;
        Main.wm.removeKeybinding(KEYBINDING_NAME);
        this._bound = false;
    }

    // Le keysym identifie la lettre même avec Ctrl enfoncé ; les modificateurs
    // de l'événement déterminent la casse (Maj inverse Verr. Maj).
    _letterFromEvent(event) {
        if (!event)
            return '';
        try {
            return letterFromKeySymbol(
                event.get_key_symbol(),
                event.has_shift_modifier(),
                !!(event.get_state() & Clutter.ModifierType.LOCK_MASK),
            );
        } catch (e) {
            logError(e, 'accent-hold: read shortcut letter');
            return '';
        }
    }

    // Charge la table d'accents : JSON du réglage `accents` s'il est non vide,
    // sinon le fichier accents.json embarqué dans l'extension.
    _loadTable() {
        try {
            const override = this._settings.get_string('accents');
            if (override && override.trim() !== '')
                return JSON.parse(override);
        } catch (e) {
            logError(e, 'accent-hold: parse accents setting');
        }
        try {
            const path = this.path + '/accents.json';
            const [ok, bytes] = GLib.file_get_contents(path);
            if (!ok)
                return {};
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            logError(e, 'accent-hold: load accents.json');
            return {};
        }
    }
}
