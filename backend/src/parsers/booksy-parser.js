import { AbstractParser } from './abstract-parser.js';
import ExcelJS from 'exceljs';
import path from 'path';

// Re-implementation of Python's difflib.SequenceMatcher ratio
function getMatchingBlocks(a, b) {
  function helper(aStart, aEnd, bStart, bEnd) {
    if (aStart >= aEnd || bStart >= bEnd) return [];
    
    let bestI = 0, bestJ = 0, bestLen = 0;
    for (let i = aStart; i < aEnd; i++) {
      for (let j = bStart; j < bEnd; j++) {
        let len = 0;
        while (i + len < aEnd && j + len < bEnd && a[i + len] === b[j + len]) {
          len++;
        }
        if (len > bestLen) {
          bestI = i;
          bestJ = j;
          bestLen = len;
        }
      }
    }
    
    if (bestLen === 0) return [];
    
    const left = helper(aStart, bestI, bStart, bestJ);
    const right = helper(bestI + bestLen, aEnd, bestJ + bestLen, bEnd);
    return [...left, { a: bestI, b: bestJ, size: bestLen }, ...right];
  }
  
  const blocks = helper(0, a.length, 0, b.length);
  blocks.push({ a: a.length, b: b.length, size: 0 });
  return blocks;
}

function sequenceMatcherRatio(a, b) {
  const blocks = getMatchingBlocks(a, b);
  let matches = 0;
  for (const block of blocks) {
    matches += block.size;
  }
  const total = a.length + b.length;
  if (total === 0) return 1.0;
  return (2.0 * matches) / total;
}

function findBestMatch(query, choices) {
  let bestChoice = '';
  let bestScore = -1;
  const qClean = query.toLowerCase();
  for (const choice of choices) {
    const cClean = choice.toLowerCase();
    const ratio = sequenceMatcherRatio(qClean, cClean) * 100;
    if (ratio > bestScore) {
      bestScore = ratio;
      bestChoice = choice;
    }
  }
  return { bestMatch: bestChoice, score: bestScore };
}

// Helper to securely parse Excel or string dates in a standard way
function parseDateSafe(val) {
  if (val instanceof Date) return val;
  if (!val) return null;
  const s = String(val).trim();
  let dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt;

  const parts = s.split(/[\sT]+/);
  if (parts.length >= 1) {
    const dateParts = parts[0].split(/[\.\-/]/);
    const timeParts = (parts[1] || '00:00:00').split(':');
    if (dateParts.length === 3) {
      let day, month, year;
      if (dateParts[2].length === 4) {
        day = parseInt(dateParts[0], 10);
        month = parseInt(dateParts[1], 10) - 1;
        year = parseInt(dateParts[2], 10);
      } else if (dateParts[0].length === 4) {
        year = parseInt(dateParts[0], 10);
        month = parseInt(dateParts[1], 10) - 1;
        day = parseInt(dateParts[2], 10);
      }
      
      const hour = parseInt(timeParts[0] || '0', 10);
      const min = parseInt(timeParts[1] || '0', 10);
      const sec = parseInt(timeParts[2] || '0', 10);
      dt = new Date(year, month, day, hour, min, sec);
      if (!isNaN(dt.getTime())) return dt;
    }
  }
  return null;
}

function getCellValue(cell) {
  if (!cell) return '';
  const val = cell.value;
  if (val && typeof val === 'object') {
    if (val.result !== undefined) return val.result;
    if (val.richText) return val.richText.map(t => t.text || '').join('');
    if (val.text) return val.text;
  }
  return val !== undefined && val !== null ? val : '';
}

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
    const bookingsHeaders = [];
    const firstRow = bookingsWs.getRow(1);
    firstRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      bookingsHeaders[colNumber] = cell.value ? String(cell.value).trim() : '';
    });

    const bookingsRows = [];
    const newCols = ['staffer_ID', 'service_ID', 'duration', 'paid', 'method', 'match'];

    bookingsWs.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const rowObj = {};
      newCols.forEach(col => rowObj[col] = '');

      bookingsHeaders.forEach((header, colIdx) => {
        if (header) {
          rowObj[header] = getCellValue(row.getCell(colIdx));
        }
      });
      bookingsRows.push(rowObj);
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
      if (row['final_price'] !== undefined && row['final_price'] !== '') {
        row['paid'] = row['final_price'];
      }

      // Process dates and duration
      let duration = '';
      let bookedFromStr = '';
      let bookedTillStr = '';

      const fromDt = parseDateSafe(row['booked_from']);
      const tillDt = parseDateSafe(row['booked_till']);

      if (fromDt && tillDt) {
        duration = Math.round((tillDt.getTime() - fromDt.getTime()) / 1000);
        const pad = (n) => String(n).padStart(2, '0');
        bookedFromStr = `${pad(fromDt.getDate())}-${pad(fromDt.getMonth() + 1)}-${fromDt.getFullYear()} ${pad(fromDt.getHours())}:${pad(fromDt.getMinutes())}`;
        bookedTillStr = `${pad(tillDt.getDate())}-${pad(tillDt.getMonth() + 1)}-${tillDt.getFullYear()} ${pad(tillDt.getHours())}:${pad(tillDt.getMinutes())}`;
      } else {
        bookedFromStr = row['booked_from'] || '';
        bookedTillStr = row['booked_till'] || '';
      }

      row['booked_from'] = bookedFromStr;
      row['booked_till'] = bookedTillStr;
      row['duration'] = duration;

      // Staff match
      let staffScore = 0;
      const stafferName = String(row['staffer'] || '').trim();
      if (stafferName && stafferName.toLowerCase() !== 'nan' && staffList.length > 0) {
        const { bestMatch, score } = findBestMatch(stafferName, staffList);
        staffScore = Math.floor(score * 10) / 10.0;
        if (staffScore >= threshold) {
          row['staffer_ID'] = staffMap[bestMatch] || '';
        }
      }

      // Service match
      let serviceScore = 0;
      const serviceName = String(row['service_name'] || '').trim();
      if (serviceName && serviceName.toLowerCase() !== 'nan' && servicesList.length > 0) {
        const { bestMatch, score } = findBestMatch(serviceName, servicesList);
        serviceScore = Math.floor(score * 10) / 10.0;
        if (serviceScore >= threshold) {
          row['service_ID'] = servicesMap[bestMatch] || '';
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

    // 4. Write output Excel, preserving all remaining original columns and new ones
    log('Generating output workbook...');
    const outWb = new ExcelJS.Workbook();
    const outWs = outWb.addWorksheet('Actual Upload Visits');

    // Build headers list preserving order of original file remaining columns
    const remainingHeaders = [];
    bookingsHeaders.forEach(h => {
      if (h && !colsToDelete.includes(h)) {
        remainingHeaders.push(h);
      }
    });

    const finalHeaders = [...remainingHeaders];
    newCols.forEach(col => {
      if (!finalHeaders.includes(col)) {
        finalHeaders.push(col);
      }
    });

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
