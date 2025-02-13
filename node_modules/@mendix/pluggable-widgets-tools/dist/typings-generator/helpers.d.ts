import { Properties, Property, SystemProperty } from "./WidgetXml";
export declare function extractProperties(props: Properties): Property[];
export declare function extractSystemProperties(props: Properties): SystemProperty[];
export declare function capitalizeFirstLetter(text: string): string;
export declare function commasAnd(arr: string[]): string;
