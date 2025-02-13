"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePreviewTypes = generatePreviewTypes;
const helpers_1 = require("./helpers");
const generateClientTypes_1 = require("./generateClientTypes");
function generatePreviewTypes(widgetName, properties, systemProperties) {
    const results = Array.of();
    const isLabeled = systemProperties.some(p => p.$.key === "Label");
    function resolveProp(key) {
        return properties.find(p => p.$.key === key);
    }
    results.push(`export interface ${widgetName}PreviewProps {${!isLabeled
        ? `
    /**
     * @deprecated Deprecated since version 9.18.0. Please use class property instead.
     */
    className: string;
    class: string;
    style: string;
    styleObject?: CSSProperties;`
        : ""}
    readOnly: boolean;
    renderMode: "design" | "xray" | "structure";
    translate: (text: string) => string;
${generatePreviewTypeBody(properties, results, resolveProp)}
}`);
    return results;
}
function generatePreviewTypeBody(properties, generatedTypes, resolveProp) {
    return properties
        .filter(prop => {
        if (prop.$.type === "datasource" && prop.$.isLinked)
            return false;
        return true;
    })
        .map(prop => `    ${prop.$.key}: ${toPreviewPropType(prop, generatedTypes, resolveProp)};`)
        .join("\n");
}
function toPreviewPropType(prop, generatedTypes, resolveProp) {
    var _a, _b;
    switch (prop.$.type) {
        case "boolean":
            return "boolean";
        case "string":
            return "string";
        case "action":
            return "{} | null";
        case "textTemplate":
            return "string";
        case "integer":
        case "decimal":
            return "number | null";
        case "icon":
            return '{ type: "glyph"; iconClass: string; } | { type: "image"; imageUrl: string; iconUrl: string; } | { type: "icon"; iconClass: string; } | undefined';
        case "image":
            return '{ type: "static"; imageUrl: string; } | { type: "dynamic"; entity: string; } | null';
        case "file":
            return "string";
        case "datasource":
            // { type: string } is included here due to an incorrect API output before 9.2 (PAG-1400)
            return "{} | { caption: string } | { type: string } | null";
        case "attribute":
        case "association":
        case "expression":
            return "string";
        case "enumeration":
            return (0, helpers_1.capitalizeFirstLetter)(prop.$.key) + "Enum";
        case "object":
            if (!((_a = prop.properties) === null || _a === void 0 ? void 0 : _a.length)) {
                throw new Error("[XML] Object property requires properties element");
            }
            const childType = (0, helpers_1.capitalizeFirstLetter)(prop.$.key) + "PreviewType";
            const childProperties = (0, helpers_1.extractProperties)(prop.properties[0]);
            const resolveChildProp = (key) => key.startsWith("../") ? resolveProp(key.substring(3)) : childProperties.find(p => p.$.key === key);
            generatedTypes.push(`export interface ${childType} {
${generatePreviewTypeBody(childProperties, generatedTypes, resolveChildProp)}
}`);
            return prop.$.isList === "true" ? `${childType}[]` : childType;
        case "widgets":
            return "{ widgetCount: number; renderer: ComponentType<{ children: ReactNode; caption?: string }> }";
        case "selection":
            if (!((_b = prop.selectionTypes) === null || _b === void 0 ? void 0 : _b.length)) {
                throw new Error("[XML] Selection property requires selectionTypes element");
            }
            const selectionTypes = prop.selectionTypes.flatMap(s => s.selectionType).map(s => s.$.name);
            if ((0, generateClientTypes_1.hasOptionalDataSource)(prop, resolveProp)) {
                selectionTypes.push("None");
            }
            return (0, generateClientTypes_1.toUniqueUnionType)(selectionTypes.map(s => `"${s}"`));
        default:
            return "any";
    }
}
