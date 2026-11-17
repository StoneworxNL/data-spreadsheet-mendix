import "jest-canvas-mock";
import Spreadsheet from "x-data-spreadsheet";
import { installRenderPatches } from "../renderPatches";

function makeGrid(rows) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const s = new Spreadsheet(el, { view: { height: () => 400, width: () => 600 } });
    const patches = installRenderPatches(s);
    s.loadData([{ name: "S", rows }]);
    return { s, ...patches };
}

describe("cell editor", () => {
    it("never parses a cell's text as HTML", () => {
        const payload = '<img src="x" onerror="window.__xss = true">';
        const { s } = makeGrid({ 0: { cells: { 0: { text: payload } } } });
        const { editor } = s.sheet;

        // What double-clicking the cell does
        editor.setOffset(s.sheet.data.getSelectedRect());
        editor.setCell(s.sheet.data.getSelectedCell(), s.sheet.data.getSelectedValidator());
        expect(editor.textlineEl.el.querySelector("img")).toBeNull();
        expect(editor.textlineEl.el.textContent).toBe(payload);

        // Typing goes through the same div
        editor.textEl.el.value = `${payload}!`;
        editor.textEl.el.dispatchEvent(new Event("input"));
        expect(editor.textlineEl.el.querySelector("img")).toBeNull();
        expect(editor.textlineEl.el.textContent).toBe(`${payload}!`);
        expect(window.__xss).toBeUndefined();
    });
});

describe("formula cache", () => {
    it("is kept between draws and cleared when a cell changes", () => {
        const { s, engine } = makeGrid({
            0: { cells: { 0: { text: "2" }, 1: { text: "=A1*10" } } }
        });
        const { data, table } = s.sheet;
        table.render();
        expect(engine.cache.size).toBeGreaterThan(0);

        expect(engine.cache.get("S!0:1").value).toBe(20);

        // Drawing again (e.g. scrolling) parses nothing
        const parse = jest.spyOn(engine, "parserAt");
        table.render();
        expect(parse).not.toHaveBeenCalled();

        data.setCellText(0, 0, "3", "finished");
        expect(engine.cache.size).toBe(0);
        table.render();
        expect(engine.cache.get("S!0:1").value).toBe(30);

        data.undo();
        expect(engine.cache.size).toBe(0);
    });
});
