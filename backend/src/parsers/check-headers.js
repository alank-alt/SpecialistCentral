import XLSX from 'xlsx';

function inspect(filePath, label) {
  console.log(`=== Inspecting ${label} ===`);
  const wb = XLSX.readFile(filePath, { cellDates: true });
  if (wb.SheetNames.length === 0) {
    console.log('No sheets found.');
    return;
  }
  const sheetName = wb.SheetNames[0];
  console.log(`Sheet name: ${sheetName}`);
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log(`Total rows: ${rows.length}`);
  if (rows.length > 0) {
    console.log('Headers:', rows[0].map(h => `'${h}'`));
    console.log('Row 1:', rows[1] ? rows[1].map(v => `'${v}'`) : 'none');
    console.log('Row 2:', rows[2] ? rows[2].map(v => `'${v}'`) : 'none');
  }
}

inspect('C:/Users/Alanno/Downloads/Copy of OKAYnails baza bookingów.xlsx', 'Bookings');
inspect('C:/Users/Alanno/Downloads/Staff.xlsx', 'Staff');
inspect('C:/Users/Alanno/Downloads/services.xls', 'Services');
