import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { BooksyParser } from './parsers/booksy-parser.js';
import { DikidiParser } from './parsers/dikidi-parser.js';
import { ZapisParser } from './parsers/zapis-parser.js';
import { matchExcelFile, matchTextData } from './tools/fuzzy-matcher.js';
import db from './database.js';

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS and parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup multer storage
const uploadsDir = process.env.UPLOADS_DIR || './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  }
});
const upload = multer({ storage });

// Mapped directories
const wikiDir = process.env.WIKI_DIR || './wiki';
if (!fs.existsSync(wikiDir)) {
  fs.mkdirSync(wikiDir, { recursive: true });
}
const scriptsDir = process.env.SCRIPTS_DIR || './scripts-collection';
if (!fs.existsSync(scriptsDir)) {
  fs.mkdirSync(scriptsDir, { recursive: true });
}

// In-memory active SSE connections for job logging
const activeClients = new Map();

// Helper to log messages to db and push via SSE
function logToJob(jobId, message) {
  const time = new Date().toISOString();
  const msg = `[${time}] ${message}`;
  
  // 1. Get existing logs from DB
  const job = db.prepare('SELECT logs FROM jobs WHERE id = ?').get(jobId);
  const existingLogs = job?.logs ? job.logs + '\n' : '';
  const newLogs = existingLogs + msg;
  
  // 2. Update DB
  db.prepare('UPDATE jobs SET logs = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newLogs, jobId);

  // 3. Send to active SSE connection if exists
  const client = activeClients.get(jobId);
  if (client) {
    client.write(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`);
  }
}

function updateJobStatus(jobId, status, resultFile = null) {
  db.prepare('UPDATE jobs SET status = ?, result_file = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(status, resultFile, jobId);

  const client = activeClients.get(jobId);
  if (client) {
    client.write(`data: ${JSON.stringify({ type: 'status', status, resultFile })}\n\n`);
  }
}

// Create basic Knowledge Base welcome if empty
const welcomeFile = path.join(wikiDir, 'Welcome.md');
if (!fs.existsSync(welcomeFile)) {
  fs.writeFileSync(welcomeFile, `# Welcome to Specialist Central

This is your Knowledge Base. Here you can document and read company guidelines, glossaries, and tasks.

## Automation Center
Feel free to create and edit articles. All files are loaded instantly from persistent volume mounts.
`);
}

// --- PARSER API ---
app.post('/api/parsers/upload', upload.fields([
  { name: 'bookingsFile', maxCount: 1 },
  { name: 'staffFile', maxCount: 1 },
  { name: 'servicesFile', maxCount: 1 },
  { name: 'visitsFile', maxCount: 1 },
  { name: 'worksheetFile', maxCount: 1 },
  { name: 'inventoryFile', maxCount: 1 }
]), async (req, res) => {
  const { parserType, threshold } = req.body;
  const files = req.files || {};
  const jobId = `job_${Date.now()}`;

  // Insert job trace
  db.prepare('INSERT INTO jobs (id, type, status, logs) VALUES (?, ?, ?, ?)')
    .run(jobId, `Parser: ${parserType}`, 'pending', `[${new Date().toISOString()}] Job created.`);

  res.json({ jobId });

  // Run parser asynchronously
  setTimeout(async () => {
    updateJobStatus(jobId, 'processing');
    logToJob(jobId, `Starting parsing process for ${parserType}`);

    try {
      let parser;
      let parserFiles = {};
      let parserOpts = { threshold };

      if (parserType === 'Booksy') {
        parser = new BooksyParser();
        parserFiles = {
          bookingsFile: files.bookingsFile?.[0]?.path,
          staffFile: files.staffFile?.[0]?.path,
          servicesFile: files.servicesFile?.[0]?.path,
        };
      } else if (parserType === 'Dikidi') {
        parser = new DikidiParser();
        parserFiles = {
          visitsFile: files.visitsFile?.[0]?.path,
          worksheetFile: files.worksheetFile?.[0]?.path,
        };
      } else if (parserType === 'Zapis.kz') {
        parser = new ZapisParser();
        parserFiles = {
          visitsFile: files.visitsFile?.[0]?.path,
          inventoryFile: files.inventoryFile?.[0]?.path,
        };
      } else {
        throw new Error(`Unsupported parser type: ${parserType}`);
      }

      const result = await parser.parse(parserFiles, parserOpts, (msg) => logToJob(jobId, msg));
      logToJob(jobId, `Finished parsing successfully.`);
      updateJobStatus(jobId, 'completed', result.outputFile);
    } catch (err) {
      logToJob(jobId, `ERROR: ${err.message}`);
      updateJobStatus(jobId, 'failed');
    }
  }, 100);
});

// --- SSE JOBS LOGS STREAM ---
app.get('/api/jobs/:id/logs', (req, res) => {
  const jobId = req.params.id;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // bypass Nginx buffering
  });

  // Load existing logs
  const job = db.prepare('SELECT status, logs, result_file FROM jobs WHERE id = ?').get(jobId);
  if (job) {
    res.write(`data: ${JSON.stringify({ type: 'status', status: job.status, resultFile: job.result_file })}\n\n`);
    const logs = (job.logs || '').split('\n');
    logs.forEach(logLine => {
      if (logLine) res.write(`data: ${JSON.stringify({ type: 'log', message: logLine })}\n\n`);
    });
  }

  activeClients.set(jobId, res);

  req.on('close', () => {
    activeClients.delete(jobId);
  });
});

// --- TOOLS API ---
app.post('/api/tools/fuzzy-match/file', upload.single('matchFile'), async (req, res) => {
  const file = req.file;
  const { threshold } = req.body;
  const jobId = `job_${Date.now()}`;

  if (!file) {
    return res.status(400).json({ error: 'Missing matchFile' });
  }

  db.prepare('INSERT INTO jobs (id, type, status, logs) VALUES (?, ?, ?, ?)')
    .run(jobId, 'Fuzzy Match File', 'pending', `[${new Date().toISOString()}] Job created.`);

  res.json({ jobId });

  setTimeout(async () => {
    updateJobStatus(jobId, 'processing');
    logToJob(jobId, 'Starting fuzzy match process on uploaded spreadsheet...');

    try {
      const result = await matchExcelFile(file.path, parseFloat(threshold || 70), (msg) => logToJob(jobId, msg));
      updateJobStatus(jobId, 'completed', result.outputFile);
    } catch (err) {
      logToJob(jobId, `ERROR: ${err.message}`);
      updateJobStatus(jobId, 'failed');
    }
  }, 100);
});

app.post('/api/tools/fuzzy-match/text', (req, res) => {
  const { mainText, libText, threshold } = req.body;
  try {
    const results = matchTextData(mainText, libText, parseFloat(threshold || 70));
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function mapClientHeader(h) {
  const n = String(h || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (/^phone|тел|mobile|номер/.test(n)) return "phone";
  if (/^first|имя|name$|^name\s*\(/.test(n) || n === "first name" || n === "имя") return "firstName";
  if (/surname|фамил|last\s*name|lastname/.test(n)) return "surname";
  if (/patronym|отчество|middle/.test(n)) return "patronymic";
  return null;
}

function normalizeClientPhone(p) {
  return String(p ?? "").trim().replace(/[\s\-\(\)\+]/g, "");
}

function splitClientLine(line) {
  if (line.includes("\t")) return line.split("\t");
  const m = line.match(/("([^"]|"")*"|[^,]+)(?=,|$)/g);
  if (m) return m.map((s) => s.replace(/^"|"$/g, "").replace(/""/g, '"').trim());
  return line.split(",").map((s) => s.trim());
}

function extractClientList(json) {
  if (!json) return [];
  const pushFromArray = (arr) => {
    const out = [];
    for (const item of arr) {
      const id = item?.id ?? item?.client_id ?? item?.attributes?.id;
      if (id != null && id !== "") {
        out.push({ id: String(id), raw: item });
      }
    }
    return out;
  };
  const data = json.data;
  if (Array.isArray(data)) return pushFromArray(data);
  if (data && typeof data === "object") {
    if (Array.isArray(data.items)) return pushFromArray(data.items);
    if (Array.isArray(data.clients)) return pushFromArray(data.clients);
    if (Array.isArray(data.records)) return pushFromArray(data.records);
    if (Array.isArray(data.data)) return pushFromArray(data.data);
    const id = data.id ?? data.client_id;
    if (id != null) return [{ id: String(id), raw: data }];
  }
  if (Array.isArray(json.items)) return pushFromArray(json.items);
  if (Array.isArray(json.clients)) return pushFromArray(json.clients);
  if (Array.isArray(json.results)) return pushFromArray(json.results);
  return [];
}

// Batch Clients Surname Update Tool
app.post('/api/tools/upload-clients', upload.single('clientsFile'), (req, res) => {
  const { companyId, token, userToken, clientsText } = req.body;
  const file = req.file;
  const jobId = `job_${Date.now()}`;

  db.prepare('INSERT INTO jobs (id, type, status, logs) VALUES (?, ?, ?, ?)')
    .run(jobId, 'Altegio Clients Update', 'pending', `[${new Date().toISOString()}] Job created.`);

  res.json({ jobId });

  setTimeout(async () => {
    updateJobStatus(jobId, 'processing');
    logToJob(jobId, `Starting batch client surname update (Company ID: ${companyId})...`);

    try {
      const parsedClients = [];

      // 1. Process Excel File Upload if provided
      if (file) {
        logToJob(jobId, `Parsing clients Excel file: ${file.originalname}`);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(file.path);
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error('No worksheets found in file.');

        // Get header row and map columns
        const headerRow = [];
        sheet.getRow(1).eachCell((cell) => {
          headerRow.push(cell.value?.toString() || '');
        });

        const colMap = {};
        headerRow.forEach((h, i) => {
          const key = mapClientHeader(h);
          if (key) colMap[i + 1] = key; // ExcelJS columns are 1-indexed
        });

        if (Object.keys(colMap).length === 0) {
          throw new Error('Could not parse Excel headers. Ensure columns like Phone, First Name, Surname are present.');
        }

        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const rec = { phone: '', firstName: '', surname: '', patronymic: '' };
          let any = false;
          Object.entries(colMap).forEach(([colIdxStr, key]) => {
            const colIdx = Number(colIdxStr);
            const val = row.getCell(colIdx).value?.toString().trim() || '';
            if (val) any = true;
            if (key === 'phone') rec.phone = normalizeClientPhone(val);
            else rec[key] = val;
          });

          // Fallback phone detection
          if (!rec.phone && any) {
            row.eachCell((cell) => {
              const raw = cell.value?.toString().trim() || '';
              if (/^\+?\d[\d\s\-()]{6,}$/.test(raw.replace(/\s/g, ''))) {
                rec.phone = normalizeClientPhone(raw);
                return false;
              }
            });
          }

          if (rec.phone) {
            parsedClients.push(rec);
          }
        });

        try { fs.unlinkSync(file.path); } catch (e) {}
      }

      // 2. Process Pasted Text if provided
      if (clientsText && clientsText.trim()) {
        logToJob(jobId, 'Parsing pasted clients text...');
        const lines = clientsText.split(/\r?\n/).filter(l => l.trim().length);
        if (lines.length > 0) {
          const headerParts = splitClientLine(lines[0]);
          const colMap = {};
          headerParts.forEach((h, i) => {
            const key = mapClientHeader(h);
            if (key) colMap[i] = key;
          });

          if (Object.keys(colMap).length === 0) {
            throw new Error('Could not parse pasted headers. Ensure Phone, First Name, Surname are present on the first line.');
          }

          for (let r = 1; r < lines.length; r++) {
            const parts = splitClientLine(lines[r]);
            const rec = { phone: '', firstName: '', surname: '', patronymic: '' };
            Object.entries(colMap).forEach(([idxStr, key]) => {
              const idx = Number(idxStr);
              const val = parts[idx] != null ? String(parts[idx]).trim() : '';
              if (key === 'phone') rec.phone = normalizeClientPhone(val);
              else rec[key] = val;
            });
            if (rec.phone) parsedClients.push(rec);
          }
        }
      }

      logToJob(jobId, `Parsed ${parsedClients.length} clients to process.`);
      if (parsedClients.length === 0) {
        throw new Error('No valid client records with phone numbers found.');
      }

      const authHeaders = {
        'Authorization': `Bearer ${token}, User ${userToken}`,
        'Accept': 'application/vnd.api.v2+json',
        'Content-Type': 'application/json'
      };

      let updatedCount = 0;
      let notFoundCount = 0;
      let errorCount = 0;

      // 3. Process each client
      for (let i = 0; i < parsedClients.length; i++) {
        const client = parsedClients[i];
        logToJob(jobId, `[${i + 1}/${parsedClients.length}] Processing phone: ${client.phone}`);

        try {
          // A. Search client by phone
          const searchBody = {
            page: 1,
            page_size: 50,
            fields: ['id', 'name'],
            order_by: 'name',
            order_by_direction: 'desc',
            operation: 'AND',
            filters: [
              {
                type: 'quick_search',
                state: { value: client.phone }
              }
            ]
          };

          const searchUrl = `https://api.alteg.io/api/v1/company/${companyId}/clients/search`;
          const searchRes = await fetch(searchUrl, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(searchBody)
          });

          if (!searchRes.ok) {
            const errText = await searchRes.text();
            throw new Error(`Search failed: HTTP ${searchRes.status} - ${errText}`);
          }

          const searchJson = await searchRes.json();
          const list = extractClientList(searchJson);

          if (!list || list.length === 0) {
            logToJob(jobId, `  [Warning] Client not found for phone ${client.phone}`);
            notFoundCount++;
            continue;
          }

          const clientId = list[0].id;

          // B. Update name/surname/patronymic if any is present
          const hasNameFields = !!(client.firstName || client.surname || client.patronymic);
          if (!hasNameFields) {
            logToJob(jobId, `  [Warning] Nothing to update for client ${clientId} (empty fields)`);
            notFoundCount++;
            continue;
          }

          const updatePayload = { phone: client.phone };
          if (client.firstName) updatePayload.name = client.firstName;
          if (client.surname) updatePayload.surname = client.surname;
          if (client.patronymic) updatePayload.patronymic = client.patronymic;

          const putUrl = `https://api.alteg.io/api/v1/client/${companyId}/${clientId}`;
          const putRes = await fetch(putUrl, {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify(updatePayload)
          });

          if (putRes.ok) {
            updatedCount++;
            logToJob(jobId, `  Successfully updated client ID ${clientId} with new details.`);
          } else {
            const errText = await putRes.text();
            throw new Error(`PUT failed: HTTP ${putRes.status} - ${errText}`);
          }

        } catch (err) {
          errorCount++;
          logToJob(jobId, `  [Error] Failed processing phone ${client.phone}: ${err.message}`);
        }

        // Delay to protect against rate limiting (429)
        await new Promise(resolve => setTimeout(resolve, 220));
      }

      logToJob(jobId, `Clients update job finished!`);
      logToJob(jobId, `Summary: Updated: ${updatedCount}, Not Found: ${notFoundCount}, Errors: ${errorCount}`);
      updateJobStatus(jobId, 'completed');
    } catch (err) {
      logToJob(jobId, `FATAL ERROR: ${err.message}`);
      updateJobStatus(jobId, 'failed');
    }
  }, 100);
});

