const { join } = require("path");
const base = require("@mendix/pluggable-widgets-tools/test-config/jest.config.js");

const testConfig = join(__dirname, "node_modules/@mendix/pluggable-widgets-tools/test-config");

// The tools' config compiles tests with SWC, whose native binding refuses to load on machines where it can't create
// a cache folder with strict permissions. Babel (the tools' own transform) doesn't have that problem.
module.exports = {
    ...base,
    transform: {
        "^.+\\.(t|j)sx?$": join(testConfig, "transform.js"),
        "^.+\\.svg$": join(testConfig, "jest-svg-transformer")
    }
};
