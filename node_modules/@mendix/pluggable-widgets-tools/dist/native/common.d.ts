import { ImageStyle, TextStyle, ViewStyle } from "react-native";
interface CustomStyle {
    [key: string]: string | number;
}
export interface Style {
    [key: string]: CustomStyle | ViewStyle | TextStyle | ImageStyle | object;
}
export declare function mergeNativeStyles<T extends Style>(defaultStyle: T, overrideStyles: Array<T | undefined>): T;
export declare function extractStyles<TObj extends {}, TKeys extends Array<keyof TObj>>(source: TObj | undefined, extractionKeys: TKeys): [Pick<TObj, typeof extractionKeys[number]>, Omit<TObj, typeof extractionKeys[number]>];
export {};
