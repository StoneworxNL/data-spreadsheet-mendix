"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeNativeStyles = mergeNativeStyles;
exports.extractStyles = extractStyles;
function mergeNativeStyles(defaultStyle, overrideStyles) {
    const styles = [defaultStyle, ...overrideStyles.filter((object) => object !== undefined)];
    return Object.keys(defaultStyle).reduce((flattened, currentKey) => {
        const styleItems = styles.map(object => object[currentKey]);
        return Object.assign(Object.assign({}, flattened), { [currentKey]: flattenObjects(styleItems) });
    }, {});
}
function flattenObjects(objects) {
    return objects.reduce((merged, object) => (Object.assign(Object.assign({}, merged), object)), {});
}
function extractStyles(source, extractionKeys) {
    if (!source) {
        return [{}, {}];
    }
    return Object.entries(source).reduce(([extracted, rest], [key, value]) => {
        if (extractionKeys.includes(key)) {
            extracted[key] = value;
        }
        else {
            rest[key] = value;
        }
        return [extracted, rest];
    }, [{}, {}]);
}
