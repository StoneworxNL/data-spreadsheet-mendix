import { createRequire } from "node:module";

// Extends the build from @mendix/pluggable-widgets-tools, which passes its configs in as `configDefaultConfig`.
//
// x-data-spreadsheet imports its styles as Less source (src/index.less), but the Mendix build only compiles
// CSS/Sass. Use the library's prebuilt CSS for the same version instead.
const prebuiltStyles = createRequire(import.meta.url).resolve("x-data-spreadsheet/dist/xspreadsheet.css");
const lessStylesImporter = /x-data-spreadsheet[\\/]src[\\/]index\.js$/;

const useXSpreadsheetPrebuiltCss = {
    name: "x-spreadsheet-prebuilt-css",
    resolveId(source, importer) {
        if (source === "./index.less" && importer && lessStylesImporter.test(importer)) {
            return prebuiltStyles;
        }
        return null;
    }
};

export default args =>
    args.configDefaultConfig.map(config => ({
        ...config,
        plugins: [useXSpreadsheetPrebuiltCss, ...config.plugins]
    }));
