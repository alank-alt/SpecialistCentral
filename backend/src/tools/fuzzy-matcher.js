import ExcelJS from 'exceljs';
import stringSimilarity from 'string-similarity';
import path from 'path';

// Alias lists matching Python code
const SERVICE_ALIASES = [
  'имя', 'имя услуги', 'имя услуг', 'названия услуг', 'название', 'название услуги', 'название услуг',
  'услуга', 'наименование', 'наименование услуги', 'наименование услуг', 'service', 'service name',
  'services', 'service_name'
];

const ID_ALIASES = [
  'id', 'id услуги', 'идентификатор', 'код', 'код услуги', 'service id', 'service_id'
];

function findColIdx(headers, aliases) {
  for (let i = 0; i < headers.length; i++) {
    const val = String(headers[i] || '').trim().toLowerCase();
    if (aliases.includes(val)) {
      return i; // 0-indexed in JS array
    }
  }
  return -1;
}

export async function matchExcelFile(filePath, threshold, log) {
  log('Loading workbook...');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const wsMain = wb.getWorksheet('main');
  const wsLib = wb.getWorksheet('lib');

  if (!wsMain || !wsLib) {
    throw new Error("Workbook must contain both 'main' and 'lib' sheets.");
  }

  // 1. Get lib headers
  let libHeaders = [];
  wsLib.getRow(1).eachCell((cell, colNumber) => {
    libHeaders[colNumber - 1] = String(cell.value || '').trim();
  });

  const libNameIdx = findColIdx(libHeaders, SERVICE_ALIASES);
  const libIdIdx = findColIdx(libHeaders, ID_ALIASES);

  if (libNameIdx === -1 || libIdIdx === -1) {
    throw new Error("The 'lib' sheet is missing 'Service Name' or 'ID' column.");
  }

  log('Extracting library data...');
  const libNames = [];
  const libMap = {};
  wsLib.eachRow((row, rowNum) => {
    if (rowNum > 1) {
      // row.values is 1-indexed (first item is empty)
      const vals = row.values;
      const name = vals[libNameIdx + 1] ? String(vals[libNameIdx + 1]).trim() : '';
      const id = vals[libIdIdx + 1] ? String(vals[libIdIdx + 1]).trim() : '';
      if (name) {
        libNames.push(name);
        libMap[name] = id;
      }
    }
  });

  if (libNames.length === 0) {
    throw new Error("Library sheet 'lib' is empty.");
  }
  log(`Loaded ${libNames.length} services from library.`);

  // 2. Get main headers
  let mainHeaders = [];
  wsMain.getRow(1).eachCell((cell, colNumber) => {
    mainHeaders[colNumber - 1] = String(cell.value || '').trim();
  });

  const mainSvcIdx = findColIdx(mainHeaders, SERVICE_ALIASES);
  const mainIdIdx = findColIdx(mainHeaders, ID_ALIASES);
  let matchIdx = mainHeaders.findIndex(h => String(h || '').trim().toLowerCase() === 'match');

  if (mainSvcIdx === -1 || mainIdIdx === -1) {
    throw new Error("The 'main' sheet is missing 'Service Name' or 'ID' column.");
  }

  // If no 'match' column exists, create it
  if (matchIdx === -1) {
    matchIdx = mainHeaders.length;
    wsMain.getCell(1, matchIdx + 1).value = 'Match';
    wsMain.getCell(1, matchIdx + 1).font = { bold: true };
  }

  log('Running fuzzy matching...');
  let matchCount = 0;
  wsMain.eachRow((row, rowNum) => {
    if (rowNum > 1) {
      const vals = row.values;
      const serviceName = vals[mainSvcIdx + 1] ? String(vals[mainSvcIdx + 1]).trim() : '';
      if (serviceName && libNames.length > 0) {
        // Find closest match
        let bestMatch = '';
        let bestScore = 0;
        libNames.forEach(name => {
          const score = stringSimilarity.compareTwoStrings(serviceName.toLowerCase(), name.toLowerCase()) * 100;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = name;
          }
        });

        const exactScore = Math.floor(bestScore * 10) / 10;
        row.getCell(matchIdx + 1).value = exactScore;

        if (exactScore >= threshold) {
          row.getCell(mainIdIdx + 1).value = libMap[bestMatch];
          matchCount++;
        }
      }

      if ((rowNum - 1) % 50 === 0 || rowNum === wsMain.rowCount) {
        log(`Processed ${rowNum - 1}/${wsMain.rowCount - 1} rows...`);
      }
    }
  });

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const outputFileName = `${base}_matched_${Date.now()}${ext}`;
  const outputPath = path.join(dir, outputFileName);
  
  await wb.xlsx.writeFile(outputPath);
  log(`Fuzzy matching complete. Matched ${matchCount} rows.`);

  return {
    outputFile: outputFileName,
    matchedCount: matchCount
  };
}

export function matchTextData(mainText, libText, threshold) {
  // mainText is list of service names, one per line
  // libText is CSV/TSV format of "ID,Name" or "Name,ID"
  
  const mainNames = mainText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // Parse lib text
  const libNames = [];
  const libMap = {};
  libText.split('\n').forEach(line => {
    if (!line.trim()) return;
    const parts = line.split(/[\t,;]/).map(p => p.trim());
    if (parts.length >= 2) {
      // Find which part is ID and which is Name
      let id = '';
      let name = '';
      // Simple heuristic: parts containing numbers are ID, parts with alphabetical chars are Name
      const p0IsNum = /^\d+$/.test(parts[0]);
      const p1IsNum = /^\d+$/.test(parts[1]);
      if (p0IsNum && !p1IsNum) {
        id = parts[0];
        name = parts[1];
      } else if (p1IsNum && !p0IsNum) {
        id = parts[1];
        name = parts[0];
      } else {
        // default: name is first, id is second or vice versa
        // Let's assume Name is parts[0], ID is parts[1]
        name = parts[0];
        id = parts[1];
      }
      if (name && id) {
        libNames.push(name);
        libMap[name] = id;
      }
    }
  });

  const results = [];
  mainNames.forEach(svc => {
    let bestMatch = '';
    let bestScore = 0;
    
    if (libNames.length > 0) {
      libNames.forEach(libName => {
        const score = stringSimilarity.compareTwoStrings(svc.toLowerCase(), libName.toLowerCase()) * 100;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = libName;
        }
      });
    }

    const exactScore = Math.floor(bestScore * 10) / 10;
    const matchedId = exactScore >= threshold ? libMap[bestMatch] : '';

    results.push({
      serviceName: svc,
      matchedLibName: bestMatch,
      score: exactScore,
      id: matchedId
    });
  });

  return results;
}
