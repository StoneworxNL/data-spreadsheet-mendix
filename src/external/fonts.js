/*
 * The grid draws on a canvas using each cell's font name. Office fonts (Aptos, Calibri, Cambria, ...) are missing on
 * many machines, and the canvas then falls back to a default font of a different size. Declaring every workbook font
 * as a @font-face made of local fonts keeps its name (as shown in the toolbar and saved to the file) while drawing
 * it with the closest installed font.
 */

const SANS = ["Calibri", "Carlito", "Aptos", "Segoe UI", "Helvetica Neue", "Arial", "Liberation Sans"];
const SERIF = ["Cambria", "Caladea", "Georgia", "Times New Roman", "Liberation Serif"];
const MONO = ["Consolas", "Menlo", "Courier New", "Liberation Mono"];

const registered = new Set();

/**
 * Registers fallbacks for the given font names and waits until they can be drawn.
 *
 * @param {string[]} names
 * @returns {Promise<boolean>} true when new fonts were registered, so the grid should be drawn again
 */
export function registerFontFallbacks(names) {
    if (typeof document === "undefined" || !document.fonts) return Promise.resolve(false);
    const added = names.filter(name => name && !registered.has(name.toLowerCase()));
    if (!added.length) return Promise.resolve(false);

    const rules = added.map(name => {
        registered.add(name.toLowerCase());
        const fallbacks = [name, ...familyOf(name)].filter((v, i, list) => list.indexOf(v) === i);
        const family = name.replace(/"/g, "");
        const src = fallbacks.map(font => `local("${font.replace(/"/g, "")}")`).join(", ");
        return ["normal", "bold"]
            .map(weight =>
                ["normal", "italic"]
                    .map(
                        style =>
                            `@font-face { font-family: "${family}"; font-weight: ${weight}; font-style: ${style}; ` +
                            `src: ${weightedSources(fallbacks, weight, style) || src}; }`
                    )
                    .join("\n")
            )
            .join("\n");
    });

    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-xspreadsheet-fonts", "");
    styleEl.textContent = rules.join("\n");
    document.head.appendChild(styleEl);

    const loads = added.flatMap(name =>
        ["", "bold ", "italic ", "italic bold "].map(variant =>
            document.fonts.load(`${variant}11pt "${name.replace(/"/g, "")}"`).catch(() => null)
        )
    );
    return Promise.all(loads).then(() => true);
}

function familyOf(name) {
    // Condensed faces (Aptos Narrow, Excel's default since 2023) need a condensed fallback, or text overflows its cell
    if (/narrow|condensed/i.test(name)) return ["Arial Narrow", "Liberation Sans Narrow", ...SANS];
    if (/consolas|courier|mono|menlo|code/i.test(name)) return MONO;
    if (/cambria|georgia|times|garamond|serif|book|caladea/i.test(name) && !/sans/i.test(name)) return SERIF;
    return SANS;
}

// local() matches full font face names, so bold/italic faces are looked up as "Calibri Bold", "Arial Italic", ...
function weightedSources(fallbacks, weight, style) {
    const suffix = [weight === "bold" ? "Bold" : "", style === "italic" ? "Italic" : ""].filter(Boolean).join(" ");
    if (!suffix) return null;
    return [...fallbacks.map(font => `local("${font} ${suffix}")`), ...fallbacks.map(font => `local("${font}")`)].join(
        ", "
    );
}
