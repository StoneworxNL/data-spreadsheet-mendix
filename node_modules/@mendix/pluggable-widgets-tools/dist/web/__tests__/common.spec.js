"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("../common");
describe("parseInlineStyle", () => {
    it("parses without an inline style", () => {
        expect(Object.keys((0, common_1.parseInlineStyle)())).toHaveLength(0);
    });
    it("parses an inline style", () => {
        const input = "color:blue;text-align:center;";
        const expectedResult = {
            color: "blue",
            textAlign: "center"
        };
        const result = (0, common_1.parseInlineStyle)(input);
        expect(result).toMatchObject(expectedResult);
        expect(Object.keys(result)).toHaveLength(Object.keys(expectedResult).length);
    });
    it("parses an inline style without a semicolon", () => {
        const input = "text-align:center";
        const expectedResult = {
            textAlign: "center"
        };
        const result = (0, common_1.parseInlineStyle)(input);
        expect(result).toMatchObject(expectedResult);
        expect(Object.keys(result)).toHaveLength(Object.keys(expectedResult).length);
    });
});