// Helper functions for normalization matching (mirroring the original tool)
function normalizeText(str) {
  if (!str) return '';
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/\s+/g, ' ')            // convert multiple spaces
    .toLowerCase()
    .trim();
}

function findExactMatch(list, targetName) {
  if (!list || !Array.isArray(list)) return -1;
  
  const cleanTarget = normalizeText(targetName);
  
  // 1. Direct exact match
  let index = list.findIndex(item => item.title === targetName);
  if (index !== -1) return index;
  
  // 2. Case-insensitive & accent-insensitive match
  index = list.findIndex(item => normalizeText(item.title) === cleanTarget);
  if (index !== -1) return index;
  
  // 3. Match after stripping parentheticals
  const cleanTargetNoParens = cleanTarget.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  index = list.findIndex(item => {
    const cleanItem = normalizeText(item.title).replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
    return cleanItem === cleanTargetNoParens;
  });
  if (index !== -1) return index;
  
  // 4. Substring Match: Catalog title is inside Target name
  let matches = [];
  list.forEach((item, idx) => {
    const cleanItem = normalizeText(item.title).replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
    if (cleanItem && cleanItem.length > 2 && cleanTarget.includes(cleanItem)) {
      matches.push({ index: idx, length: cleanItem.length });
    }
  });
  if (matches.length > 0) {
    matches.sort((a, b) => b.length - a.length);
    return matches[0].index;
  }
  
  // 5. Superstring Match: Target name is inside Catalog title
  matches = [];
  list.forEach((item, idx) => {
    const cleanItem = normalizeText(item.title).replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
    if (cleanTargetNoParens && cleanTargetNoParens.length > 2 && cleanItem.includes(cleanTargetNoParens)) {
      matches.push({ index: idx, length: cleanItem.length });
    }
  });
  if (matches.length > 0) {
    matches.sort((a, b) => a.length - b.length);
    return matches[0].index;
  }
  
  return -1;
}

