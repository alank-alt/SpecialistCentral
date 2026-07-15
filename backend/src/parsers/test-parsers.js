import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { BooksyParser } from './booksy-parser.js';
import { DikidiParser } from './dikidi-parser.js';

async function runTests() {
  console.log('--- Starting Parser Integration Tests ---');
  const tempDir = './uploads/test-temp';
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // 1. GENERATE MOCK BOOKSY FILES
  console.log('Generating mock Booksy files...');
  const bookingsFile = path.join(tempDir, 'Bookings.xlsx');
  const staffFile = path.join(tempDir, 'Staff.xlsx');
  const servicesFile = path.join(tempDir, 'services.xlsx');

  // Bookings
  const bWb = new ExcelJS.Workbook();
  const bWs = bWb.addWorksheet('Sheet1');
  bWs.addRow([
    'booking_id', 'staffer', 'booked_from', 'booked_till', 'customer_first_name', 
    'customer_last_name', 'customer_card_phone', 'customer_id', 'customer_card_id', 
    'service_name', 'price', 'final_price', 'added_by', 'appointment_type', 
    'business_note', 'status', 'booking_finished_at', 'source_name'
  ]);
  bWs.addRow([
    '1', 'Алан Караев', '2026-07-15T10:00:00Z', '2026-07-15T11:00:00Z', 'Иван', 
    'Иванов', '77015551234', '101', '201', 'Стрижка мужская', '8000', '8000', 
    'admin', 'regular', 'note', 'success', '2026-07-15T11:00:00Z', 'widget'
  ]);
  await bWb.xlsx.writeFile(bookingsFile);

  // Staff
  const stWb = new ExcelJS.Workbook();
  const stWs = stWb.addWorksheet('Sheet1');
  stWs.addRow(['Name', 'ID']);
  stWs.addRow(['Алан Караев', '998877']);
  await stWb.xlsx.writeFile(staffFile);

  // Services
  const svWb = new ExcelJS.Workbook();
  const svWs = svWb.addWorksheet('Sheet1');
  svWs.addRow(['Категория', 'ID', 'Имя', 'Цена от', 'Цена до']);
  svWs.addRow(['Стрижки', '334455', 'Стрижка мужская', '8000', '8000']);
  await svWb.xlsx.writeFile(servicesFile);

  // 2. GENERATE MOCK DIKIDI FILES
  console.log('Generating mock Dikidi files...');
  const dikidiVisitsFile = path.join(tempDir, 'dikidi_visits.xlsx');
  const dWb = new ExcelJS.Workbook();
  const dWs = dWb.addWorksheet('dikidi_visits');
  dWs.addRow([
    'Employee', 'Client Name', 'Client Phone', 'Date', 'Service Name', 'Service Price'
  ]);
  dWs.addRow([
    'Алан Караев', 'Петр Петров', '77073334455', '15.07.2026', 'Стрижка мужская, Окрашивание волос', '12000'
  ]);
  await dWb.xlsx.writeFile(dikidiVisitsFile);

  // 3. RUN PARSERS
  console.log('Invoking BooksyParser...');
  const booksyParser = new BooksyParser();
  const booksyResult = await booksyParser.parse(
    { bookingsFile, staffFile, servicesFile },
    { threshold: 70 },
    (msg) => console.log(`[Booksy Log] ${msg}`)
  );
  console.log('Booksy parser results:', booksyResult);

  console.log('Invoking DikidiParser...');
  const dikidiParser = new DikidiParser();
  const dikidiResult = await dikidiParser.parse(
    { visitsFile: dikidiVisitsFile },
    {},
    (msg) => console.log(`[Dikidi Log] ${msg}`)
  );
  console.log('Dikidi parser results:', dikidiResult);

  console.log('--- All Parser Integration Tests Passed Successfully! ---');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
