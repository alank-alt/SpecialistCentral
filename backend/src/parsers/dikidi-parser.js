import { AbstractParser } from './abstract-parser.js';
import ExcelJS from 'exceljs';
import path from 'path';

export class DikidiParser extends AbstractParser {
  constructor() {
    super('Dikidi');
  }

  async parse(files, options, log) {
    const visitsPath = files.visitsFile; // The main dikidi_visits export file
    const worksheetPath = files.worksheetFile; // Optional Worksheet file with IDs mapping

    if (!visitsPath) {
      throw new Error('Dikidi parser requires visitsFile.');
    }

    log('Loading Dikidi Visits workbook...');
    const visitsWb = new ExcelJS.Workbook();
    await visitsWb.xlsx.readFile(visitsPath);
    const visitsWs = visitsWb.getWorksheet(1);

    // 1. Check if worksheet is provided and load mapping
    const lookupMap = {};
    if (worksheetPath) {
      log('Loading mapping Worksheet workbook...');
      const wsWb = new ExcelJS.Workbook();
      await wsWb.xlsx.readFile(worksheetPath);
      const wsSheet = wsWb.getWorksheet(1);

      // Worksheet columns:
      // Col B (Index 2): ID
      // Col C (Index 3): Name
      // Col K (Index 11): Length
      log('Extracting mapping values from Worksheet...');
      wsSheet.eachRow((row, rowNum) => {
        if (rowNum > 1) {
          const vals = row.values;
          const sName = vals[3] ? String(vals[3]).trim() : '';
          const sID = vals[2] ? String(vals[2]).trim() : '';
          const sLen = vals[11] ? String(vals[11]).trim() : '';
          if (sName) {
            lookupMap[sName] = { id: sID, length: sLen };
          }
        }
      });
      log(`Loaded ${Object.keys(lookupMap).length} mapping entries.`);
    }

    // Initialize lists for secondary sheets
    const employeesSet = new Set();
    const servicesSet = new Set();
    const empServicesSet = new Set();
    const clientsSet = new Set();
    const serviceToEmployeesMap = {};
    const servicePricesMap = {};

    const COL_EMPLOYEE = 1; // Col A
    const COL_CLIENT_NAME = 2; // Col B
    const COL_CLIENT_PHONE = 3; // Col C
    const COL_SERVICE_NAME = 5; // Col E
    const COL_SERVICE_PRICE = 6; // Col F
    const COL_SERVICE_IDS_OUTPUT = 8; // Col H

    const processedVisitsRows = [];
    let visitsHeaders = [];

    log('Processing Dikidi visits rows...');
    visitsWs.eachRow((row, rowNum) => {
      const vals = Array.isArray(row.values) ? row.values : [];
      if (rowNum === 1) {
        // Headers row. Make sure it has enough cols
        visitsHeaders = vals.map(v => String(v || '').trim());
        // Pad header to Col H (Index 8)
        while (visitsHeaders.length <= 8) {
          visitsHeaders.push('');
        }
        visitsHeaders[COL_SERVICE_IDS_OUTPUT] = 'Service ID';
      } else {
        const employee = vals[COL_EMPLOYEE] ? String(vals[COL_EMPLOYEE]).trim() : '';
        const clientName = vals[COL_CLIENT_NAME] ? String(vals[COL_CLIENT_NAME]).trim() : '';
        const clientPhone = vals[COL_CLIENT_PHONE] ? String(vals[COL_CLIENT_PHONE]).trim() : '';
        const rawServiceName = vals[COL_SERVICE_NAME] ? String(vals[COL_SERVICE_NAME]).trim() : '';
        const priceVal = vals[COL_SERVICE_PRICE];

        // Unique employees
        if (employee) {
          employeesSet.add(employee);
        }

        // Unique clients
        if (clientName) {
          const clientKey = `${clientName}###${clientPhone}`;
          clientsSet.add(clientKey);
        }

        let fixedServiceName = rawServiceName;
        // Normalize commas
        if (fixedServiceName.includes(',')) {
          fixedServiceName = fixedServiceName.replace(/,\s+(?=[A-ZА-Я])/g, '##');
        }

        // Accumulate services prices
        if (fixedServiceName && !fixedServiceName.includes('##')) {
          const parsedPrice = parseFloat(priceVal);
          if (!isNaN(parsedPrice)) {
            if (!servicePricesMap[fixedServiceName]) {
              servicePricesMap[fixedServiceName] = [];
            }
            servicePricesMap[fixedServiceName].push(parsedPrice);
          }
        }

        // Split multiple services
        if (fixedServiceName) {
          const splitServices = fixedServiceName.split('##').map(s => s.trim());
          splitServices.forEach(sName => {
            if (sName) {
              servicesSet.add(sName);

              if (employee) {
                const key = `${employee}###${sName}`;
                empServicesSet.add(key);

                if (!serviceToEmployeesMap[sName]) {
                  serviceToEmployeesMap[sName] = new Set();
                }
                serviceToEmployeesMap[sName].add(employee);
              }
            }
          });
        }

        // Update price logic: if has ##, add ##0
        let updatedPrice = String(priceVal || '0');
        if (fixedServiceName.includes('##') && !updatedPrice.includes('##')) {
          const numberOfServices = fixedServiceName.split('##').length;
          const zerosToAdd = numberOfServices - 1;
          let suffix = '';
          for (let z = 0; z < zerosToAdd; z++) {
            suffix += '##0';
          }
          updatedPrice = updatedPrice + suffix;
        }

        // Update ID list
        let idString = '';
        if (fixedServiceName) {
          const parts = fixedServiceName.split('##').map(p => p.trim());
          const idParts = parts.map(part => {
            if (lookupMap[part]) {
              return lookupMap[part].id;
            }
            return '?';
          });
          idString = idParts.join('##');
        }

        // Construct processed row values
        const rowVals = [...vals];
        // Ensure array is padded
        while (rowVals.length <= 8) {
          rowVals.push('');
        }
        rowVals[COL_SERVICE_NAME] = fixedServiceName;
        rowVals[COL_SERVICE_PRICE] = updatedPrice;
        rowVals[COL_SERVICE_IDS_OUTPUT] = idString;

        processedVisitsRows.push(rowVals);
      }
    });

    log('Building list sheets...');

    // 1. Employees data
    const employeesData = Array.from(employeesSet).sort().map(e => [e]);

    // 2. Services data
    const servicesData = Array.from(servicesSet).sort().map(s => ['Archive', s]);

    // 3. Employee-Service relationships
    const empServicesData = Array.from(empServicesSet).sort().map(key => {
      const parts = key.split('###');
      return [parts[0], parts[1]];
    });

    // 4. Clients list
    const clientsData = Array.from(clientsSet).sort().map(key => {
      const parts = key.split('###');
      return [parts[0], parts[1]];
    });

    // 5. Service with employees, prices, and IDs if available
    const serviceWithEmpsData = [];
    for (const serviceName in serviceToEmployeesMap) {
      const empsList = Array.from(serviceToEmployeesMap[serviceName]).sort().join(', ');
      let minPrice = 'N/A';
      let maxPrice = 'N/A';
      const prices = servicePricesMap[serviceName];
      if (prices && prices.length > 0) {
        minPrice = Math.min(...prices);
        maxPrice = Math.max(...prices);
      }

      let serviceID = '';
      let length = '';
      if (lookupMap[serviceName]) {
        serviceID = lookupMap[serviceName].id;
        length = lookupMap[serviceName].length;
      }

      // Headers: ["Category ID", "Service Name", "Employees List", "From Price", "To Price", "Service ID", "Length"]
      serviceWithEmpsData.push(['Archive', serviceName, empsList, minPrice, maxPrice, serviceID, length]);
    }
    serviceWithEmpsData.sort((a, b) => a[1].localeCompare(b[1]));

    // Construct the final multi-sheet Workbook
    log('Writing output workbooksheets...');
    const outWb = new ExcelJS.Workbook();

    // Sheet 1: dikidi_visits (fixed)
    const outVisits = outWb.addWorksheet('dikidi_visits');
    outVisits.addRow(visitsHeaders.slice(1)); // First element in exceljs values is empty
    processedVisitsRows.forEach(row => {
      outVisits.addRow(row.slice(1));
    });
    outVisits.getRow(1).font = { bold: true };

    // Sheet 2: EmployeeNameLists
    const outEmps = outWb.addWorksheet('EmployeeNameLists');
    outEmps.addRow(['Employee Name']).font = { bold: true };
    employeesData.forEach(row => outEmps.addRow(row));

    // Sheet 3: ServiceList
    const outSvcs = outWb.addWorksheet('ServiceList');
    outSvcs.addRow(['Category ID', 'Service Name']).font = { bold: true };
    servicesData.forEach(row => outSvcs.addRow(row));

    // Sheet 4: Employee-ListProvide-Service
    const outEmpSvcs = outWb.addWorksheet('Employee-ListProvide-Service');
    outEmpSvcs.addRow(['Employee Name', 'Service Name']).font = { bold: true };
    empServicesData.forEach(row => outEmpSvcs.addRow(row));

    // Sheet 5: ListServicesWithEmployees
    const outSvcEmps = outWb.addWorksheet('ListServicesWithEmployees');
    outSvcEmps.addRow(['Category ID', 'Service Name', 'Employees List', 'From Price', 'To Price', 'Service ID', 'Length']).font = { bold: true };
    serviceWithEmpsData.forEach(row => outSvcEmps.addRow(row));

    // Sheet 6: ClientList
    const outClients = outWb.addWorksheet('ClientList');
    outClients.addRow(['Client Name', 'Phone Number']).font = { bold: true };
    // Format Phone Number column as text
    outClients.getColumn(2).numFmt = '@';
    clientsData.forEach(row => outClients.addRow(row));

    const outputFileName = `Dikidi_Parsed_${Date.now()}.xlsx`;
    const outputPath = path.join(process.env.UPLOADS_DIR || './uploads', outputFileName);
    await outWb.xlsx.writeFile(outputPath);

    log(`Dikidi parser finished! Output saved to ${outputFileName}`);
    return {
      outputFile: outputFileName,
      visitsCount: processedVisitsRows.length,
      employeesCount: employeesData.length,
      servicesCount: servicesData.length,
      clientsCount: clientsData.length
    };
  }
}