// --- TRANSLATIONS UPLOADER API ---
app.post('/api/tools/upload-translations', upload.single('translationsFile'), (req, res) => {
  const { companyId, token, userToken, translationsText, matchMode, targetLanguage, translationMode } = req.body;
  const file = req.file;
  const jobId = `job_${Date.now()}`;
  const tMode = translationMode || 'services';

  db.prepare('INSERT INTO jobs (id, type, status, logs) VALUES (?, ?, ?, ?)')
    .run(jobId, `Altegio Translations Upload (${tMode})`, 'pending', `[${new Date().toISOString()}] Job created.`);

  res.json({ jobId });

  setTimeout(async () => {
    updateJobStatus(jobId, 'processing');
    logToJob(jobId, `Starting Translations Update Job (Company ID: ${companyId}, Target Language ID: ${targetLanguage}, Mode: ${tMode})...`);

    try {
      const items = [];

      // 1. Process Excel File Upload if provided
      if (file) {
        logToJob(jobId, `Parsing translations file: ${file.originalname}`);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(file.path);
        const sheet = workbook.worksheets[0];
        
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; // skip header
          const lookupKey = row.getCell(1).value?.toString().trim();
          const translation = row.getCell(2).value?.toString().trim();
          if (lookupKey && translation) {
            items.push({ lookupKey, translation });
          }
        });
        
        // Clean up uploaded file
        try { fs.unlinkSync(file.path); } catch (e) {}
      }

      // 2. Process Pasted Text if provided
      if (translationsText && translationsText.trim()) {
        logToJob(jobId, 'Parsing pasted translations text...');
        const lines = translationsText.split('\n');
        lines.forEach(line => {
          if (!line.trim()) return;
          const parts = line.split(/[,;\t]/);
          const lookupKey = parts[0]?.trim();
          const translation = parts[1]?.trim();
          if (lookupKey && translation) {
            items.push({ lookupKey, translation });
          }
        });
      }

      logToJob(jobId, `Parsed ${items.length} translation mappings.`);
      if (items.length === 0) {
        throw new Error('No translations data provided. Please upload a file or paste text.');
      }

      // 3. Setup auth headers & fetch catalog
      const authHeaders = {
        'Authorization': `Bearer ${token}, User ${userToken}`,
        'Accept': 'application/vnd.api.v2+json',
        'Content-Type': 'application/json'
      };

      let services = [];
      let categories = [];

      if (tMode === 'services') {
        logToJob(jobId, 'Fetching services list from Altegio API...');
        const fetchUrl = `https://api.alteg.io/api/v1/services/${companyId}`;
        const getRes = await fetch(fetchUrl, { headers: authHeaders });
        
        if (!getRes.ok) {
          const errText = await getRes.text();
          throw new Error(`Failed to fetch Altegio services (HTTP ${getRes.status}): ${errText}`);
        }

        const getJson = await getRes.json();
        services = getJson.data || [];
        logToJob(jobId, `Loaded ${services.length} existing services from Altegio.`);
      } else {
        logToJob(jobId, 'Fetching service categories list from Altegio API...');
        const fetchUrl = `https://app.alteg.io/api/v1/service_categories/${companyId}`;
        const getRes = await fetch(fetchUrl, { headers: authHeaders });
        
        if (!getRes.ok) {
          const errText = await getRes.text();
          throw new Error(`Failed to fetch Altegio service categories (HTTP ${getRes.status}): ${errText}`);
        }

        const getJson = await getRes.json();
        categories = getJson.data || [];
        logToJob(jobId, `Loaded ${categories.length} existing categories from Altegio.`);
      }

      let updatedCount = 0;
      let notFoundCount = 0;
      let errorCount = 0;
      const langId = parseInt(targetLanguage, 10) || 1;

      // 4. Loop & update each record
      for (const item of items) {
        const { lookupKey, translation } = item;

        if (tMode === 'services') {
          let matchedService = null;

          if (matchMode === 'byID' || /^\d+$/.test(lookupKey)) {
            matchedService = services.find(s => String(s.id) === lookupKey);
          } else {
            const index = findExactMatch(services, lookupKey);
            if (index !== -1) matchedService = services[index];
          }

          // Fallback to title search API if not found
          if (!matchedService && matchMode !== 'byID' && !/^\d+$/.test(lookupKey)) {
            try {
              const searchUrl = `https://app.alteg.io/api/v1/company/${companyId}/services?title=${encodeURIComponent(lookupKey)}`;
              const searchRes = await fetch(searchUrl, { headers: authHeaders });
              if (searchRes.ok) {
                const searchJson = await searchRes.json();
                const searchList = searchJson.data || [];
                const exactIdx = findExactMatch(searchList, lookupKey);
                if (exactIdx !== -1) matchedService = searchList[exactIdx];
              }
            } catch (e) {
              logToJob(jobId, `  [Warning] Search fallback error for "${lookupKey}": ${e.message}`);
            }
          }

          if (!matchedService) {
            logToJob(jobId, `[Warning] Service not found for lookup: "${lookupKey}"`);
            notFoundCount++;
            continue;
          }

          const serviceId = matchedService.id;
          logToJob(jobId, `Processing service: "${matchedService.title}" (ID: ${serviceId}) -> "${translation}"`);

          try {
            // A. Fetch service details
            const detailsUrl = `https://app.alteg.io/api/v1/company/${companyId}/services/${serviceId}/details?include[]=translations`;
            const detailsRes = await fetch(detailsUrl, { headers: authHeaders });
            
            if (!detailsRes.ok) {
              logToJob(jobId, `  [Error] Failed to fetch details for service ID ${serviceId}`);
              errorCount++;
              continue;
            }

            const detailsJson = await detailsRes.json();
            const serviceDetails = detailsJson.data;
            if (!serviceDetails) {
              logToJob(jobId, `  [Error] No details returned for service ID ${serviceId}`);
              errorCount++;
              continue;
            }

            // B. Map staff
            const bodyMasterSettings = [];
            if (serviceDetails.staff && Array.isArray(serviceDetails.staff)) {
              serviceDetails.staff.forEach(element => {
                bodyMasterSettings.push({
                  master_id: element.id,
                  technological_card_id: element.technological_card_id,
                  hours: Math.floor((element.seance_length || 0) / 3600),
                  minutes: Math.floor(((element.seance_length || 0) % 3600) / 60),
                  price: element.price || 0,
                });
              });
            }

            // C. Map translations
            const existingTranslations = serviceDetails.translations || [];
            const translationMap = new Map();
            existingTranslations.forEach(t => {
              if (t.translation) {
                const val = String(t.translation).trim();
                if (val) translationMap.set(Number(t.language_id), val);
              }
            });
            translationMap.set(Number(langId), translation);

            const finalTranslations = Array.from(translationMap.entries()).map(([language_id, val]) => ({
              language_id,
              translation: val,
            }));

            // D. Save updates
            const editBody = {
              service_id: serviceId,
              master_settings: bodyMasterSettings,
              resource_ids: [],
              translations: finalTranslations,
            };

            const linkUrl = `https://app.alteg.io/api/v1/company/${companyId}/services/links`;
            const postRes = await fetch(linkUrl, {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify(editBody)
            });

            if (postRes.ok) {
              updatedCount++;
              logToJob(jobId, `  Successfully updated translations for "${matchedService.title}".`);
            } else {
              errorCount++;
              const errText = await postRes.text();
              logToJob(jobId, `  [Error] Failed to save translations: ${errText}`);
            }
          } catch (e) {
            errorCount++;
            logToJob(jobId, `  [Error] Exception: ${e.message}`);
          }
        } else {
          // --- CATEGORIES MODE ---
          let matchedCategory = null;

          if (matchMode === 'byID' || /^\d+$/.test(lookupKey)) {
            matchedCategory = categories.find(c => String(c.id) === lookupKey);
          } else {
            const index = findExactMatch(categories, lookupKey);
            if (index !== -1) matchedCategory = categories[index];
          }

          if (!matchedCategory) {
            logToJob(jobId, `[Warning] Category not found for lookup: "${lookupKey}"`);
            notFoundCount++;
            continue;
          }

          const categoryId = matchedCategory.id;
          logToJob(jobId, `Processing category: "${matchedCategory.title}" (ID: ${categoryId}) -> "${translation}"`);

          try {
            // A. Fetch details
            const detailsUrl = `https://app.alteg.io/api/v1/service_category/${companyId}/${categoryId}`;
            const detailsRes = await fetch(detailsUrl, { headers: authHeaders });
            
            let categoryDetails = matchedCategory;
            if (detailsRes.ok) {
              const detailsJson = await detailsRes.json();
              if (detailsJson.data) {
                categoryDetails = detailsJson.data;
              }
            }

            // B. Map translations
            const existingTranslations = categoryDetails.translations || [];
            const translationMap = new Map();
            existingTranslations.forEach(t => {
              if (t.translation) {
                const val = String(t.translation).trim();
                if (val) translationMap.set(Number(t.language_id), val);
              }
            });
            translationMap.set(Number(langId), translation);

            const finalTranslations = Array.from(translationMap.entries()).map(([language_id, val]) => ({
              language_id,
              translation: val,
            }));

            // C. Build PUT body
            const editBody = {
              title: categoryDetails.title || matchedCategory.title || lookupKey,
              translations: finalTranslations,
            };

            if (categoryDetails.salon_service_id !== undefined && categoryDetails.salon_service_id !== null) {
              editBody.salon_service_id = categoryDetails.salon_service_id;
            }
            if (categoryDetails.weight !== undefined) editBody.weight = categoryDetails.weight;
            if (categoryDetails.sex !== undefined) editBody.sex = categoryDetails.sex;
            if (categoryDetails.api_id !== undefined && categoryDetails.api_id !== null && categoryDetails.api_id !== '') {
              editBody.api_id = categoryDetails.api_id;
            }
            if (categoryDetails.staff && Array.isArray(categoryDetails.staff)) {
              editBody.staff = categoryDetails.staff.map(s => s.id || s);
            }

            const putUrl = `https://app.alteg.io/api/v1/service_category/${companyId}/${categoryId}`;
            const putRes = await fetch(putUrl, {
              method: 'PUT',
              headers: authHeaders,
              body: JSON.stringify(editBody)
            });

            if (putRes.ok) {
              const responseJson = await putRes.json().catch(() => ({}));
              if (responseJson.success === false) {
                errorCount++;
                logToJob(jobId, `  [Error] Category update rejected: ${responseJson.meta?.message || 'No message'}`);
              } else {
                updatedCount++;
                logToJob(jobId, `  Successfully updated translations for Category "${matchedCategory.title}".`);
              }
            } else {
              errorCount++;
              const errText = await putRes.text();
              logToJob(jobId, `  [Error] Failed to save Category translations: ${errText}`);
            }
          } catch (e) {
            errorCount++;
            logToJob(jobId, `  [Error] Category exception: ${e.message}`);
          }
        }

        // Delay to protect against rate limits (429)
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      logToJob(jobId, `Translations update completed!`);
      logToJob(jobId, `Summary: Updated: ${updatedCount}, Not Found: ${notFoundCount}, Errors: ${errorCount}`);
      updateJobStatus(jobId, 'completed');
    } catch (err) {
      logToJob(jobId, `FATAL ERROR: ${err.message}`);
      updateJobStatus(jobId, 'failed');
    }
  }, 100);
});

