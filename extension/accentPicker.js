import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as KeyboardStatus from 'resource:///org/gnome/shell/ui/status/keyboard.js';

// Sélecteur d'accents déclenché directement par Ctrl+Super+lettre.
//
// Conçu pour NE JAMAIS geler le clavier :
//   - try/catch dans le handler -> sur toute exception, on libère le grab
//   - failsafe : auto-fermeture après popup-timeout-ms quoi qu'il arrive
//   - on ferme le grab AVANT d'injecter
//   - on ne touche JAMAIS à Clutter.GrabState / Grab.get_seat_state
//     (inexistants en GNOME 50, mutter-18)
export class AccentPicker {
    // getSettings/getTable sont des callbacks (=> Gio.Settings / table objet),
    // pour toujours lire la valeur courante au moment du déclenchement.
    constructor(getSettings, getTable) {
        this._getSettings = getSettings;
        this._getTable = getTable;

        this._actor = null;
        this._grab = null;
        this._pendingLetter = null;
        this._variants = [];
        this._index = 0;
        this._chips = [];
        this._timeoutId = 0;       // failsafe popup-timeout-ms
        this._delayId = 0;         // latence delay-ms avant ouverture
        this._injectId = 0;        // idle d'injection différée
        this._restoreId = 0;       // timeout de restauration du presse-papier

        const seat = Clutter.get_default_backend().get_default_seat();
        this._vdev = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }

    // Point d'entrée appelé par le raccourci de la lettre concernée.
    start(letter) {
        // Jamais deux popups, ni un double déclenchement pendant la latence.
        if (this._actor || this._delayId)
            return;

        if (!this._layoutAllowed())
            return;

        const variants = (this._getTable() || {})[letter];
        if (!Array.isArray(variants) || variants.length === 0)
            return;
        this._pendingLetter = letter;

        const settings = this._getSettings();
        let delay = 0;
        try { delay = settings.get_int('delay-ms'); } catch (_e) {}
        if (delay < 0) delay = 0;

        if (delay === 0) {
            this._open();
            return;
        }
        this._delayId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._delayId = 0;
            this._open();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Restreint l'activation aux layouts xkb listés dans `layouts` (vide = tous).
    _layoutAllowed() {
        let wanted = [];
        try { wanted = this._getSettings().get_strv('layouts'); } catch (_e) {}
        if (!wanted || wanted.length === 0)
            return true;
        try {
            const mgr = KeyboardStatus.getInputSourceManager();
            const cur = mgr ? mgr.currentSource : null;
            if (!cur)
                return true; // impossible de déterminer -> on n'inhibe pas
            // prefs.js stocke l'id brut de input-sources ; le runtime peut voir
            // xkbId -> on compare aux DEUX pour rester cohérent.
            return wanted.includes(cur.xkbId) || wanted.includes(cur.id);
        } catch (_e) {
            return true;
        }
    }

    _open() {
        if (this._actor)
            return;

        const letter = this._pendingLetter;
        this._pendingLetter = null;
        const variants = (this._getTable() || {})[letter];
        if (!Array.isArray(variants) || variants.length === 0)
            return;

        this._variants = variants.slice(0, 9); // 1..9 maximum
        this._index = 0;
        this._chips = [];

        this._actor = new St.BoxLayout({
            style_class: 'accent-popup',
            reactive: true,
            can_focus: true,
            vertical: false,
        });
        this._chips = this._variants.map((variant, i) => {
            const chip = new St.Button({
                style_class: 'accent-chip',
                label: `${i + 1} ${variant}`,
                can_focus: false,
            });
            chip.connect('clicked', () => this._choose(i));
            this._actor.add_child(chip);
            return chip;
        });
        this._highlight();

        Main.layoutManager.uiGroup.add_child(this._actor);
        const [x, y] = global.get_pointer();
        this._actor.set_position(x, y + 24);

        // GNOME 50 (mutter-18) : on ne teste PAS l'état du grab
        // (Clutter.GrabState / Grab.get_seat_state n'existent pas et lèveraient
        // une exception laissant le grab pris -> clavier figé). Le failsafe
        // couvre tout échec.
        this._grab = Main.pushModal(this._actor, {actionMode: 1 /* NORMAL */});
        if (!this._grab) {
            this._close();
            return;
        }

        // FAILSAFE anti-freeze armé IMMÉDIATEMENT après le grab : même si
        // grab_key_focus()/connect levaient, la popup se fermera (jamais figé).
        let timeout = 6000;
        try { timeout = this._getSettings().get_int('popup-timeout-ms'); } catch (_e) {}
        if (timeout < 1000) timeout = 1000;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, () => {
            this._timeoutId = 0;
            this._close();
            return GLib.SOURCE_REMOVE;
        });

        try {
            this._actor.grab_key_focus();
            this._actor.connect('key-press-event', (_a, e) => this._onKey(e));
        } catch (e) {
            logError(e, 'accent-hold: open');
            this._close();
        }
    }

    _onKey(event) {
        try {
            const sym = event.get_key_symbol();
            if (sym === Clutter.KEY_Escape) {
                this._close();
                return Clutter.EVENT_STOP;
            }
            return this._onVariants(event, sym);
        } catch (e) {
            logError(e, 'accent-hold: key handler');
            this._close(); // sur exception : on libère TOUJOURS le grab
            return Clutter.EVENT_STOP;
        }
    }

