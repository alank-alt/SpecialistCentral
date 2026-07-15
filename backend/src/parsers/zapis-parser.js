import { AbstractParser } from './abstract-parser.js';
import ExcelJS from 'exceljs';
import path from 'path';

export class ZapisParser extends AbstractParser {
  constructor() {
    super('Zapis.kz');
  }

  async parse(files, options, log) {
    const visitsPath = files.visitsFile;
    const inventoryPath = files.inventoryFile;

    if (!visitsPath) {
      throw new Error('Zapis.kz parser requires visitsFile.');
    }

    log('Loading Zapis.kz Visits workbook...');
    const visitsWb = new ExcelJS.Workbook();
    await visitsWb.xlsx.readFile(visitsPath);
    const visitsWs = visitsWb.getWorksheet(1);

    // Standard column mappings for Zapis.kz
    // Col A: Date, Col B: Time, Col C: Customer, Col D: Phone, Col E: Staff, Col F: Service, Col G: Price, Col H: Status
    log('Processing Zapis.kz visits data...');
    const visits = [];
    let headers = [];

    visitsWs.eachRow((row, rowNum) => {
      const vals = Array.isArray(row.values) ? row.values : [];
      if (rowNum === 1) {
        headers = vals.map(v => String(v || '').trim());
      } else {
        const rowObj = {};
        headers.forEach((h, idx) => {
          if (h) rowObj[h] = vals[idx];
        });
        visits.push(rowObj);
      }
    });

    log(`Read ${visits.length} rows of visits.`);

    // If inventory file is provided
    let inventory = [];
    if (inventoryPath) {
      log('Loading Zapis.kz Inventory workbook...');
      const invWb = new ExcelJS.Workbook();
      await invWb.xlsx.readFile(inventoryPath);
      const invWs = invWb.getWorksheet(1);

      let invHeaders = [];
      invWs.eachRow((row, rowNum) => {
        const vals = Array.isArray(row.values) ? row.values : [];
        if (rowNum === 1) {
          invHeaders = vals.map(v => String(v || '').trim());
        } else {
          const rowObj = {};
          invHeaders.forEach((h, idx) => {
            if (h) rowObj[h] = vals[idx];
          });
          inventory.push(rowObj);
        }
      });
      log(`Read ${inventory.length} rows of inventory.`);
    }

    // Build the output Excel
    log('Writing output workbooksheets...');
    const outWb = new ExcelJS.Workbook();
    
    const visitsSheet = outWb.addWorksheet('Parsed Visits');
    const visitHeadersList = ['Date', 'Customer', 'Phone', 'Staff', 'Service', 'Price', 'Status'];
    visitsSheet.addRow(visitHeadersList).font = { bold: true };

    visits.forEach(row => {
      // Map properties based on common Zapis keys (Russian or English)
      const dateVal = row['Дата'] || row['Date'] || row['booked_from'] || '';
      const nameVal = row['Клиент'] || row['Customer'] || row['client_name'] || '';
      const phoneVal = row['Телефон'] || row['Phone'] || row['client_phone'] || '';
      const staffVal = row['Сотрудник'] || row['Staff'] || row['staffer'] || '';
      const svcVal = row['Услуга'] || row['Service'] || row['service_name'] || '';
      const priceVal = row['Стоимость'] || row['Price'] || row['final_price'] || row['price'] || '';
      const statusVal = row['Статус'] || row['Status'] || row['status'] || '';

      visitsSheet.addRow([dateVal, nameVal, phoneVal, staffVal, svcVal, priceVal, statusVal]);
    });

    if (inventory.length > 0) {
      const invSheet = outWb.addWorksheet('Parsed Inventory');
      const invHeadersList = ['Item Name', 'Sku', 'Category', 'Stock Quantity', 'Unit Price'];
      invSheet.addRow(invHeadersList).font = { bold: true };

      inventory.forEach(row => {
        const nameVal = row['Наименование'] || row['Name'] || row['title'] || '';
        const skuVal = row['Артикул'] || row['SKU'] || row['code'] || '';
        const catVal = row['Категория'] || row['Category'] || '';
        const qtyVal = row['Количество'] || row['Quantity'] || row['stock'] || '';
        const priceVal = row['Цена'] || row['Price'] || '';
        
        invSheet.addRow([nameVal, skuVal, catVal, qtyVal, priceVal]);
      });
    }

    const outputFileName = `Zapis_Parsed_${Date.now()}.xlsx`;
    const outputPath = path.join(process.env.UPLOADS_DIR || './uploads', outputFileName);
    await outWb.xlsx.writeFile(outputPath);

    log(`Zapis.kz parser finished! Output saved to ${outputFileName}`);
    return {
      outputFile: outputFileName,
      visitsCount: visits.length,
      inventoryCount: inventory.length
    };
  }
}
