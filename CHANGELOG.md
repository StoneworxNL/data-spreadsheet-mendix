# Changelog

## 2.0.0

Requires Mendix 11 (Pluggable Widgets Tools 11, React 19).

### Added

-   Excel styling: fonts, colours, fills, borders, alignment, wrapped text, column widths, row heights, hidden rows and
    columns, frozen panes. Kept on Save and Download.
-   Charts (column, bar, line, area, pie, doughnut, scatter, radar) and pictures drawn over the grid, updated live, and
    kept in saved .xlsx/.xlsm files.
-   Height property; the widget follows its container and applies its class and style.
-   Studio Pro: design-mode preview, checks, help link.

### Changed

-   Save keeps the format of the loaded file; Book Type applies to Download.
-   Loaded formulas show Excel's result; simple formulas recalculate after edits.
-   The widget reloads when the file or Editable changes and cleans up its listeners.
-   `xlsx` 0.20.3 (fixes GHSA-4r6h-8v6p-xvw6 and GHSA-5pgg-2g8v-p4x9).
-   The Type export option is deprecated.

### Security

-   Font names from files are restricted to plain names; fonts are registered with the FontFace API.
-   Only raster pictures (no SVG) are shown; files above 20 MB aren't opened.

## 1.0.3

-   No data loss when saving or downloading; columns beyond Z are shown.
