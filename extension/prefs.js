import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Libellés lisibles pour quelques layouts xkb courants ; sinon on affiche l'id
// brut. Fonction (et non const) pour que _() s'exécute À L'USAGE, après que le
// domaine gettext soit résolu — pas au moment de l'import du module.
function layoutLabels() {
    return {
        'fr': _('French (fr)'),
        'fr+oss': _('French (oss variant)'),
        'us': _('English US (us)'),
        'us+intl': _('English US International'),
        'gb': _('English GB (gb)'),
        'de': _('German (de)'),
        'es': _('Spanish (es)'),
        'it': _('Italian (it)'),
        'pt': _('Portuguese (pt)'),
        'be': _('Belgian (be)'),
        'ch': _('Swiss (ch)'),
        'ca': _('Canadian (ca)'),
    };
}

export default class AccentHoldPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('Accent Hold'),
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        });
        window.add(page);

        this._buildShortcutGroup(page, settings);
        this._buildBehaviorGroup(page, settings);
        this._buildAccentsGroup(page, settings);
        this._buildLayoutsGroup(page, settings);
    }

    // --------------------------------------------------------------- Raccourcis
    _buildShortcutGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Shortcuts'),
            description: _('Open the variants directly for a base letter.'),
        });
        page.add(group);

        const enabledRow = new Adw.SwitchRow({
            title: _('Enabled'),
            subtitle: _('Enable or disable all accent shortcuts.'),
        });
        group.add(enabledRow);
        settings.bind('enabled', enabledRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const lowercaseRow = new Adw.ActionRow({
            title: _('Lowercase accents'),
            subtitle: _('Press Ctrl+Super+letter, then choose a number.'),
        });
        group.add(lowercaseRow);

        const uppercaseRow = new Adw.ActionRow({
            title: _('Uppercase accents'),
            subtitle: _('Add Shift: Ctrl+Super+Shift+letter, then choose a number.'),
        });
        group.add(uppercaseRow);
    }

    // ------------------------------------------------------------- Comportement
    _buildBehaviorGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Behavior'),
        });
        page.add(group);

        const delayRow = new Adw.SpinRow({
            title: _('Delay before display'),
            subtitle: _('Milliseconds before the popup appears.'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 1000,
                step_increment: 10,
                page_increment: 100,
            }),
        });
        group.add(delayRow);
        settings.bind('delay-ms', delayRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);

        const timeoutRow = new Adw.SpinRow({
            title: _('Auto-close (failsafe)'),
            subtitle: _('Milliseconds before automatic close.'),
            adjustment: new Gtk.Adjustment({
                lower: 1000,
                upper: 30000,
                step_increment: 250,
                page_increment: 1000,
            }),
        });
        group.add(timeoutRow);
        settings.bind('popup-timeout-ms', timeoutRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
    }

    // ------------------------------------------------- Caractères accentuables
    _buildAccentsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Accentable characters'),
            description: _('JSON table: base key → list of accented variants.'),
        });
        page.add(group);

        const defaultJson = this._readDefaultAccents();

        const buffer = new Gtk.TextBuffer();
        const loadFromSettings = () => {
            const stored = settings.get_string('accents');
            buffer.text = stored && stored.trim() !== '' ? stored : defaultJson;
        };
        loadFromSettings();

        const textView = new Gtk.TextView({
            buffer: buffer,
            monospace: true,
            top_margin: 8,
            bottom_margin: 8,
            left_margin: 8,
            right_margin: 8,
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
        });

        const scrolled = new Gtk.ScrolledWindow({
            min_content_height: 220,
            vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        });
        scrolled.add_css_class('card');
        scrolled.set_child(textView);
        group.add(scrolled);

        // Ligne d'état + boutons.
        const statusRow = new Adw.ActionRow({
            title: 'JSON',
            subtitle: _('Modified = saved automatically.'),
        });

        const saveButton = new Gtk.Button({
            label: _('Save'),
            valign: Gtk.Align.CENTER,
        });
        const resetButton = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
        });
        resetButton.add_css_class('destructive-action');

        const setStatus = (msg, error) => {
            statusRow.subtitle = msg;
            if (error)
                statusRow.add_css_class('error');
            else
                statusRow.remove_css_class('error');
        };

        const save = () => {
            const text = buffer.text.trim();
            if (text === '' || text === defaultJson.trim()) {
                settings.set_string('accents', '');
                setStatus(_('Built-in default table active.'), false);
                return;
            }
            try {
                JSON.parse(text);
            } catch (e) {
                setStatus(_('Invalid JSON — not saved: ') + e.message, true);
                return;
            }
            settings.set_string('accents', text);
            setStatus(_('Saved.'), false);
        };

        saveButton.connect('clicked', save);

        // Sauvegarde automatique différée à la frappe.
        let saveTimer = 0;
        buffer.connect('changed', () => {
            if (saveTimer)
                GLib.source_remove(saveTimer);
            saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
                saveTimer = 0;
                save();
                return GLib.SOURCE_REMOVE;
            });
        });

        resetButton.connect('clicked', () => {
            settings.set_string('accents', '');
            buffer.text = defaultJson;
            setStatus(_('Reset to the built-in table.'), false);
        });

        statusRow.add_suffix(saveButton);
        statusRow.add_suffix(resetButton);
        group.add(statusRow);
    }

    _readDefaultAccents() {
        try {
            const file = this.dir.get_child('accents.json');
            const [ok, bytes] = file.load_contents(null);
            if (ok) {
                const decoder = new TextDecoder('utf-8');
                return decoder.decode(bytes);
            }
        } catch (e) {
            // ignore
        }
        return '{}';
    }

    // ------------------------------------------------------------------ Claviers
    _buildLayoutsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Keyboards'),
            description: _('Layouts where the accent shortcuts are active (none checked = all active).'),
        });
        page.add(group);

        let sources = [];
        try {
            const inputSettings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.input-sources',
            });
            // 'sources' est un a(ss) : (type, id) ; ex ('xkb','fr+oss').
            const variant = inputSettings.get_value('sources');
            const n = variant.n_children();
            for (let i = 0; i < n; i++) {
                const child = variant.get_child_value(i);
                const type = child.get_child_value(0).get_string()[0];
                const id = child.get_child_value(1).get_string()[0];
                if (type === 'xkb')
                    sources.push(id);
            }
        } catch (e) {
            sources = [];
        }

        // Dédoublonner.
        sources = [...new Set(sources)];

        if (sources.length === 0) {
            const empty = new Adw.ActionRow({
                title: _('No xkb layout detected'),
                subtitle: _('The accent shortcuts are active on all keyboards.'),
            });
            group.add(empty);
            return;
        }

        const enabledLayouts = () => settings.get_strv('layouts');
        const labels = layoutLabels();

        for (const id of sources) {
            const label = labels[id] || id;
            const row = new Adw.SwitchRow({
                title: label,
                subtitle: id,
            });
            // Coché si présent dans layouts, OU si layouts est vide (tous activés).
            const current = enabledLayouts();
            row.active = current.length === 0 || current.includes(id);

            row.connect('notify::active', () => {
                let list = enabledLayouts();
                const allIds = sources;
                // Si la liste était vide (= tous), on la matérialise d'abord.
                if (list.length === 0)
                    list = [...allIds];

                const set = new Set(list);
                if (row.active)
                    set.add(id);
                else
                    set.delete(id);

                let next = allIds.filter(x => set.has(x));
                // Si tous sont cochés, revenir à liste vide (= tous, sémantique défaut).
                if (next.length === allIds.length)
                    next = [];
                settings.set_strv('layouts', next);
            });

            group.add(row);
        }
    }
}
