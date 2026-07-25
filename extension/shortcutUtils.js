// Helpers purs pour générer et décoder les raccourcis sans dépendre du Shell.

export function buildAccelerators(table) {
    return Object.keys(table || {})
        .filter(letter =>
            /^[A-Za-z]$/.test(letter) &&
            Array.isArray(table[letter]) &&
            table[letter].length > 0)
        .sort()
        .map(letter => {
            const key = letter.toLowerCase();
            return letter === key
                ? `<Control><Super>${key}`
                : `<Shift><Control><Super>${key}`;
        });
}

export function letterFromKeySymbol(symbol, shifted) {
    const upperA = 'A'.codePointAt(0);
    const upperZ = 'Z'.codePointAt(0);
    const lowerA = 'a'.codePointAt(0);
    const lowerZ = 'z'.codePointAt(0);

    let letter = '';
    if (symbol >= lowerA && symbol <= lowerZ)
        letter = String.fromCodePoint(symbol);
    else if (symbol >= upperA && symbol <= upperZ)
        letter = String.fromCodePoint(symbol).toLowerCase();

    if (!letter)
        return '';
    return shifted ? letter.toUpperCase() : letter;
}
