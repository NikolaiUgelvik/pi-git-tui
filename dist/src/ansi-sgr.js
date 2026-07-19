const ESCAPE = "\x1b";
const TAB_SPACES = "    ";
export function emptySgrState() {
    return {
        bold: false,
        faint: false,
        italic: false,
        underline: false,
        inverse: false,
        strikethrough: false,
    };
}
function cloneState(state) {
    return { ...state };
}
function resetState(state) {
    Object.assign(state, emptySgrState());
    delete state.foreground;
    delete state.background;
}
function extendedColor(values, index) {
    const mode = values[index + 1];
    if (mode === 5 && Number.isInteger(values[index + 2])) {
        return { value: `${values[index]};5;${values[index + 2]}`, consumed: 3 };
    }
    if (mode === 2 &&
        Number.isInteger(values[index + 2]) &&
        Number.isInteger(values[index + 3]) &&
        Number.isInteger(values[index + 4])) {
        return {
            value: `${values[index]};2;${values[index + 2]};${values[index + 3]};${values[index + 4]}`,
            consumed: 5,
        };
    }
    return { consumed: 1 };
}
function applySgrAttribute(state, value) {
    switch (value) {
        case 0:
            resetState(state);
            break;
        case 1:
            state.bold = true;
            break;
        case 2:
            state.faint = true;
            break;
        case 3:
            state.italic = true;
            break;
        case 4:
            state.underline = true;
            break;
        case 7:
            state.inverse = true;
            break;
        case 9:
            state.strikethrough = true;
            break;
        case 22:
            state.bold = false;
            state.faint = false;
            break;
        case 23:
            state.italic = false;
            break;
        case 24:
            state.underline = false;
            break;
        case 27:
            state.inverse = false;
            break;
        case 29:
            state.strikethrough = false;
            break;
        default:
            return false;
    }
    return true;
}
function applySgrColor(state, values, index) {
    const value = values[index] ?? 0;
    if ((value >= 30 && value <= 37) || (value >= 90 && value <= 97))
        state.foreground = String(value);
    else if ((value >= 40 && value <= 47) || (value >= 100 && value <= 107))
        state.background = String(value);
    else if (value === 39)
        delete state.foreground;
    else if (value === 49)
        delete state.background;
    else if (value === 38 || value === 48) {
        const color = extendedColor(values, index);
        if (color.value) {
            if (value === 38)
                state.foreground = color.value;
            else
                state.background = color.value;
        }
        return color.consumed;
    }
    return 1;
}
function applySgrValues(state, values) {
    for (let index = 0; index < values.length;) {
        const value = values[index] ?? 0;
        index += applySgrAttribute(state, value) ? 1 : applySgrColor(state, values, index);
    }
}
function readSgrCode(text, index) {
    if (text[index] !== ESCAPE || text[index + 1] !== "[")
        return;
    let end = index + 2;
    while (end < text.length && /[0-9;]/u.test(text[end] ?? ""))
        end++;
    if (text[end] !== "m")
        return;
    const parameters = text.slice(index + 2, end);
    const rawValues = parameters === "" ? ["0"] : parameters.split(";");
    if (rawValues.some((value) => value !== "" && !/^\d+$/u.test(value)))
        return;
    return {
        length: end + 1 - index,
        values: rawValues.map((value) => (value === "" ? 0 : Number(value))),
    };
}
export function canonicalSgrPrefix(state) {
    const values = [];
    if (state.bold)
        values.push("1");
    if (state.faint)
        values.push("2");
    if (state.italic)
        values.push("3");
    if (state.underline)
        values.push("4");
    if (state.inverse)
        values.push("7");
    if (state.strikethrough)
        values.push("9");
    if (state.foreground)
        values.push(state.foreground);
    if (state.background)
        values.push(state.background);
    return values.length === 0 ? "" : `${ESCAPE}[${values.join(";")}m`;
}
export function sgrStateFromAnsi(ansi) {
    if (ansi === undefined)
        return;
    const state = emptySgrState();
    let index = 0;
    while (index < ansi.length) {
        const sgr = readSgrCode(ansi, index);
        if (!sgr)
            return;
        applySgrValues(state, sgr.values);
        index += sgr.length;
    }
    return state;
}
const BASIC_COLORS = [
    { red: 0, green: 0, blue: 0 },
    { red: 128, green: 0, blue: 0 },
    { red: 0, green: 128, blue: 0 },
    { red: 128, green: 128, blue: 0 },
    { red: 0, green: 0, blue: 128 },
    { red: 128, green: 0, blue: 128 },
    { red: 0, green: 128, blue: 128 },
    { red: 192, green: 192, blue: 192 },
    { red: 128, green: 128, blue: 128 },
    { red: 255, green: 0, blue: 0 },
    { red: 0, green: 255, blue: 0 },
    { red: 255, green: 255, blue: 0 },
    { red: 0, green: 0, blue: 255 },
    { red: 255, green: 0, blue: 255 },
    { red: 0, green: 255, blue: 255 },
    { red: 255, green: 255, blue: 255 },
];
const COLOR_CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
function indexedRgb(index) {
    if (!Number.isInteger(index) || index < 0 || index > 255)
        return;
    if (index < 16)
        return BASIC_COLORS[index];
    if (index >= 232) {
        const gray = 8 + (index - 232) * 10;
        return { red: gray, green: gray, blue: gray };
    }
    const cube = index - 16;
    return {
        red: COLOR_CUBE_LEVELS[Math.floor(cube / 36)] ?? 0,
        green: COLOR_CUBE_LEVELS[Math.floor((cube % 36) / 6)] ?? 0,
        blue: COLOR_CUBE_LEVELS[cube % 6] ?? 0,
    };
}
function sgrRgb(value) {
    if (!value)
        return;
    const parts = value.split(";").map(Number);
    if (parts.length === 5 && parts[1] === 2 && parts.slice(2).every((part) => Number.isInteger(part))) {
        return { red: parts[2], green: parts[3], blue: parts[4] };
    }
    if (parts.length === 3 && parts[1] === 5)
        return indexedRgb(parts[2]);
    const code = parts.length === 1 ? parts[0] : undefined;
    if (code === undefined)
        return;
    if (code >= 30 && code <= 37)
        return BASIC_COLORS[code - 30];
    if (code >= 90 && code <= 97)
        return BASIC_COLORS[code - 90 + 8];
    if (code >= 40 && code <= 47)
        return BASIC_COLORS[code - 40];
    return code >= 100 && code <= 107 ? BASIC_COLORS[code - 100 + 8] : undefined;
}
function mixRgb(base, accent, accentWeight) {
    const mix = (baseValue, accentValue) => Math.round(baseValue * (1 - accentWeight) + accentValue * accentWeight);
    return {
        red: mix(base.red, accent.red),
        green: mix(base.green, accent.green),
        blue: mix(base.blue, accent.blue),
    };
}
function closestIndexedColor(color) {
    let closest = 16;
    let distance = Number.POSITIVE_INFINITY;
    for (let index = 16; index <= 255; index++) {
        const candidate = indexedRgb(index);
        const nextDistance = (candidate.red - color.red) ** 2 + (candidate.green - color.green) ** 2 + (candidate.blue - color.blue) ** 2;
        if (nextDistance < distance) {
            closest = index;
            distance = nextDistance;
        }
    }
    return closest;
}
function isTrueColor(value) {
    return value?.startsWith("38;2;") === true || value?.startsWith("48;2;") === true;
}
export function blendedBackgroundAnsi(baseAnsi, accentAnsi, accentWeight = 0.3) {
    const baseValue = sgrStateFromAnsi(baseAnsi)?.background;
    const accentValue = sgrStateFromAnsi(accentAnsi)?.foreground;
    const base = sgrRgb(baseValue);
    const accent = sgrRgb(accentValue);
    if (!base || !accent)
        return baseAnsi;
    const color = mixRgb(base, accent, Math.max(0, Math.min(1, accentWeight)));
    if (isTrueColor(baseValue) || isTrueColor(accentValue)) {
        return `${ESCAPE}[48;2;${color.red};${color.green};${color.blue}m`;
    }
    return `${ESCAPE}[48;5;${closestIndexedColor(color)}m`;
}
export function parseTrustedSgrText(text) {
    const normalizedTabs = text.replace(/\t/gu, TAB_SPACES);
    const state = emptySgrState();
    const runs = [];
    let plainText = "";
    let index = 0;
    while (index < normalizedTabs.length) {
        if (normalizedTabs[index] === ESCAPE) {
            const sgr = readSgrCode(normalizedTabs, index);
            if (!sgr)
                return;
            applySgrValues(state, sgr.values);
            index += sgr.length;
            continue;
        }
        if (normalizedTabs.charCodeAt(index) === 0x9b)
            return;
        const nextEscape = normalizedTabs.indexOf(ESCAPE, index);
        const end = nextEscape === -1 ? normalizedTabs.length : nextEscape;
        const chunk = normalizedTabs.slice(index, end);
        const start = plainText.length;
        plainText += chunk;
        if (chunk.length > 0)
            runs.push({ start, end: plainText.length, state: cloneState(state) });
        index = end;
    }
    return { plainText, runs };
}
//# sourceMappingURL=ansi-sgr.js.map