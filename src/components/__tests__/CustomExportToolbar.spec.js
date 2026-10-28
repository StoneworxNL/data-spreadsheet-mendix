import { fileNameFor } from "../CustomExportToolbar";

describe("fileNameFor", () => {
    it("uses the extension of the chosen book type", () => {
        expect(fileNameFor("Report.xlsx", "csv")).toBe("Report.csv");
        expect(fileNameFor("Report.xlsx", "biff8")).toBe("Report.xls");
        expect(fileNameFor("Q1 v2.final.xlsx", "xlsb")).toBe("Q1 v2.final.xlsb");
        expect(fileNameFor("Contacts", "xlsx")).toBe("Contacts.xlsx");
        expect(fileNameFor("Data.csv", "unknown")).toBe("Data.xlsx");
    });
});
