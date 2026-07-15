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

## Art-Deco Automation Hub
Form and function are one. Feel free to create and edit articles. All files are loaded instantly from persistent volume mounts.
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

// Mock Batch Clients Upload to Altegio
app.post('/api/tools/upload-clients', (req, res) => {
  const { clientsList, companyId, token } = req.body;
  const jobId = `job_${Date.now()}`;

  db.prepare('INSERT INTO jobs (id, type, status, logs) VALUES (?, ?, ?, ?)')
    .run(jobId, 'Altegio Clients Upload', 'pending', `[${new Date().toISOString()}] Job created.`);

  res.json({ jobId });

  setTimeout(async () => {
    updateJobStatus(jobId, 'processing');
    logToJob(jobId, `Starting batch upload of clients to Altegio (Company ID: ${companyId})...`);

    try {
      const clients = Array.isArray(clientsList) ? clientsList : [];
      logToJob(jobId, `Parsed ${clients.length} clients to upload.`);

      for (let i = 0; i < clients.length; i++) {
        const client = clients[i];
        logToJob(jobId, `Uploading client ${i + 1}/${clients.length}: ${client.name} (${client.phone})`);
        
        // Mock Altegio API delay and request
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      logToJob(jobId, 'Successfully completed uploading clients list.');
      updateJobStatus(jobId, 'completed');
    } catch (err) {
      logToJob(jobId, `ERROR: ${err.message}`);
      updateJobStatus(jobId, 'failed');
    }
  }, 100);
});

// Mock Translations Upload
app.post('/api/tools/upload-translations', (req, res) => {
  const { companyId, token, translations } = req.body;
  const jobId = `job_${Date.now()}`;

  db.prepare('INSERT INTO jobs (id, type, status, logs) VALUES (?, ?, ?, ?)')
    .run(jobId, 'Altegio Translations Upload', 'pending', `[${new Date().toISOString()}] Job created.`);

  res.json({ jobId });

  setTimeout(async () => {
    updateJobStatus(jobId, 'processing');
    logToJob(jobId, `Starting translations updates (Company ID: ${companyId})...`);

    try {
      logToJob(jobId, 'Parsing translation values...');
      await new Promise(resolve => setTimeout(resolve, 500));
      logToJob(jobId, 'Uploading translations database to Altegio localization server...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      logToJob(jobId, 'Translations updated successfully.');
      updateJobStatus(jobId, 'completed');
    } catch (err) {
      logToJob(jobId, `ERROR: ${err.message}`);
      updateJobStatus(jobId, 'failed');
    }
  }, 100);
});

// --- WIDGET SCRIPTS GALLERY API ---
app.get('/api/scripts', (req, res) => {
  try {
    const files = fs.readdirSync(scriptsDir);
    const scripts = files
      .filter(file => file.endsWith('.html') || file.endsWith('.js'))
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

// Start Server
app.listen(port, () => {
  console.log(`[Server] Running on port ${port}`);
});