// --- WIDGET SCRIPTS GALLERY API ---
app.get('/api/scripts', (req, res) => {
  try {
    const files = fs.readdirSync(scriptsDir);
    const scripts = files
      .filter(file => (file.endsWith('.html') || file.endsWith('.js')) && !file.endsWith('.user.js'))
      .map(file => {
        const filePath = path.join(scriptsDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          lastModified: stats.mtime
        };
      });
    res.json(scripts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- TAMPERMONKEY SCRIPTS GALLERY API ---
app.get('/api/tampermonkey', (req, res) => {
  try {
    const files = fs.readdirSync(scriptsDir);
    const scripts = files
      .filter(file => file.endsWith('.user.js'))
      .map(file => {
        const filePath = path.join(scriptsDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          lastModified: stats.mtime
        };
      });
    res.json(scripts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scripts/content', (req, res) => {
  const { name } = req.query;
  try {
    const filePath = path.join(scriptsDir, String(name));
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.send(content);
    } else {
      res.status(404).json({ error: 'Script not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scripts/save', (req, res) => {
  const { name, content } = req.body;
  try {
    // Basic validation
    if (!name || (!name.endsWith('.html') && !name.endsWith('.js') && !name.endsWith('.user.js'))) {
      return res.status(400).json({ error: 'Invalid script name. Must end with .html, .js, or .user.js' });
    }
    const cleanName = name.replace(/[^a-zA-Z0-9_\-\.\s]/g, '');
    const filePath = path.join(scriptsDir, cleanName);
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true, name: cleanName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/scripts/delete', (req, res) => {
  const { name } = req.query;
  try {
    const filePath = path.join(scriptsDir, String(name));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Script not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tampermonkey download endpoint
app.get('/scripts/download/:name', (req, res) => {
  const { name } = req.params;
  try {
    const filePath = path.join(scriptsDir, name);
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'application/javascript');
      res.sendFile(path.resolve(filePath));
    } else {
      res.status(404).send('Script not found');
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// --- KNOWLEDGE BASE (WIKI) API ---
app.get('/api/wiki/list', (req, res) => {
  try {
    const files = fs.readdirSync(wikiDir);
    const articles = files
      .filter(file => file.endsWith('.md'))
      .map(file => file.replace('.md', ''));
    res.json(articles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wiki/read', (req, res) => {
  const { file } = req.query;
  try {
    const filePath = path.join(wikiDir, `${file}.md`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.json({ file, content });
    } else {
      res.status(404).json({ error: 'Article not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wiki/save', (req, res) => {
  const { file, content } = req.body;
  try {
    const cleanFile = file.replace(/[^a-zA-Z0-9_\-\s]/g, '');
    const filePath = path.join(wikiDir, `${cleanFile}.md`);
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true, file: cleanFile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wiki/delete', (req, res) => {
  const { file } = req.query;
  try {
    const filePath = path.join(wikiDir, `${file}.md`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Article not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DOWNLOAD STATIC FILES ---
app.get('/api/files/download/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

// --- SETTINGS API ---
app.get('/api/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  const settings = req.body;
  try {
    const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const transaction = db.transaction((data) => {
      for (const [key, value] of Object.entries(data)) {
        insert.run(key, String(value));
      }
    });
    transaction(settings);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- BOOKSY SERVICE EXTRACTOR ---
app.post('/api/tools/booksy-extract-services', upload.single('visitsFile'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'Missing visitsFile' });
  }

  const jobId = `job_${Date.now()}`;
  db.prepare('INSERT INTO jobs (id, type, status, logs) VALUES (?, ?, ?, ?)')
    .run(jobId, 'Booksy Service Extractor', 'pending', `[${new Date().toISOString()}] Job created.`);

  res.json({ jobId });

  setTimeout(async () => {
    updateJobStatus(jobId, 'processing');
    logToJob(jobId, 'Reading Booksy visits file...');

    try {
      const { default: ExcelJS } = await import('exceljs');

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file.path);
      const ws = wb.worksheets[0];

      if (!ws) throw new Error('No worksheet found in file.');

      // Map headers
      const headerRow = ws.getRow(1);
      const colMap = {};
      headerRow.eachCell((cell, colNum) => {
        const name = String(cell.value || '').trim().toLowerCase();
        colMap[name] = colNum;
      });

      logToJob(jobId, `Detected columns: ${Object.keys(colMap).join(', ')}`);

      const COL_SERVICE = colMap['service_name'];
      const COL_PRICE = colMap['price'];
      const COL_FINAL = colMap['final_price'];
      const COL_FROM = colMap['booked_from'];
      const COL_TILL = colMap['booked_till'];
      const COL_STAFF = colMap['staffer'];

      if (!COL_SERVICE) throw new Error('Could not find "service_name" column in file.');

      // Aggregate per service
      const serviceMap = new Map();

      ws.eachRow((row, rowIndex) => {
        if (rowIndex === 1) return; // skip header

        const serviceName = String(row.getCell(COL_SERVICE).value || '').trim();
        if (!serviceName) return;

        const price = parseFloat(row.getCell(COL_PRICE)?.value) || null;
        const finalPrice = parseFloat(row.getCell(COL_FINAL)?.value) || null;
        const staff = COL_STAFF ? String(row.getCell(COL_STAFF).value || '').trim() : null;

        // Calculate duration in minutes
        let durationMin = null;
        if (COL_FROM && COL_TILL) {
          const fromVal = row.getCell(COL_FROM).value;
          const tillVal = row.getCell(COL_TILL).value;
          if (fromVal && tillVal) {
            const fromDate = fromVal instanceof Date ? fromVal : new Date(fromVal);
            const tillDate = tillVal instanceof Date ? tillVal : new Date(tillVal);
            const diffMs = tillDate - fromDate;
            if (!isNaN(diffMs) && diffMs > 0) {
              durationMin = Math.round(diffMs / 60000);
            }
          }
        }

        if (!serviceMap.has(serviceName)) {
          serviceMap.set(serviceName, {
            count: 0,
            prices: [],
            finalPrices: [],
            durations: [],
            staffSet: new Set()
          });
        }

        const entry = serviceMap.get(serviceName);
        entry.count++;
        if (price !== null && !isNaN(price)) entry.prices.push(price);
        if (finalPrice !== null && !isNaN(finalPrice)) entry.finalPrices.push(finalPrice);
        if (durationMin !== null) entry.durations.push(durationMin);
        if (staff) entry.staffSet.add(staff);
      });

      logToJob(jobId, `Found ${serviceMap.size} unique services across ${ws.rowCount - 1} visit rows.`);

      // Build output workbook
      const outWb = new ExcelJS.Workbook();
      const outWs = outWb.addWorksheet('Extracted Services');

      // Style header row
      outWs.columns = [
        { header: 'Service Name', key: 'service', width: 45 },
        { header: 'Booking Count', key: 'count', width: 16 },
        { header: 'Price Min', key: 'priceMin', width: 14 },
        { header: 'Price Max', key: 'priceMax', width: 14 },
        { header: 'Avg Final Price', key: 'avgFinal', width: 16 },
        { header: 'Duration Min (min)', key: 'durMin', width: 20 },
        { header: 'Duration Max (min)', key: 'durMax', width: 20 },
        { header: 'Duration Avg (min)', key: 'durAvg', width: 20 },
        { header: 'Staff Members', key: 'staff', width: 55 }
      ];

      // Style header
      const headerRowOut = outWs.getRow(1);
      headerRowOut.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRowOut.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
      headerRowOut.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRowOut.height = 20;

      const avg = (arr) => arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;
      const min = (arr) => arr.length ? Math.min(...arr) : null;
      const max = (arr) => arr.length ? Math.max(...arr) : null;

      // Sort by booking count desc
      const sorted = [...serviceMap.entries()].sort((a, b) => b[1].count - a[1].count);

      for (const [name, data] of sorted) {
        outWs.addRow({
          service: name,
          count: data.count,
          priceMin: min(data.prices),
          priceMax: max(data.prices),
          avgFinal: avg(data.finalPrices),
          durMin: min(data.durations),
          durMax: max(data.durations),
          durAvg: avg(data.durations),
          staff: [...data.staffSet].sort().join(', ')
        });
      }

      // Alternate row colors
      outWs.eachRow((row, idx) => {
        if (idx > 1) {
          const fill = idx % 2 === 0
            ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }
            : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
          row.fill = fill;
        }
      });

      // Save output
      const outFilename = `Extracted_Services_${Date.now()}.xlsx`;
      const outPath = path.join(uploadsDir, outFilename);
      await outWb.xlsx.writeFile(outPath);

      logToJob(jobId, `Extraction complete. ${serviceMap.size} services written.`);
      updateJobStatus(jobId, 'completed', outFilename);

      // Clean up uploaded input
      fs.unlink(file.path, () => {});

    } catch (err) {
      logToJob(jobId, `ERROR: ${err.message}`);
      updateJobStatus(jobId, 'failed');
    }
  }, 100);
});

// --- BOOKSY CLIENTS PARSER: Read Headers ---
app.post('/api/tools/booksy-clients/read-headers', upload.single('clientsFile'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Missing clientsFile' });

  try {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file.path);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('No worksheet found.');

    const headers = [];
    ws.getRow(1).eachCell((cell) => {
      const val = String(cell.value || '').trim();
      if (val) headers.push(val);
    });

    fs.unlink(file.path, () => {});
    res.json({ headers });
  } catch (err) {
    fs.unlink(file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

// --- BOOKSY CLIENTS PARSER: Process File ---
app.post('/api/tools/booksy-clients/process', upload.single('clientsFile'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Missing clientsFile' });

  let columnConfig;
  try {
    columnConfig = JSON.parse(req.body.columnConfig || '[]');
  } catch {
    return res.status(400).json({ error: 'Invalid columnConfig JSON' });
  }

  const jobId = `job_${Date.now()}`;
  db.prepare('INSERT INTO jobs (id, type, status, logs) VALUES (?, ?, ?, ?)')
    .run(jobId, 'Booksy Clients Parser', 'pending', `[${new Date().toISOString()}] Job created.`);

  res.json({ jobId });

  setTimeout(async () => {
    updateJobStatus(jobId, 'processing');
    logToJob(jobId, 'Reading clients file...');

    try {
      const { default: ExcelJS } = await import('exceljs');

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file.path);
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('No worksheet found.');

      // Map header names → column indices
      const headerRow = ws.getRow(1);
      const colIndexMap = {};
      headerRow.eachCell((cell, colNum) => {
        const name = String(cell.value || '').trim();
        if (name) colIndexMap[name] = colNum;
      });

      // Determine output columns from config
      const keepCols   = columnConfig.filter(c => c.action === 'keep');
      const commentCols = columnConfig.filter(c => c.action === 'comment').map(c => c.name);
      const deleteCols  = columnConfig.filter(c => c.action === 'delete').length;

      logToJob(jobId, `Keep: ${keepCols.length} cols | Comment+: ${commentCols.length} cols | Delete: ${deleteCols} cols`);

      // Auto-detect phone & first_name columns (case-insensitive, among ALL source headers)
      const allHeaders = Object.keys(colIndexMap);
      const phoneColName = allHeaders.find(h => /phone|mobile|tel/i.test(h)) || null;
      const nameColName  = allHeaders.find(h => /first.?name|firstname/i.test(h)) || null;
      if (phoneColName) logToJob(jobId, `Phone column detected: "${phoneColName}"`);
      if (nameColName)  logToJob(jobId, `First name column detected: "${nameColName}"`);

      // --- PASS 1: Read all data rows, trim, detect phone/name ---
      const allRows = [];
      ws.eachRow((row, rowIndex) => {
        if (rowIndex === 1) return;
        const rowData = {};
        for (const [name, colIdx] of Object.entries(colIndexMap)) {
          const rawVal = row.getCell(colIdx).value;
          rowData[name] = rawVal != null ? String(rawVal).trim() : '';
        }
        allRows.push(rowData);
      });
      logToJob(jobId, `Total input rows: ${allRows.length}`);

      // --- RULE 3: Populate first_name with 'no-name' if empty ---
      if (nameColName) {
        let filledCount = 0;
        for (const row of allRows) {
          if (!row[nameColName]) { row[nameColName] = 'no-name'; filledCount++; }
        }
        if (filledCount) logToJob(jobId, `Filled ${filledCount} empty first_name cells with "no-name"`);
      }

      // --- RULE 4: Split rows with missing phone into Discard ---
      let discardRows = [];
      let validRows = allRows;
      if (phoneColName) {
        discardRows = allRows.filter(r => !r[phoneColName]);
        validRows   = allRows.filter(r =>  r[phoneColName]);
        logToJob(jobId, `${discardRows.length} rows missing phone → Discard sheet`);
      }

      // --- RULE 1: Deduplicate by phone (keep first occurrence) ---
      if (phoneColName) {
        const seen = new Set();
        const before = validRows.length;
        validRows = validRows.filter(r => {
          const phone = r[phoneColName];
          if (seen.has(phone)) return false;
          seen.add(phone);
          return true;
        });
        const dupes = before - validRows.length;
        if (dupes) logToJob(jobId, `Removed ${dupes} duplicate phone rows`);
      }

      logToJob(jobId, `Rows to export: ${validRows.length} | Discard: ${discardRows.length}`);

      // Helper to style a header row
      const styleHeader = (headerRowRef) => {
        headerRowRef.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRowRef.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
        headerRowRef.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRowRef.height = 20;
      };

      const styleDataRows = (sheet) => {
        sheet.eachRow((row, idx) => {
          if (idx > 1) {
            row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF5F5F5' : 'FFFFFFFF' } };
          }
        });
      };

      // Build output workbook
      const outWb = new ExcelJS.Workbook();
      const outWs = outWb.addWorksheet('Clients');

      // Output column definitions: use rename if provided, else original name
      const outColumns = keepCols.map(col => {
        const outName = col.rename && col.rename.trim() ? col.rename.trim() : col.name;
        return { header: outName, key: col.name, width: Math.max(outName.length + 4, 20) };
      });
      if (commentCols.length > 0) {
        outColumns.push({ header: 'Comment+', key: '__comment__', width: 80 });
      }
      outWs.columns = outColumns;
      styleHeader(outWs.getRow(1));

      // Write valid rows
      for (const rowData of validRows) {
        const outRow = {};
        for (const col of keepCols) {
          outRow[col.name] = rowData[col.name] ?? '';
        }
        if (commentCols.length > 0) {
          const parts = commentCols
            .map(n => rowData[n] ? `${n}: ${rowData[n]}` : null)
            .filter(Boolean);
          outRow['__comment__'] = parts.join(' | ');
        }
        outWs.addRow(outRow);
      }
      styleDataRows(outWs);

      // --- Write Discard sheet (all original columns) ---
      if (discardRows.length > 0) {
        const discardWs = outWb.addWorksheet('Discard');
        discardWs.columns = allHeaders.map(h => ({ header: h, key: h, width: Math.max(h.length + 4, 18) }));
        styleHeader(discardWs.getRow(1));
        for (const rowData of discardRows) {
          discardWs.addRow(rowData);
        }
        styleDataRows(discardWs);
      }

      const outFilename = `Processed_Clients_${Date.now()}.xlsx`;
      const outPath = path.join(uploadsDir, outFilename);
      await outWb.xlsx.writeFile(outPath);

      logToJob(jobId, `Done. ${validRows.length} clients exported | ${discardRows.length} discarded.`);
      updateJobStatus(jobId, 'completed', outFilename);
      fs.unlink(file.path, () => {});

    } catch (err) {
      logToJob(jobId, `ERROR: ${err.message}`);
      updateJobStatus(jobId, 'failed');
      fs.unlink(file.path, () => {});
    }
  }, 100);
});

// Start Server
app.listen(port, () => {
  console.log(`[Server] Running on port ${port}`);
});
