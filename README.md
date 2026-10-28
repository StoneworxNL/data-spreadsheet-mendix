## Data Spreadsheet Mendix Pluggable Widget

A Mendix widget to view and edit excel files / spreadsheets based on https://github.com/myliang/x-spreadsheet.

<img alt="Mendix Pluggable Widget Data Spreadsheet Logo" src="https://github.com/StoneworxNL/data-spreadsheet-mendix/blob/main/images/logo.jpeg" width="65px"/>

## Features

View and edit your excel files. Pluggable widget based on the
[x-data-spreadsheet](https://github.com/myliang/x-spreadsheet) library that allows you to visualize and edit your excel
data directly from your Mendix web app. Current features include:

-   View / Edit mode;

-   Multiple sheets;

-   Cell formulas available. Loaded formulas show the result Excel saved; simple ones (SUM, AVERAGE, MIN, MAX, IF,
    arithmetic) recalculate when you edit the cells they use;

-   Excel styling: fonts, font colours, fills, borders, alignment, wrapped text, column widths, row heights, hidden
    rows/columns and frozen panes. Styles are kept when you save or download;

-   Charts and pictures: column, bar, line, area, pie, doughnut, scatter and radar charts are drawn over the grid where
    Excel placed them, follow scrolling, and update when you edit their data. They are kept when you save or download as
    .xlsx/.xlsm;

-   Custom toolbar;

-   Possibility to show download and/or save button(s);

-   Possibility to add an After Save activity, such as a nanoflow to show a success message;

-   Export settings fully customizable;

-   Customize css. The spreadsheet is wrapped by the id below:

    -   #gridctr

## Usage

1. Add a dataview that fetches the .xlsx file you wish to display/edit.
2. Inside the dataview, add the x-spreadsheet widget.
3. Custumize it. Make it editable/view-only; Decide if you want to show the Save/Download button. Define a width margin
   if needed.
4. In case you want to export (save/download), define the export options.

### General Settings

![Usage in Mendix Studio Pro (General)](https://github.com/StoneworxNL/data-spreadsheet-mendix/blob/main/images/studiopro0.png)

### Export Settings

![Usage in Mendix Studio Pro (Export Settings)](https://github.com/StoneworxNL/data-spreadsheet-mendix/blob/main/images/studiopro1.png)

## Demo project

-   [Mendix app running on the cloud](https://x-spreadsheet-demo-sandbox.mxapps.io/index.html)
-   [Mendix demo module (.mpk)](https://github.com/StoneworxNL/xspreadsheet/tree/main/demo)
-   [Marketplace widget](https://marketplace.mendix.com/link/component/237438)
<!-- - [Mendix demo scss (.scss)](https://github.com/joaodelopes/block-note-mendix/blob/main/demo/demo.scss) -->

## Issues, suggestions and feature requests

-   ⚠️ Performance is a problem when handling large files. In part, this is a limitation of the SheetJs free version.
    The Pro version might be a solution.

-   ⚠️ Strange behaviour with the spreadsheet's horizontal scrollbar when using Mozilla Firefox. This seems unrelated to
    this widget's logic as per this
    [Stack Overflow post](https://superuser.com/questions/1720362/firefox-scroll-bar-disappearing).

-   ⚠️ Styling limitations: conditional formatting, rich text inside a cell, pattern and gradient fills (shown as a
    solid colour), diagonal borders and theme colours (saved as RGB) aren't supported.

-   ⚠️ Chart limitations: charts are view-only (drag, resize and chart editing aren't available), data labels,
    trendlines and secondary axes aren't drawn, and 3D charts are drawn flat. Charts stay where they were anchored when
    rows or columns are inserted above them. Saving to formats other than .xlsx/.xlsm drops charts.

-   ⚠️ Formulas that x-spreadsheet can't calculate the way Excel does (e.g. VLOOKUP, ROUND, or a division whose result
    differs from Excel's) keep showing the value Excel saved until the file is opened in Excel again.

-   🙌 Feel free to suggest us new features or report bugs.
