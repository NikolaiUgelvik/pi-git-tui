const SIMPLE_ESCAPES = Object.freeze({
    a: 0x07,
    b: 0x08,
    t: 0x09,
    n: 0x0a,
    v: 0x0b,
    f: 0x0c,
    r: 0x0d,
    '"': 0x22,
    "\\": 0x5c,
});
function appendUtf8(bytes, value) {
    bytes.push(...Buffer.from(value, "utf8"));
}
function decodeOctal(value, offset) {
    const match = /^[0-7]{1,3}/u.exec(value.slice(offset));
    if (!match)
        return;
    const byte = Number.parseInt(match[0], 8);
    if (byte > 0xff) {
        throw new Error(`Git path contains an out-of-range octal escape: \\${match[0]}`);
    }
    return { byte, nextOffset: offset + match[0].length };
}
/** Decode one path token quoted by Git's quote.c C-style encoder. */
export function decodeGitQuotedPath(value) {
    if (!value.startsWith('"') || !value.endsWith('"')) {
        return value;
    }
    const body = value.slice(1, -1);
    const bytes = [];
    for (let offset = 0; offset < body.length;) {
        const codePoint = body.codePointAt(offset);
        if (codePoint === undefined)
            break;
        const character = String.fromCodePoint(codePoint);
        if (character !== "\\") {
            appendUtf8(bytes, character);
            offset += character.length;
            continue;
        }
        const escapeOffset = offset + 1;
        const escapedCharacter = body[escapeOffset];
        if (escapedCharacter === undefined) {
            throw new Error("Git path ends with an incomplete escape");
        }
        const simple = SIMPLE_ESCAPES[escapedCharacter];
        if (simple !== undefined) {
            bytes.push(simple);
            offset = escapeOffset + 1;
            continue;
        }
        const octal = decodeOctal(body, escapeOffset);
        if (!octal) {
            throw new Error(`Git path contains an unsupported escape: \\${escapedCharacter}`);
        }
        bytes.push(octal.byte);
        offset = octal.nextOffset;
    }
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    }
    catch (error) {
        throw new Error("Git path is not valid UTF-8 and cannot be represented safely", { cause: error });
    }
}
//# sourceMappingURL=git-path-quote.js.map