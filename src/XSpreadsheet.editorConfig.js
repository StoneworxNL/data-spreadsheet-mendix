import { hidePropertiesIn } from "@mendix/pluggable-widgets-tools";

/**
 * Studio Pro configuration: hides settings that don't apply and warns about combinations that don't work.
 *
 * @param {object} values
 * @param {object} defaultProperties
 * @returns {object}
 */
export function getProperties(values, defaultProperties) {
    const hide = keys => hidePropertiesIn(defaultProperties, values, keys);

    // Deprecated: files are always generated as binary data
    hide(["typeEnum"]);

    const saves = values.editable && values.isShowSave;
    if (!saves) hide(["afterSaveAction", "saveCaption", "saveMethod"]);
    if (!values.isShowDownload) hide(["downloadCaption"]);
    if (!saves && !values.isShowDownload) hide(["bookTypeEnum", "compression", "bookSST", "cellStyles"]);
    return defaultProperties;
}

/**
 * @param {object} values
 * @returns {Array<{ property: string, message: string, severity?: string }>}
 */
export function check(values) {
    const problems = [];
    if (values.isShowSave && !values.editable) {
        problems.push({
            property: "isShowSave",
            severity: "warning",
            message: "The Save button only shows when Editable is on."
        });
    }
    if (values.editable && values.isShowSave && values.saveMethod === "property" && !values.afterSaveAction) {
        problems.push({
            property: "afterSaveAction",
            severity: "warning",
            message:
                "With Save method 'Through the file property', commit the object in After Save Action, or the new file isn't stored."
        });
    }
    if (values.height < 0) {
        problems.push({ property: "height", message: "Height can't be negative. Use 0 for the CSS or window height." });
    }
    return problems;
}

/**
 * Design-mode preview: a small grid with the widget's settings.
 *
 * @param {object} values
 * @returns {object}
 */
export function getPreview(values) {
    const cell = (text, bold) => ({
        type: "Container",
        borders: true,
        borderWidth: 1,
        padding: 4,
        children: [{ type: "Text", content: text, fontSize: 8, bold: Boolean(bold) }]
    });
    const row = (cells, bold) => ({ type: "RowLayout", columnSize: "grow", children: cells.map(c => cell(c, bold)) });
    const mode = values.editable ? "Editable" : "View only";
    const buttons = [values.editable && values.isShowSave ? "Save" : null, values.isShowDownload ? "Download" : null]
        .filter(Boolean)
        .join(" · ");
    return {
        type: "Container",
        borders: true,
        padding: 8,
        children: [
            { type: "Text", content: `Data Spreadsheet: ${mode}${buttons ? ` · ${buttons}` : ""}`, bold: true },
            row(["", "A", "B", "C", "D"], true),
            row(["1", "", "", "", ""]),
            row(["2", "", "", "", ""]),
            row(["3", "", "", "", ""])
        ]
    };
}
