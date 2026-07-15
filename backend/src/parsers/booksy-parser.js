import { AbstractParser } from './abstract-parser.js';
import ExcelJS from 'exceljs';
import stringSimilarity from 'string-similarity';
import path from 'path';

export class BooksyParser extends AbstractParser {
  constructor() {
    super('Booksy');
  }

  async parse(files, options, log) {
    const bookingsPath = files.bookingsFile;
    const staffPath = files.staffFile;
    const servicesPath = files.servicesFile;
    const threshold = parseFloat(options.threshold || 70.0);

    if (!bookingsPath || !staffPath || !servicesPath) {
      throw new Error('Booksy parser requires bookingsFile, staffFile, and servicesFile.');
    }

    log('Loading Bookings workbook...');
    const bookingsWb = new ExcelJS.Workbook();
    await bookingsWb.xlsx.readFile(bookingsPath);
    const bookingsWs = bookingsWb.getWorksheet(1);

    log('Loading Staff workbook...');
    const staffWb = new ExcelJS.Workbook();
    await staffWb.xlsx.readFile(staffPath);
    const staffWs = staffWb.getWorksheet(1);

    log('Loading Services workbook...');
    const servicesWb = new ExcelJS.Workbook();
    await servicesWb.xlsx.readFile(servicesPath);
    const servicesWs = servicesWb.getWorksheet(1);

    // 1. Parse Staff dictionary Name -> ID
    log('Extracting staff list...');
    const staffList = [];
    const staffMap = {};
    let staffHeaders = [];
    staffWs.eachRow((row, rowNum) => {
      const vals = row.values;
      if (rowNum === 1) {
        staffHeaders = Array.isArray(vals) ? vals.map(v => String(v || '').trim()) : [];
      } else {
        const nameIdx = staffHeaders.indexOf('Name');
        const idIdx = staffHeaders.indexOf('ID');
        if (nameIdx !== -1 && idIdx !== -1) {
          const name = String(vals[nameIdx] || '').trim();
          const id = String(vals[idIdx] || '').trim();
          if (name && name.toLowerCase() !== 'nan') {
            staffList.push(name);
            staffMap[name] = id;
          }
        }
      }
    });
    log(`Found ${staffList.length} staff members.`);

    // 2. Parse Services dictionary Имя -> ID
    log('Extracting services list...');
    const servicesList = [];
    const servicesMap = {};
    let servicesHeaders = [];
    servicesWs.eachRow((row, rowNum) => {
      const vals = row.values;
      if (rowNum === 1) {
        // exceljs row.values is 1-indexed (first element is empty/undefined)
        servicesHeaders = Array.isArray(vals) ? vals.map(v => String(v || '').trim()) : [];
      } else {
        const nameIdx = servicesHeaders.indexOf('Имя');
        const idIdx = servicesHeaders.indexOf('ID');
        if (nameIdx !== -1 && idIdx !== -1) {
          const name = String(vals[nameIdx] || '').trim();
          const id = String(vals[idIdx] || '').trim();
          if (name && name.toLowerCase() !== 'nan') {
            servicesList.push(name);
            servicesMap[name] = id;
          }
        }
      }
    });
    log(`Found ${servicesList.length} services.`);

    // 3. Process Bookings
    log('Processing bookings data...');
    let bookingsHeaders = [];
    const bookingsRows = [];
    bookingsWs.eachRow((row, rowNum) => {
      const vals = Array.isArray(row.values) ? row.values : [];
      if (rowNum === 1) {
        bookingsHeaders = vals.map(v => String(v || '').trim());
      } else {
        // Store the values indexed by header name for easier manipulation
        const rowObj = {};
        bookingsHeaders.forEach((h, idx) => {
          if (h) rowObj[h] = vals[idx];
        });
        bookingsRows.push(rowObj);
      }
    });

    log(`Total bookings rows to process: ${bookingsRows.length}`);

    // Columns to delete
    const colsToDelete = ['booking_id', 'customer_id', 'customer_card_id', 'added_by', 'appointment_type', 'booking_finished_at', 'source_name', 'price'];

    const formattedBookings = [];
    for (let i = 0; i < bookingsRows.length; i++) {
      const row = bookingsRows[i];

      // Remove unwanted keys
      colsToDelete.forEach(col => delete row[col]);

      // Map final_price to paid
      row['paid'] = row['final_price'];

      // Process dates and duration
      let duration = null;
      let bookedFromStr = '';
      let bookedTillStr = '';

      if (row['booked_from'] && row['booked_till']) {
        const fromDt = new Date(row['booked_from']);
        const tillDt = new Date(row['booked_till']);
        if (!isNaN(fromDt.getTime()) && !isNaN(tillDt.getTime())) {
          // Duration in seconds
          duration = (tillDt.getTime() - fromDt.getTime()) / 1000;
          
          // Format as dd-mm-yyyy HH:MM
          const pad = (n) => String(n).padStart(2, '0');
          bookedFromStr = `${pad(fromDt.getDate())}-${pad(fromDt.getMonth() + 1)}-${fromDt.getFullYear()} ${pad(fromDt.getHours())}:${pad(fromDt.getMinutes())}`;
          bookedTillStr = `${pad(tillDt.getDate())}-${pad(tillDt.getMonth() + 1)}-${tillDt.getFullYear()} ${pad(tillDt.getHours())}:${pad(tillDt.getMinutes())}`;
        }
      }

      row['booked_from'] = bookedFromStr;
      row['booked_till'] = bookedTillStr;
      row['duration'] = duration;
      row['staffer_ID'] = '';
      row['service_ID'] = '';
      row['method'] = ''; // default empty
      row['match'] = '';

      // Staff match
      let staffScore = 0;
      const stafferName = String(row['staffer'] || '').trim();
      if (stafferName && stafferName.toLowerCase() !== 'nan' && staffList.length > 0) {
        let bestStaff = '';
        let bestStaffScore = 0;
        staffList.forEach(s => {
          const score = stringSimilarity.compareTwoStrings(stafferName.toLowerCase(), s.toLowerCase()) * 100;
          if (score > bestStaffScore) {
            bestStaffScore = score;
            bestStaff = s;
          }
        });
        staffScore = Math.floor(bestStaffScore * 10) / 10;
        if (staffScore >= threshold) {
          row['staffer_ID'] = staffMap[bestStaff];
        }
      }

      // Service match
      let serviceScore = 0;
      const serviceName = String(row['service_name'] || '').trim();
      if (serviceName && serviceName.toLowerCase() !== 'nan' && servicesList.length > 0) {
        let bestSvc = '';
        let bestSvcScore = 0;
        servicesList.forEach(s => {
          const score = stringSimilarity.compareTwoStrings(serviceName.toLowerCase(), s.toLowerCase()) * 100;
          if (score > bestSvcScore) {
            bestSvcScore = score;
            bestSvc = s;
          }
        });
        serviceScore = Math.floor(bestSvcScore * 10) / 10;
        if (serviceScore >= threshold) {
          row['service_ID'] = servicesMap[bestSvc];
        }
      }

      // Combined match column
      const matchParts = [];
      if (staffScore > 0) matchParts.push(`Staff: ${staffScore}%`);
      if (serviceScore > 0) matchParts.push(`Service: ${serviceScore}%`);
      if (matchParts.length > 0) {
        row['match'] = matchParts.join(' | ');
      }

      formattedBookings.push(row);

      if ((i + 1) % 50 === 0 || i === bookingsRows.length - 1) {
        log(`Processed ${i + 1}/${bookingsRows.length} rows...`);
      }
    }

    // 4. Write output Excel
    log('Generating output workbook...');
    const outWb = new ExcelJS.Workbook();
    const outWs = outWb.addWorksheet('Actual Upload Visits');

    // Headers list
    const finalHeaders = [
      'staffer', 'booked_from', 'booked_till', 'customer_first_name', 'customer_last_name',
      'customer_card_phone', 'service_name', 'final_price', 'status', 'business_note',
      'staffer_ID', 'service_ID', 'duration', 'paid', 'method', 'match'
    ];

    outWs.addRow(finalHeaders);

    formattedBookings.forEach(row => {
      const rowVals = finalHeaders.map(h => row[h] !== undefined ? row[h] : '');
      outWs.addRow(rowVals);
    });

    // Style header row
    outWs.getRow(1).font = { bold: true };

    const outputFileName = `Booksy_Parsed_${Date.now()}.xlsx`;
    const outputPath = path.join(process.env.UPLOADS_DIR || './uploads', outputFileName);
    await outWb.xlsx.writeFile(outputPath);

    log(`Processing finished successfully! Saved to: ${outputFileName}`);
    return {
      outputFile: outputFileName,
      processedCount: formattedBookings.length
    };
  }
}
