"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractProperties = extractProperties;
exports.extractSystemProperties = extractSystemProperties;
exports.capitalizeFirstLetter = capitalizeFirstLetter;
exports.commasAnd = commasAnd;
function extractProperties(props) {
    return extractProps(props, p => { var _a; return (_a = p.property) !== null && _a !== void 0 ? _a : []; });
}
function extractSystemProperties(props) {
    return extractProps(props, p => { var _a; return (_a = p.systemProperty) !== null && _a !== void 0 ? _a : []; });
}
function extractProps(props, extractor) {
    return props.propertyGroup
        ? props.propertyGroup.map(pg => extractProps(pg, extractor)).reduce((a, e) => a.concat(e), [])
        : extractor(props);
}
function capitalizeFirstLetter(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
function commasAnd(arr) {
    return arr.slice(0, -1).join(", ") + (arr.length > 1 ? " and " : "") + arr[arr.length - 1];
}
