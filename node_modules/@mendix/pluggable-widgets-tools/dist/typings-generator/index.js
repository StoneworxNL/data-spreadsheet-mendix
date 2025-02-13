"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformPackage = transformPackage;
const fs_1 = require("fs");
const path_1 = require("path");
const xml2js_1 = require("xml2js");
const generate_1 = require("./generate");
const { mkdir, readFile, stat, writeFile } = fs_1.promises;
function transformPackage(content, basePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const contentXml = (yield (0, xml2js_1.parseStringPromise)(content));
        if (!contentXml) {
            throw new Error("Empty XML, please check your src folder for file package.xml");
        }
        const resultBasePath = (0, path_1.join)(basePath, "../typings/");
        try {
            yield stat(resultBasePath);
        }
        catch (_a) {
            yield mkdir(resultBasePath);
        }
        const widgetFileXmls = contentXml.package.clientModule[0].widgetFiles
            .map(wf => wf.widgetFile)
            .reduce((a, e) => a.concat(e), [])
            .filter(wfXml => wfXml.$.path);
        for (const widgetFileXml of widgetFileXmls) {
            const sourcePath = widgetFileXml.$.path;
            const source = yield readFile((0, path_1.join)(basePath, sourcePath), "utf-8");
            let generatedContent;
            try {
                const sourceXml = (yield (0, xml2js_1.parseStringPromise)(source));
                generatedContent = (0, generate_1.generateForWidget)(sourceXml, toWidgetName(sourcePath));
            }
            catch (err) {
                throw new Error(`Incorrect widget xml file ${sourcePath}, please check Mendix Documentation: ${err.message}`);
            }
            const resultPath = sourcePath.replace(/(\.xml)?$/, "Props.d.ts");
            yield writeFile((0, path_1.join)(resultBasePath, resultPath), generatedContent);
        }
    });
}
function toWidgetName(file) {
    file = file.replace(".xml", "");
    const parts = file.split("/");
    return parts.length > 0 ? parts[parts.length - 1] : "";
}