    _onVariants(event, sym) {
        if (sym === Clutter.KEY_Left) {
            this._move(-1);
            return Clutter.EVENT_STOP;
        }
        if (sym === Clutter.KEY_Right) {
            this._move(1);
            return Clutter.EVENT_STOP;
        }
        if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter ||
            sym === Clutter.KEY_space) {
            this._choose(this._index);
            return Clutter.EVENT_STOP;
        }
        // Sélection par numéro, INDÉPENDANTE de la disposition clavier.
        const n = this._digitIndex(event, sym);
        if (n >= 0) {
            if (n < this._variants.length)
                this._choose(n);
            return Clutter.EVENT_STOP;
        }
        // Toute autre touche annule proprement (jamais coincé).
        this._close();
        return Clutter.EVENT_STOP;
    }

    // Renvoie l'index 0..8 si la touche désigne le chiffre 1..9, quel que soit
    // le layout, sinon -1. On se base D'ABORD sur le KEYCODE matériel : la rangée
    // de chiffres est à la même position physique en AZERTY/QWERTY/QWERTZ
    // (keycodes X11 10..18). En AZERTY, la touche « 1 » produit « & » (keysym
    // différent) mais garde le keycode 10 -> la sélection marche sans Shift.
    // On accepte aussi les keysyms chiffres (QWERTY / Shift+chiffre) et le pavé.
    _digitIndex(event, sym) {
        let code = 0;
        try { code = event.get_key_code(); } catch (_e) {}
        if (code >= 10 && code <= 18)
            return code - 10;
        if (sym >= Clutter.KEY_1 && sym <= Clutter.KEY_9)
            return sym - Clutter.KEY_1;
        if (sym >= Clutter.KEY_KP_1 && sym <= Clutter.KEY_KP_9)
            return sym - Clutter.KEY_KP_1;
        return -1;
    }

    _move(d) {
        const n = this._variants.length;
        if (n === 0)
            return;
        this._index = Math.max(0, Math.min(n - 1, this._index + d));
        this._highlight();
    }

    _highlight() {
        this._chips.forEach((c, i) =>
            i === this._index
                ? c.add_style_pseudo_class('selected')
                : c.remove_style_pseudo_class('selected'));
    }

    _choose(i) {
        const ch = this._variants[i];
        this._close();          // libère le grab AVANT d'injecter
        if (!ch)
            return;
        // Diffère d'un cycle : laisse popModal rendre le focus clavier à l'app
        // cible avant d'injecter (sinon le caractère pourrait se perdre).
        this._injectId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._injectId = 0;
            this._inject(ch);
            return GLib.SOURCE_REMOVE;
        });
    }

    // notify_keyval(0x01000000|codepoint) NE MARCHE PAS : mutter ne trouve pas
    // de keycode pour un keysym absent du layout ("No keycode found for keyval").
    // On colle donc le caractère via le presse-papier + Shift+Inser, dont les
    // keysyms (Shift_L, Insert) existent réellement. Shift+Inser colle la
    // sélection PRIMARY dans les terminaux (VTE) et le presse-papier CLIPBOARD
    // dans GTK -> on renseigne les DEUX. L'ancien presse-papier est restauré.
    _inject(ch) {
        try {
            const cb = St.Clipboard.get_default();
            cb.get_text(St.ClipboardType.CLIPBOARD, (_c, saved) => {
                cb.set_text(St.ClipboardType.CLIPBOARD, ch);
                cb.set_text(St.ClipboardType.PRIMARY, ch);
                this._pasteAndRestore(saved);
            });
        } catch (e) {
            logError(e, 'accent-hold: inject');
        }
    }

    _pasteAndRestore(saved) {
        if (!this._vdev)
            return;
        const t = Clutter.get_current_event_time();
        this._vdev.notify_keyval(t, Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
        this._vdev.notify_keyval(t, Clutter.KEY_Insert, Clutter.KeyState.PRESSED);
        this._vdev.notify_keyval(t, Clutter.KEY_Insert, Clutter.KeyState.RELEASED);
        this._vdev.notify_keyval(t, Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
        // restaure l'ancien presse-papier une fois la colle effectuée
        this._restoreId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._restoreId = 0;
            try {
                St.Clipboard.get_default()
                    .set_text(St.ClipboardType.CLIPBOARD, saved || '');
            } catch (e) {
                logError(e, 'accent-hold: restore clipboard');
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _close() {
        if (this._delayId) {
            GLib.source_remove(this._delayId);
            this._delayId = 0;
        }
        this._pendingLetter = null;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        if (this._actor) {
            Main.layoutManager.uiGroup.remove_child(this._actor);
            this._actor.destroy();
            this._actor = null;
        }
        this._chips = [];
        this._variants = [];
        this._index = 0;
    }

    destroy() {
        this._close();
        // annule une injection/restauration en vol (si disable() pendant la fenêtre)
        if (this._injectId) {
            GLib.source_remove(this._injectId);
            this._injectId = 0;
        }
        if (this._restoreId) {
            GLib.source_remove(this._restoreId);
            this._restoreId = 0;
        }
        this._vdev = null;
    }
}
