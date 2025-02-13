"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listFileNativeOutput = exports.listFileWebOutput = void 0;
exports.listFileWebOutput = `/**
 * This file was generated from MyWidget.xml
 * WARNING: All changes made to this file will be overwritten
 * @author Mendix Widgets Framework Team
 */
import { DynamicValue, FileValue } from "mendix";

export interface ActionsType {
    file: DynamicValue<FileValue>;
}

export interface ActionsPreviewType {
    file: string;
}

export interface MyWidgetContainerProps {
    name: string;
    tabIndex?: number;
    id: string;
    actions: ActionsType[];
}

export interface MyWidgetPreviewProps {
    readOnly: boolean;
    renderMode: "design" | "xray" | "structure";
    translate: (text: string) => string;
    actions: ActionsPreviewType[];
}
`;
exports.listFileNativeOutput = `export interface ActionsType {
    file: DynamicValue<FileValue>;
}

export interface MyWidgetProps<Style> {
    name: string;
    style: Style[];
    actions: ActionsType[];
}`;
