## Data Spreadsheet Mendix Pluggable Widget
A Mendix widget to view and edit excel files / spreadsheets based on https://github.com/myliang/x-spreadsheet.

<img alt="Mendix Pluggable Widget Data Spreadsheet Logo" src="https://github.com/joaodelopes/data-spreadsheet-mendix/blob/main/images/logo.jpeg" width="65px"/>

## Features
View and edit your excel files. Pluggable widget based on the [x-data-spreadsheet](https://github.com/myliang/x-spreadsheet) library that allows you to visualize and edit your excel data directly from your Mendix web app. Current features include:

*   View / Edit mode;

*   Multiple sheets;

*   Cell formulas available;

*   Custom toolbar;

*   Possibility to show download and/or save button(s);

*   Possibility to add an After Save activity, such as a nanoflow to show a success message;

*   Export settings fully customizable;

*   Customize css. The spreadsheet is wrapped by the id below:

    *   #gridctr


<!-- ### Light
![Light Mode](https://github.com/joaodelopes/block-note-mendix/blob/main/images/lightmodedemo.png)
![Light Mode (full-page)](https://github.com/joaodelopes/block-note-mendix/blob/main/images/fullscreendemo.png)

### Dark
![Dark Mode](https://github.com/joaodelopes/block-note-mendix/blob/main/images/darkmodedemo.png)

### View-only
![View-only Mode](https://github.com/joaodelopes/block-note-mendix/blob/main/images/viewmodedemo.png) -->

## Usage
1. Add a dataview that fetches the .xlsx file you wish to display/edit.
2. Inside the dataview, add the x-spreadsheet widget.
3. Custumize it. Make it editable/view-only; Decide if you want to show the Save/Download button. Define a width margin if needed.
4. In case you want to export (save/download), define the export options.

### General Settings
![Usage in Mendix Studio Pro (General)](https://github.com/joaodelopes/data-spreadsheet-mendix/blob/main/images/studiopro0.png)

### Export Settings
![Usage in Mendix Studio Pro (Export Settings)](https://github.com/joaodelopes/data-spreadsheet-mendix/blob/main/images/studiopro1.png)


## Demo project
- [Mendix app running on the cloud](https://x-spreadsheet-demo-sandbox.mxapps.io/index.html)
- [Mendix demo module (.mpk)](https://github.com/joaodelopes/xspreadsheet/tree/main/demo)
- [Marketplace widget](https://marketplace.mendix.com/link/component/237438)
<!-- - [Mendix demo scss (.scss)](https://github.com/joaodelopes/block-note-mendix/blob/main/demo/demo.scss) -->

## Issues, suggestions and feature requests

*   Performance is a problem when handling large files. In part, this is a limitation of the SheetJs free version. The Pro version might be a solution.

*   Strange behaviour with the spreadsheet's horizontal scrollbar when using Mozilla Firefox. This seems unrelated to this widget's logic as per this [Stack Overflow post](https://superuser.com/questions/1720362/firefox-scroll-bar-disappearing).

*   There's also a library limitation with importing spreadsheets' styles. Currently it allows to export spreadsheets and its styles, but not import the styles. So, your file will always show unstyled. Since this depends on the library this widget uses, solving it might not be easy / coming soon.

*   We are working in improving performance and adding features to make this widget more flexible for different purposes. Feel free to suggest us new features.


## About Stoneworx

<img alt="From https://www.stoneworx.nl/o" src="https://cdn.prod.website-files.com/66991b9fc069c88aec093fd1/66b242753e65840128c97ab9_imagehero-p-800.png" width="50px"/>

We started our company as friends and will always remain a club of people that likes doing business in a friendly matter. A group of entrepreneurial, smart and highly experienced Mendix professionals.  

On a daily basis, we create software applications that simplify our clients’ business processes by using the Mendix low code platform. It is our mission is to turn complex ideas into simple solutions for medium to corporate-sized businesses, in any industry.