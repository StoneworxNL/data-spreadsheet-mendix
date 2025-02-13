"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensure = ensure;
function ensure(arg) {
    if (arg == null) {
        throw new Error("Did not expect an argument to be undefined");
    }
    return arg;
}
