```
// 1. Creates the Custom Menu

function onOpen() {

  var ui = SpreadsheetApp.getUi();

  ui.createMenu('Dikidi Manager')

      .addItem('Get Unique Lists', 'generateUniqueLists')

      .addSeparator()

      .addItem('Fix ##, Add IDs', 'fixAndGenerateExtendedReport')

      .addSeparator()

      .addItem('Sync Employees to Altegio', 'addEmployeesToAltegio')

      .addToUi();

}

  

// =========================================

// FUNCTION 1: GENERATE LISTS (Unchanged)

// =========================================

function generateUniqueLists() {

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sourceSheetName = "dikidi_visits";

  var sheetEmployees = "EmployeeNameLists";

  var sheetServices = "ServiceList";

  var sheetEmpServices = "Employee-ListProvide-Service";

  var sheetServiceWithEmps = "ListServicesWithEmployees";

  var sheetClients = "ClientList";

  var COL_EMPLOYEE = 0;

  var COL_CLIENT_NAME = 1;

  var COL_CLIENT_PHONE = 2;

  var COL_SERVICE_NAME = 4;

  var COL_SERVICE_PRICE = 5;

  

  var sourceSheet = ss.getSheetByName(sourceSheetName);

  if (!sourceSheet) { SpreadsheetApp.getUi().alert("Sheet '" + sourceSheetName + "' not found."); return; }

  

  var range = sourceSheet.getDataRange();

  var values = range.getValues();

  values.shift(); // Skip headers

  

  var employeesSet = new Set();

  var servicesSet = new Set();

  var empServicesSet = new Set();

  var clientsSet = new Set();

  var serviceToEmployeesMap = {};

  var servicePricesMap = {};

  var employeesData = [];

  var servicesData = [];

  var empServicesData = [];

  var clientsData = [];

  

  values.forEach(function(row) {

    var employee = row[COL_EMPLOYEE] ? row[COL_EMPLOYEE].toString().trim() : "";

    var rawServiceString = row[COL_SERVICE_NAME] ? row[COL_SERVICE_NAME].toString() : "";

    var clientName = row[COL_CLIENT_NAME] ? row[COL_CLIENT_NAME].toString().trim() : "";

    var clientPhone = row[COL_CLIENT_PHONE] ? row[COL_CLIENT_PHONE].toString().trim() : "";

    var priceVal = row[COL_SERVICE_PRICE];

  

    if (employee !== "" && !employeesSet.has(employee)) {

      employeesSet.add(employee);

      employeesData.push([employee]);

    }

  

    if (clientName !== "") {

      var clientKey = clientName + "###" + clientPhone;

      if (!clientsSet.has(clientKey)) {

        clientsSet.add(clientKey);

        clientsData.push([clientName, clientPhone]);

      }

    }

  

    if (rawServiceString !== "") {

      var normalizedString = rawServiceString.replace(/,\s+(?=[A-ZА-Я])/g, '##');

  

      if (!normalizedString.includes("##")) {

        var cleanSingleService = normalizedString.trim();

        if (cleanSingleService !== "") {

          if (!servicePricesMap[cleanSingleService]) servicePricesMap[cleanSingleService] = [];

          var parsedPrice = parseFloat(priceVal);

          if (!isNaN(parsedPrice)) servicePricesMap[cleanSingleService].push(parsedPrice);

        }

      }

  

      var splitServices = normalizedString.split("##");

      splitServices.forEach(function(s) {

        var cleanService = s.trim();

        if (cleanService !== "") {

          if (!servicesSet.has(cleanService)) {

            servicesSet.add(cleanService);

            servicesData.push(["Archive", cleanService]);

          }

          if (employee !== "") {

            var key = employee + "###" + cleanService;

            if (!empServicesSet.has(key)) {

              empServicesSet.add(key);

              empServicesData.push([employee, cleanService]);

            }

            if (!serviceToEmployeesMap[cleanService]) serviceToEmployeesMap[cleanService] = new Set();

            serviceToEmployeesMap[cleanService].add(employee);

          }

        }

      });

    }

  });

  

  var serviceWithEmpsData = [];

  for (var serviceName in serviceToEmployeesMap) {

    var employeesList = Array.from(serviceToEmployeesMap[serviceName]).sort().join(", ");

    var minPrice = "", maxPrice = "";

    var pricesArray = servicePricesMap[serviceName];

    if (pricesArray && pricesArray.length > 0) {

      minPrice = Math.min.apply(null, pricesArray);

      maxPrice = Math.max.apply(null, pricesArray);

    } else {

      minPrice = "N/A"; maxPrice = "N/A";

    }

    serviceWithEmpsData.push(["Archive", serviceName, employeesList, minPrice, maxPrice]);

  }

  

  employeesData.sort();

  servicesData.sort(function(a, b) { return a[1].localeCompare(b[1]); });

  clientsData.sort(function(a, b) { return a[0].localeCompare(b[0]); });

  empServicesData.sort(function(a, b) { return a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]); });

  serviceWithEmpsData.sort(function(a, b) { return a[1].localeCompare(b[1]); });

  

  createOrOverwriteSheet(ss, sheetEmployees, ["Employee Name"], employeesData);

  createOrOverwriteSheet(ss, sheetServices, ["Category ID", "Service Name"], servicesData);

  createOrOverwriteSheet(ss, sheetEmpServices, ["Employee Name", "Service Name"], empServicesData);

  createOrOverwriteSheet(ss, sheetServiceWithEmps, ["Category ID", "Service Name", "Employees List", "From Price", "To Price"], serviceWithEmpsData);

  createOrOverwriteSheet(ss, sheetClients, ["Client Name", "Phone Number"], clientsData);

  SpreadsheetApp.getActiveSpreadsheet().toast("Updated! 'Archive' added automatically.", "Success");

}

  

// =========================================

// FUNCTION 2: FIX SEPARATORS, UPDATE PRICE, ADD IDs (FIXED ARRAY WIDTH)

// =========================================

function fixAndGenerateExtendedReport() {

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var ui = SpreadsheetApp.getUi();

  // --- CONFIGURATION ---

  var sourceSheetName = "dikidi_visits";

  var worksheetName = "Worksheet";

  var targetReportName = "ListServicesWithEmployees";

  var COL_SERVICE_NAME = 4;  // Col E

  var COL_SERVICE_PRICE = 5; // Col F

  var COL_SERVICE_IDS_OUTPUT = 7; // Col H

  

  var WS_COL_ID = 1;      // Col B in Worksheet

  var WS_COL_NAME = 2;    // Col C in Worksheet

  var WS_COL_LENGTH = 10; // Col K in Worksheet

  

  // --- STEP 1: STRICT CHECK FOR WORKSHEET ---

  var worksheet = ss.getSheetByName(worksheetName);

  if (!worksheet) {

    ui.alert("ERROR: Missing 'Worksheet'\n\nThe sheet named '" + worksheetName + "' was not found.\nThis operation cannot be performed without it.");

    return;

  }

  

  // --- STEP 2: LOAD WORKSHEET DATA ---

  var lookupMap = {};

  var wsData = worksheet.getDataRange().getValues();

  for (var w = 1; w < wsData.length; w++) {

    var sName = wsData[w][WS_COL_NAME];

    var sID = wsData[w][WS_COL_ID];

    var sLen = wsData[w][WS_COL_LENGTH];

    if (sName) {

      lookupMap[sName.toString().trim()] = { id: sID, length: sLen };

    }

  }

  

  // --- STEP 3: CLEAN DIKIDI VISITS ---

  var sourceSheet = ss.getSheetByName(sourceSheetName);

  if (sourceSheet) {

    var fullValues = sourceSheet.getDataRange().getValues();

    var dataChanged = false;

  

    for (var i = 1; i < fullValues.length; i++) {

      var rawName = fullValues[i][COL_SERVICE_NAME] ? fullValues[i][COL_SERVICE_NAME].toString() : "";

      var fixedName = rawName;

      // 3.1 Fix Names (Strict Logic)

      if (fixedName.includes(',')) {

        fixedName = fixedName.replace(/,\s+(?=[A-ZА-Я])/g, '##');

        if (fixedName !== rawName) {

          fullValues[i][COL_SERVICE_NAME] = fixedName;

          dataChanged = true;

        }

      }

  

      // 3.2 Update Price (Add ##0 without spaces)

      if (fixedName.includes("##")) {

        var numberOfServices = fixedName.split("##").length;

        var currentPrice = fullValues[i][COL_SERVICE_PRICE] ? fullValues[i][COL_SERVICE_PRICE].toString() : "0";

  

        if (!currentPrice.includes("##")) {

          var zerosToAdd = numberOfServices - 1;

          var newPriceSuffix = "";

          for (var z = 0; z < zerosToAdd; z++) {

             newPriceSuffix += "##0";

          }

          fullValues[i][COL_SERVICE_PRICE] = currentPrice + newPriceSuffix;

          dataChanged = true;

        }

      }

  

      // 3.3 Update IDs

      if (fixedName !== "") {

        var serviceParts = fixedName.split("##");

        var idParts = [];

        serviceParts.forEach(function(part) {

          var cleanPart = part.trim();

          if (lookupMap[cleanPart]) {

            idParts.push(lookupMap[cleanPart].id);

          } else {

            idParts.push("?");

          }

        });

  

        var idString = idParts.join("##");

        // Ensure index 7 exists

        if (!fullValues[i][COL_SERVICE_IDS_OUTPUT] || fullValues[i][COL_SERVICE_IDS_OUTPUT] !== idString) {

           fullValues[i][COL_SERVICE_IDS_OUTPUT] = idString;

           dataChanged = true;

        }

      }

    }

  

    // --- FIX: NORMALIZE ARRAY WIDTH ---

    // The previous error was because some rows (like header) were 7 columns,

    // but we added data to column 8 (Index 7).

    if (dataChanged) {

      // 1. Find the maximum width

      var maxCols = 0;

      for (var r = 0; r < fullValues.length; r++) {

        if (fullValues[r].length > maxCols) maxCols = fullValues[r].length;

      }

      // Ensure we accommodate at least up to Col H (8 columns)

      if (maxCols < 8) maxCols = 8;

  

      // 2. Pad all rows to match maxCols

      for (var r = 0; r < fullValues.length; r++) {

        while (fullValues[r].length < maxCols) {

          fullValues[r].push(""); // Add empty cells

        }

      }

  

      // 3. Write back with consistent dimensions

      sourceSheet.getRange(1, 1, fullValues.length, maxCols).setValues(fullValues);

      SpreadsheetApp.flush();

    }

  }

  

  // --- STEP 4: UPDATE EXISTING REPORT ---

  var targetSheet = ss.getSheetByName(targetReportName);

  if (!targetSheet) {

    ui.alert("Sheet '" + targetReportName + "' not found. Please run 'Get Unique Lists' first.");

    return;

  }

  

  var targetLastRow = targetSheet.getLastRow();

  if (targetLastRow < 2) return;

  

  // Col F (6) and G (7)

  targetSheet.getRange("F1").setValue("Service ID").setFontWeight("bold");

  targetSheet.getRange("G1").setValue("Length").setFontWeight("bold");

  

  var serviceNames = targetSheet.getRange(2, 2, targetLastRow - 1, 1).getValues();

  var newColumnsData = [];

  

  for (var i = 0; i < serviceNames.length; i++) {

    var svcName = serviceNames[i][0].toString().trim();

    var id = "";

    var len = "";

  

    if (lookupMap[svcName]) {

      id = lookupMap[svcName].id;

      len = lookupMap[svcName].length;

    }

    newColumnsData.push([id, len]);

  }

  

  if (newColumnsData.length > 0) {

    targetSheet.getRange(2, 6, newColumnsData.length, 2).setValues(newColumnsData);

  }

  

  targetSheet.autoResizeColumns(1, 7);

  ss.toast("Source fixed (Prices updated with ##0), IDs populated!", "Finished");

}

  

// =========================================

// FUNCTION 3: SYNC TO ALTEGIO (V2 Header)

// =========================================

function addEmployeesToAltegio() {

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var ui = SpreadsheetApp.getUi();

  

  var sheet = ss.getSheetByName("EmployeeNameLists");

  if (!sheet) {

    ui.alert("Error: Sheet 'EmployeeNameLists' not found. Please run 'Get Unique Lists' first.");

    return;

  }

  

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {

    ui.alert("No employees found in the 'EmployeeNameLists' sheet.");

    return;

  }

  var employees = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();

  employees = employees.filter(function(e) { return e && e.toString().trim() !== ""; });

  if (employees.length === 0) {

    ui.alert("Employee list is empty.");

    return;

  }

  

  var idResponse = ui.prompt('Altegio Sync (Step 1/2)', 'Please enter your Altegio Company ID (e.g. 12345):', ui.ButtonSet.OK_CANCEL);

  if (idResponse.getSelectedButton() !== ui.Button.OK) return;

  var companyId = idResponse.getResponseText().trim();

  

  var tokenResponse = ui.prompt('Altegio Sync (Step 2/2)', 'Please enter your Authorization Token (Bearer):', ui.ButtonSet.OK_CANCEL);

  if (tokenResponse.getSelectedButton() !== ui.Button.OK) return;

  var token = tokenResponse.getResponseText().trim();

  

  if (companyId === "" || token === "") {

    ui.alert("Sync Cancelled. Company ID and Token are required.");

    return;

  }

  

  var baseUrl = "https://api.alteg.io/api/v1/company/" + companyId + "/staff";

  var headers = {

    "Authorization": "Bearer " + token,

    "Content-Type": "application/json",

    "Accept": "application/vnd.api.v2+json"

  };

  

  ss.toast("Checking existing employees...", "Altegio Sync");

  

  var existingNames = new Set();

  try {

    var getOptions = {

      "method": "get",

      "headers": headers,

      "muteHttpExceptions": true

    };

    var getResponse = UrlFetchApp.fetch(baseUrl, getOptions);

    if (getResponse.getResponseCode() === 200) {

      var json = JSON.parse(getResponse.getContentText());

      if (json.data && Array.isArray(json.data)) {

        json.data.forEach(function(staff) {

          existingNames.add(staff.name.trim());

        });

      }

    } else {

      console.log("Warning: Could not fetch existing staff. Response: " + getResponse.getContentText());

    }

  } catch (e) {

    console.log("Error fetching staff: " + e.toString());

  }

  

  var addedCount = 0;

  var skippedCount = 0;

  var errorCount = 0;

  

  employees.forEach(function(empName) {

    var cleanName = empName.toString().trim();

    if (existingNames.has(cleanName)) {

      skippedCount++;

      return;

    }

  

    var payload = {

      "name": cleanName

    };

  

    var postOptions = {

      "method": "post",

      "headers": headers,

      "payload": JSON.stringify(payload),

      "muteHttpExceptions": true

    };

  

    try {

      var postRes = UrlFetchApp.fetch(baseUrl, postOptions);

      if (postRes.getResponseCode() === 201 || postRes.getResponseCode() === 200) {

        addedCount++;

        existingNames.add(cleanName);

      } else {

        errorCount++;

        console.log("Failed to add '" + cleanName + "': " + postRes.getContentText());

      }

    } catch (e) {

      errorCount++;

      console.log("Exception adding '" + cleanName + "': " + e.toString());

    }

    Utilities.sleep(150);

  });

  

  ui.alert("Sync Complete!\n\n" +

           "✅ Added: " + addedCount + "\n" +

           "⏭️ Skipped (Already Exist): " + skippedCount + "\n" +

           "❌ Errors: " + errorCount);

}

  

// =========================================

// HELPER FUNCTION

// =========================================

function createOrOverwriteSheet(ss, sheetName, headers, data) {

  var sheet = ss.getSheetByName(sheetName);

  if (sheet) ss.deleteSheet(sheet);

  sheet = ss.insertSheet(sheetName);

  if (headers && headers.length > 0) {

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");

  }

  if (data && data.length > 0) {

    if (sheetName === "ClientList") {

       sheet.getRange(2, 2, data.length, 1).setNumberFormat("@");

    }

    sheet.getRange(2, 1, data.length, data[0].length).setValues(data);

  }

  if (headers.length > 0) {

    sheet.autoResizeColumns(1, headers.length);

  }

}
```