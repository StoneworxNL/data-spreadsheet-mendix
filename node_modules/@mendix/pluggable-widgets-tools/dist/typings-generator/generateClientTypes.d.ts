import { Property, ReturnType, SystemProperty } from "./WidgetXml";
export declare function generateClientTypes(widgetName: string, properties: Property[], systemProperties: SystemProperty[], isNative: boolean): string[];
export declare function hasOptionalDataSource(prop: Property, resolveProp: (key: string) => Property | undefined): boolean | "" | undefined;
export declare function toAttributeClientType(xmlType: string): string;
export declare function toExpressionClientType(returnTypeProp: ReturnType, resolveProp: (key: string) => Property | undefined): string;
export declare function toAssociationOutputType(xmlType: string, linkedToDataSource: boolean): "any" | "ListReferenceValue" | "ReferenceValue" | "ListReferenceSetValue" | "ReferenceSetValue";
export declare function toAttributeOutputType(xmlType: string, linkedToDataSource: boolean, unionAttributeType: string): string;
export declare function toUniqueUnionType(types: string[]): string;
