/*
 * The grid draws on a canvas using each cell's font name. Office fonts (Aptos, Calibri, Cambria, ...) are missing on
 * many machines, and the canvas then falls back to a default font of a different size. Registering every workbook font
 * as a FontFace made of local fonts keeps its name (as shown in the toolbar and saved to the file) while drawing it
 * with the closest installed font. The FontFace API is used instead of a stylesheet, so no CSS is parsed, and only
 * plain font names (see safeFontName) are registered.
 */
import { safeFontName } from "./ooxml.js";

const SANS = ["Calibri", "Carlito", "Aptos", "Segoe UI", "Helvetica Neue", "Arial", "Liberation Sans"];
const SERIF = ["Cambria", "Caladea", "Georgia", "Times New Roman", "Liberation Serif"];
const MONO = ["Consolas", "Menlo", "Courier New", "Liberation Mono"];

const VARIANTS = [
    { weight: "normal", style: "normal", suffix: "" },
    { weight: "bold", style: "normal", suffix: "Bold" },
    { weight: "normal", style: "italic", suffix: "Italic" },
    { weight: "bold", style: "italic", suffix: "Bold Italic" }
];

const registered = new Set();

/**
 * Registers fallbacks for the given font names and waits until they can be drawn.
 *
 * @param {string[]} names
 * @returns {Promise<boolean>} true when new fonts were registered, so the grid should be drawn again
 */
export function registerFontFallbacks(names) {
    if (typeof document === "undefined" || !document.fonts || typeof FontFace === "undefined") {
        return Promise.resolve(false);
    }
    const added = names
        .filter(name => name && safeFontName(name) === name)
        .filter(name => !registered.has(name.toLowerCase()));
    if (!added.length) return Promise.resolve(false);

    const loads = [];
    added.forEach(name => {
        registered.add(name.toLowerCase());
        const fallbacks = [name, ...familyOf(name)].filter((v, i, list) => list.indexOf(v) === i);
        VARIANTS.forEach(({ weight, style, suffix }) => {
            const face = new FontFace(name, sources(fallbacks, suffix), { weight, style });
            document.fonts.add(face);
            loads.push(face.load().catch(() => null));
        });
    });
    return Promise.all(loads).then(() => true);
}

export function familyOf(name) {
    // Condensed faces (Aptos Narrow, Excel's default since 2023) need a condensed fallback, or text overflows its cell
    if (/narrow|condensed/i.test(name)) return ["Arial Narrow", "Liberation Sans Narrow", ...SANS];
    if (/consolas|courier|mono|menlo|code/i.test(name)) return MONO;
    if (/cambria|georgia|times|garamond|serif|book|caladea/i.test(name) && !/sans/i.test(name)) return SERIF;
    return SANS;
}

// local() matches full font face names, so bold/italic faces are looked up as "Calibri Bold", "Arial Italic", ...
export function sources(fallbacks, suffix) {
    const names = suffix ? [...fallbacks.map(font => `${font} ${suffix}`), ...fallbacks] : fallbacks;
    return names.map(font => `local("${font}")`).join(", ");
}
