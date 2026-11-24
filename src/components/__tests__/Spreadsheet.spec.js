import "jest-canvas-mock";
import { createElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { MendixSpreadsheet } from "../Spreadsheet";

// Chart.js needs a real canvas; the charts themselves are tested in charts.spec.js
jest.mock("chart.js", () => {
    class Chart {
        constructor() {
            this.data = {};
        }
        update() {}
        destroy() {}
    }
    Chart.register = () => {};
    return new Proxy({ Chart }, { get: (target, key) => (key in target ? target[key] : class {}) });
});

const fixture = name => readFileSync(join(__dirname, "../../external/__tests__/fixtures", name));
const files = {
    "sales.xlsx": fixture("sales-report.xlsx"),
    "plan.xlsx": fixture("project-plan.xlsx")
};

// fetch() for file documents: /file?guid=1&name=<file>
beforeEach(() => {
    global.fetch = jest.fn(uri => {
        const name = new URL(uri).searchParams.get("name");
        const bytes = files[name];
        if (!bytes) return Promise.resolve({ ok: false, status: 404, headers: new Headers() });
        return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "Content-Length": String(bytes.length) }),
            // An ArrayBuffer from the test environment's realm, as a browser would return
            arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer)
        });
    });
    global.ResizeObserver = class {
        observe() {}
        disconnect() {}
    };
    if (!global.requestAnimationFrame) global.requestAnimationFrame = cb => setTimeout(cb, 0);
    if (!global.cancelAnimationFrame) global.cancelAnimationFrame = id => clearTimeout(id);
});

const fileDocument = (name, version = 1) => ({
    status: "available",
    value: { uri: `http://localhost/file?guid=1&name=${encodeURIComponent(name)}&changedDate=${version}`, name }
});

const props = overrides => ({
    editable: false,
    bookSST: false,
    compression: true,
    bookType: "xlsx",
    type: "array",
    cellStyles: false,
    isShowSave: false,
    isShowDownload: false,
    widthOffset: 0,
    height: 500,
    saveMethod: "direct",
    ...overrides
});

const sheetTabs = container =>
    Array.from(container.querySelectorAll(".x-spreadsheet-bottombar li")).map(li => li.textContent);

describe("MendixSpreadsheet", () => {
    it("loads the file into the grid", async () => {
        const { container } = render(<MendixSpreadsheet {...props({ fileDocument: fileDocument("sales.xlsx") })} />);
        await waitFor(() =>
            expect(sheetTabs(container)).toEqual(expect.arrayContaining(["Summary", "Monthly trend", "Targets"]))
        );
        expect(container.querySelectorAll(".x-spreadsheet")).toHaveLength(1);
    });

    it("loads again when the file changes, with a single grid", async () => {
        const { container, rerender } = render(
            <MendixSpreadsheet {...props({ fileDocument: fileDocument("sales.xlsx") })} />
        );
        await waitFor(() => expect(sheetTabs(container)).toContain("Summary"));
        rerender(<MendixSpreadsheet {...props({ fileDocument: fileDocument("plan.xlsx") })} />);
        await waitFor(() => expect(sheetTabs(container)).toContain("Plan"));
        expect(sheetTabs(container)).not.toContain("Summary");
        expect(container.querySelectorAll(".x-spreadsheet")).toHaveLength(1);
    });

    it("removes x-spreadsheet's window listeners when it closes", async () => {
        const added = jest.spyOn(window, "addEventListener");
        const removed = jest.spyOn(window, "removeEventListener");
        const { container, unmount } = render(
            <MendixSpreadsheet {...props({ fileDocument: fileDocument("sales.xlsx") })} />
        );
        await waitFor(() => expect(sheetTabs(container)).toContain("Summary"));
        const listeners = added.mock.calls.length;
        expect(listeners).toBeGreaterThan(0);
        unmount();
        added.mock.calls.forEach(([type, listener]) =>
            expect(removed.mock.calls.some(([t, l]) => t === type && l === listener)).toBe(true)
        );
        added.mockRestore();
        removed.mockRestore();
    });

    it("shows a message when the file can't be loaded", async () => {
        render(<MendixSpreadsheet {...props({ fileDocument: fileDocument("missing.xlsx") })} />);
        expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    });

    it("removes the grid when the file is cleared", async () => {
        const { container, rerender } = render(
            <MendixSpreadsheet {...props({ fileDocument: fileDocument("sales.xlsx") })} />
        );
        await waitFor(() => expect(sheetTabs(container)).toContain("Summary"));
        rerender(<MendixSpreadsheet {...props({ fileDocument: { status: "unavailable", value: undefined } })} />);
        await waitFor(() => expect(container.querySelectorAll(".x-spreadsheet")).toHaveLength(0));
    });

    it("saves in the loaded file's format, whatever Book Type says", async () => {
        const saveDocument = jest.fn((guid, name, params, blob, ok) => ok());
        global.mx = { data: { saveDocument }, ui: { error: jest.fn() } };
        const { container } = render(
            <MendixSpreadsheet
                {...props({
                    fileDocument: fileDocument("sales.xlsx"),
                    editable: true,
                    isShowSave: true,
                    bookType: "csv",
                    saveCaption: "Opslaan"
                })}
            />
        );
        await waitFor(() => expect(sheetTabs(container)).toContain("Summary"));
        act(() => {
            fireEvent.click(screen.getByText("Opslaan"));
        });
        expect(saveDocument).toHaveBeenCalledTimes(1);
        const [guid, name, , blob] = saveDocument.mock.calls[0];
        expect(guid).toBe("1");
        expect(name).toBe("sales.xlsx");
        expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    });
});
