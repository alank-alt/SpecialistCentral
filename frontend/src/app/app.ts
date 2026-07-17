import { Component, OnInit, ChangeDetectorRef, ViewChild, ElementRef, AfterViewInit, HostListener } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface ScriptItem {
  name: string;
  size: number;
  lastModified: string;
}

interface FuzzyResult {
  serviceName: string;
  matchedLibName: string;
  score: number;
  id: string;
}

interface TranslationRow {
  key: string;
  value: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
})
export class App implements OnInit, AfterViewInit {
  activeTab: string = 'parsers';
  activeParserTab: string = 'booksy';
  activeToolTab: string = 'fuzzy-matcher';

  // Konami code secret feature
  private konamiSequence: string[] = [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
    'b', 'a'
  ];
  private konamiIndex: number = 0;

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    const key = event.key;
    const targetKey = this.konamiSequence[this.konamiIndex];
    if (key.toLowerCase() === targetKey.toLowerCase()) {
      this.konamiIndex++;
      if (this.konamiIndex === this.konamiSequence.length) {
        this.triggerKonamiSecret();
        this.konamiIndex = 0;
      }
    } else {
      this.konamiIndex = 0;
      if (key.toLowerCase() === this.konamiSequence[0].toLowerCase()) {
        this.konamiIndex = 1;
      }
    }
  }

  triggerKonamiSecret() {
    console.log('Konami code triggered!');
    document.body.classList.add('konami-flash');
    
    // --- PLACEHOLDER FOR ARBITRARY CODE EXECUTION ---
    // If you decide what arbitrary code to execute on the website in the future,
    // put your custom logic (e.g. eval, redirecting, mock admin actions, easter eggs) here.
    // 
    // console.log("Arbitrary code placeholder executing...");
    // ------------------------------------------------

    setTimeout(() => {
      document.body.classList.remove('konami-flash');
    }, 6000);
  }
  
  // Parser file selections
  selectedBookingsFile: File | null = null;
  selectedStaffFile: File | null = null;
  selectedServicesFile: File | null = null;
  selectedDikidiVisitsFile: File | null = null;
  selectedWorksheetFile: File | null = null;
  selectedZapisVisitsFile: File | null = null;
  selectedZapisInventoryFile: File | null = null;
  selectedMatchFile: File | null = null;

  // Configuration options (per-tab company IDs)
  dikidiCompanyId: string = '1299847';
  zapisCompanyId: string = '1299847';
  clientsCompanyId: string = '1299847';
  transCompanyId: string = '1299847';

  // Global Auth Tokens (Settings)
  apiToken: string = '';
  userToken: string = '';

  // Parser options
  booksyThreshold: number = 70.0;
  matchThreshold: number = 70.0;
  
  // Translation tool files
  selectedTransFile: File | null = null;
  translationsTextPaste: string = '';
  translationMatchMode: string = 'byName';
  translationMode: string = 'services';

  // Booksy Service Extractor
  selectedBooksyExtractorFile: File | null = null;
  booksyExtractorActive: boolean = false;
  booksySubTab: string = 'parser';

  // Booksy Clients Parser
  booksyClientsFile: File | null = null;
  booksyClientsHeaders: string[] = [];
  booksyClientsConfig: { name: string, action: string, rename: string }[] = [];
  booksyClientsLoading: boolean = false;
  booksyClientsActive: boolean = false;
  
  // Text match inputs
  textMain: string = '';
  textLib: string = '';
  selectedClientsFile: File | null = null;
  clientsTextPaste: string = '';
  
  // Translations dynamic rows
  translationRows: TranslationRow[] = [
    { key: 'created_booking_page_title', value: 'Ваша запись находится на рассмотрении' }
  ];
  selectedLanguage: string = '2'; // Default English
  languagesList = [
    { id: 1, name: 'Russian (Русский)' },
    { id: 2, name: 'English (Английский)' },
    { id: 3, name: 'German (Немецкий)' },
    { id: 4, name: 'Latvian (Латышский)' },
    { id: 5, name: 'Estonian (Эстонский)' },
    { id: 6, name: 'Lithuanian (Литовский)' },
    { id: 7, name: 'Ukrainian (Украинский)' },
    { id: 8, name: 'French (Французский)' },
    { id: 9, name: 'Italian (Итальянский)' },
    { id: 10, name: 'Spanish (Испанский)' },
    { id: 11, name: 'Chinese (Китайский)' },
    { id: 12, name: 'Turkish (Турецкий)' },
    { id: 13, name: 'Georgian (Грузинский)' },
    { id: 14, name: 'Armenian (Армянский)' },
    { id: 15, name: 'Kazakh (Казахский)' },
    { id: 16, name: 'Croatian (Хорватский)' },
    { id: 17, name: 'Czech (Чешский)' },
    { id: 18, name: 'Romanian (Румынский)' },
    { id: 20, name: 'Arabic (Арабский)' },
    { id: 21, name: 'Bulgarian (Болгарский)' },
    { id: 22, name: 'Hebrew (Иврит)' },
    { id: 23, name: 'Hungarian (Венгерский)' },
    { id: 24, name: 'Serbian (Сербский)' },
    { id: 25, name: 'Slovak (Словацкий)' },
    { id: 26, name: 'Mongolian (Монгольский)' },
    { id: 27, name: 'Azeri (Азербайджанский)' },
    { id: 28, name: 'Polish (Польский)' },
    { id: 29, name: 'Slovenian (Словенский)' },
    { id: 32, name: 'Greek (Греческий)' },
    { id: 33, name: 'Danish (Датский)' },
    { id: 34, name: 'Finnish (Финский)' },
    { id: 35, name: 'Portuguese (Португальский)' },
    { id: 36, name: 'Uzbek (Узбекский)' },
    { id: 37, name: 'English technical (Английский технический)' },
    { id: 38, name: 'Japanese (Японский)' }
  ];

  textMatchResults: FuzzyResult[] = [];

  // Jobs log states
  currentJobId: string | null = null;
  jobLogText: string = '';
  jobStatus: string | null = null;
  resultFile: string | null = null;
  isJobRunning: boolean = false;
  private sseSource: EventSource | null = null;

  // Widget lab and gallery
  widgetScripts: ScriptItem[] = [];
  tampermonkeyScripts: ScriptItem[] = [];
  
  activeWidgetScriptName: string = '';
  widgetScriptNameInput: string = '';
  activeCode: string = '';
  widgetLabEditMode: boolean = false;
  widgetScriptIsNew: boolean = false;

  // Tampermonkey editor state variables
  tampermonkeyEditMode: boolean = false;
  tampermonkeyScriptIsNew: boolean = false;
  activeTampermonkeyScriptName: string = '';
  tampermonkeyScriptNameInput: string = '';
  activeTampermonkeyCode: string = '';

  // Wiki articles
  wikiArticles: string[] = [];
  activeWikiArticle: string = '';
  wikiContentText: string = '';
  wikiFileName: string = '';
  wikiEditMode: boolean = false;
  wikiIsNew: boolean = false;
  parsedWikiHtml: string = '';

  @ViewChild('simulationIframe') iframeRef?: ElementRef<HTMLIFrameElement>;
  @ViewChild('logContainer') logContainerRef!: ElementRef<HTMLDivElement>;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadWidgetScriptsList();
    this.loadTampermonkeyScriptsList();
    this.loadWikiArticlesList();
    this.loadSettings();
  }

  ngAfterViewInit() {
    this.resetSimulationSandbox();
  }

  setActiveTab(tab: string) {
    this.activeTab = tab;
    this.stopLogsStream();
    this.jobLogText = '';
    this.jobStatus = null;
    this.resultFile = null;
    this.currentJobId = null;

    if (tab === 'widget-lab') {
      this.widgetLabEditMode = false;
      this.loadWidgetScriptsList();
      setTimeout(() => this.resetSimulationSandbox(), 100);
    } else if (tab === 'tampermonkey') {
      this.loadTampermonkeyScriptsList();
    }
  }

  getTabTitle(): string {
    switch (this.activeTab) {
      case 'parsers': return 'CRM File Processor';
      case 'tools': return 'Update & Match Tools';
      case 'widget-lab': return 'Widget Customization Lab';
      case 'tampermonkey': return 'Tampermonkey Gallery';
      case 'wiki': return 'Knowledge Base';
      case 'settings': return 'Global API Credentials';
      default: return 'Dashboard';
    }
  }

  // --- SETTINGS (CREDENTIALS) HANDLERS ---
  loadSettings() {
    this.http.get<Record<string, string>>('/api/settings').subscribe({
      next: (data) => {
        if (data['api_token']) this.apiToken = data['api_token'];
        if (data['user_token']) this.userToken = data['user_token'];
        if (data['company_id']) {
          const cid = data['company_id'];
          this.dikidiCompanyId = cid;
          this.zapisCompanyId = cid;
          this.clientsCompanyId = cid;
          this.transCompanyId = cid;
        }
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Failed to load settings', err)
    });
  }

  saveSettings() {
    // Save tokens and the clientsCompanyId as the default company_id in settings
    this.http.post('/api/settings', {
      api_token: this.apiToken,
      user_token: this.userToken,
      company_id: this.clientsCompanyId
    }).subscribe({
      next: () => {
        alert('Credentials successfully saved to SQLite database.');
        this.loadSettings(); // reload
      },
      error: (err) => alert('Failed to save credentials: ' + err.message)
    });
  }

  // --- FILE SELECTIONS ---
  onFileChange(event: any, field: string) {
    const file = event.target.files?.[0] || null;
    if (field === 'bookingsFile') this.selectedBookingsFile = file;
    if (field === 'staffFile') this.selectedStaffFile = file;
    if (field === 'servicesFile') this.selectedServicesFile = file;
    if (field === 'dikidiVisitsFile') this.selectedDikidiVisitsFile = file;
    if (field === 'worksheetFile') this.selectedWorksheetFile = file;
    if (field === 'zapisVisitsFile') this.selectedZapisVisitsFile = file;
    if (field === 'zapisInventoryFile') this.selectedZapisInventoryFile = file;
    if (field === 'matchFile') this.selectedMatchFile = file;
    if (field === 'transFile') this.selectedTransFile = file;
    if (field === 'clientsFile') this.selectedClientsFile = file;
    if (field === 'booksyExtractorFile') this.selectedBooksyExtractorFile = file;
    if (field === 'booksyClientsFile') { this.booksyClientsFile = file; this.booksyClientsHeaders = []; this.booksyClientsConfig = []; }
  }

  // --- JOB STREAM LOGGER ---
  private startLogsStream(jobId: string) {
    this.stopLogsStream();
    this.currentJobId = jobId;
    this.jobLogText = 'Connecting to output log stream...\n';
    this.isJobRunning = true;

    this.sseSource = new EventSource(`/api/jobs/${jobId}/logs`);

    this.sseSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          this.jobLogText += data.message + '\n';
          this.scrollLogsToBottom();
        } else if (data.type === 'status') {
          this.jobStatus = data.status;
          this.resultFile = data.resultFile;
          if (data.status === 'completed' || data.status === 'failed') {
            this.isJobRunning = false;
            this.stopLogsStream();
          }
        }
        this.cdr.detectChanges();
      } catch (err) {
        console.error('Failed to parse SSE logs', err);
      }
    };

    this.sseSource.onerror = (err) => {
      console.error('SSE Error:', err);
      this.isJobRunning = false;
      this.stopLogsStream();
      this.cdr.detectChanges();
    };
  }

  private stopLogsStream() {
    if (this.sseSource) {
      this.sseSource.close();
      this.sseSource = null;
    }
  }

  private scrollLogsToBottom() {
    setTimeout(() => {
      if (this.logContainerRef) {
        const el = this.logContainerRef.nativeElement;
        el.scrollTop = el.scrollHeight;
      }
    }, 50);
  }

  // --- PARSERS LAUNCHERS ---
  runParser(type: string) {
    const formData = new FormData();
    formData.append('parserType', type);

    if (type === 'Booksy') {
      if (this.selectedBookingsFile) formData.append('bookingsFile', this.selectedBookingsFile);
      if (this.selectedStaffFile) formData.append('staffFile', this.selectedStaffFile);
      if (this.selectedServicesFile) formData.append('servicesFile', this.selectedServicesFile);
      formData.append('threshold', String(this.booksyThreshold));
    } else if (type === 'Dikidi') {
      if (this.selectedDikidiVisitsFile) formData.append('visitsFile', this.selectedDikidiVisitsFile);
      if (this.selectedWorksheetFile) formData.append('worksheetFile', this.selectedWorksheetFile);
      formData.append('companyId', this.dikidiCompanyId);
    } else if (type === 'Zapis.kz') {
      if (this.selectedZapisVisitsFile) formData.append('visitsFile', this.selectedZapisVisitsFile);
      if (this.selectedZapisInventoryFile) formData.append('inventoryFile', this.selectedZapisInventoryFile);
      formData.append('companyId', this.zapisCompanyId);
    }

    this.http.post<{ jobId: string }>('/api/parsers/upload', formData).subscribe({
      next: (res) => {
        this.startLogsStream(res.jobId);
      },
      error: (err) => alert('Failed to start parsing job: ' + (err.error?.error || err.message))
    });
  }

  // --- BOOKSY SERVICE EXTRACTOR ---
  runBooksyExtractor() {
    if (!this.selectedBooksyExtractorFile) return;
    const formData = new FormData();
    formData.append('visitsFile', this.selectedBooksyExtractorFile);

    this.booksyExtractorActive = true;
    this.jobStatus = '';
    this.jobLogText = '';

    this.http.post<{ jobId: string }>('/api/tools/booksy-extract-services', formData).subscribe({
      next: (res) => this.startLogsStream(res.jobId),
      error: (err) => alert('Failed to start extraction: ' + (err.error?.error || err.message))
    });
  }

  // --- BOOKSY CLIENTS PARSER ---
  loadBooksyClientsHeaders() {
    if (!this.booksyClientsFile) return;
    this.booksyClientsLoading = true;
    this.booksyClientsHeaders = [];
    this.booksyClientsConfig = [];

    const formData = new FormData();
    formData.append('clientsFile', this.booksyClientsFile);

    this.http.post<{ headers: string[] }>('/api/tools/booksy-clients/read-headers', formData).subscribe({
      next: (res) => {
        this.booksyClientsHeaders = res.headers;
        this.booksyClientsConfig = res.headers.map(h => ({ name: h, action: 'keep', rename: '' }));
        this.booksyClientsLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.booksyClientsLoading = false;
        alert('Failed to read headers: ' + (err.error?.error || err.message));
      }
    });
  }

  setBooksyClientsAction(action: string) {
    this.booksyClientsConfig = this.booksyClientsConfig.map(c => ({ ...c, action }));
  }

  processBooksyClients() {
    if (!this.booksyClientsFile || !this.booksyClientsConfig.length) return;
    const formData = new FormData();
    formData.append('clientsFile', this.booksyClientsFile);
    formData.append('columnConfig', JSON.stringify(this.booksyClientsConfig));

    this.booksyClientsActive = true;
    this.jobStatus = '';
    this.jobLogText = '';

    this.http.post<{ jobId: string }>('/api/tools/booksy-clients/process', formData).subscribe({
      next: (res) => this.startLogsStream(res.jobId),
      error: (err) => alert('Failed to process: ' + (err.error?.error || err.message))
    });
  }

  // --- FUZZY MATCHERS & HELPERS ---
  runFuzzyMatcherFile() {
    if (!this.selectedMatchFile) return;
    const formData = new FormData();
    formData.append('matchFile', this.selectedMatchFile);
    formData.append('threshold', String(this.matchThreshold));

    this.http.post<{ jobId: string }>('/api/tools/fuzzy-match/file', formData).subscribe({
      next: (res) => {
        this.startLogsStream(res.jobId);
      },
      error: (err) => alert('Failed to start match job: ' + err.message)
    });
  }

  runFuzzyMatcherText() {
    this.http.post<{ results: FuzzyResult[] }>('/api/tools/fuzzy-match/text', {
      mainText: this.textMain,
      libText: this.textLib,
      threshold: this.matchThreshold
    }).subscribe({
      next: (res) => {
        this.textMatchResults = res.results;
        this.cdr.detectChanges();
      },
      error: (err) => alert('Error running matching: ' + err.message)
    });
  }

  syncClientsToAltegio() {
    const formData = new FormData();
    formData.append('companyId', this.clientsCompanyId);
    formData.append('token', this.apiToken);
    formData.append('userToken', this.userToken);
    
    if (this.selectedClientsFile) {
      formData.append('clientsFile', this.selectedClientsFile);
    }
    if (this.clientsTextPaste) {
      formData.append('clientsText', this.clientsTextPaste);
    }

    this.http.post<{ jobId: string }>('/api/tools/upload-clients', formData).subscribe({
      next: (res) => this.startLogsStream(res.jobId),
      error: (err) => alert('Failed to sync clients: ' + (err.error?.error || err.message))
    });
  }

  syncTranslationsToAltegio() {
    const formData = new FormData();
    formData.append('companyId', this.transCompanyId);
    formData.append('token', this.apiToken);
    formData.append('userToken', this.userToken);
    formData.append('matchMode', this.translationMatchMode);
    formData.append('targetLanguage', this.selectedLanguage);
    formData.append('translationMode', this.translationMode);
    
    if (this.selectedTransFile) {
      formData.append('translationsFile', this.selectedTransFile);
    }
    if (this.translationsTextPaste) {
      formData.append('translationsText', this.translationsTextPaste);
    }

    this.http.post<{ jobId: string }>('/api/tools/upload-translations', formData).subscribe({
      next: (res) => this.startLogsStream(res.jobId),
      error: (err) => alert('Failed to sync: ' + (err.error?.error || err.message))
    });
  }

  // --- WIDGET SCRIPTS GALLERY & CRUD ---
  loadWidgetScriptsList() {
    this.http.get<ScriptItem[]>('/api/scripts').subscribe({
      next: (data) => {
        this.widgetScripts = data;
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Failed to load scripts list', err)
    });
  }

  loadTampermonkeyScriptsList() {
    this.http.get<ScriptItem[]>('/api/tampermonkey').subscribe({
      next: (data) => {
        this.tampermonkeyScripts = data;
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Failed to load Tampermonkey list', err)
    });
  }

  selectWidgetScript(name: string) {
    this.activeWidgetScriptName = name;
    this.widgetScriptNameInput = name;
    this.widgetScriptIsNew = false;

    this.http.get(`/api/scripts/content?name=${name}`, { responseType: 'text' }).subscribe({
      next: (code) => {
        this.activeCode = code;
        this.widgetLabEditMode = true;
        this.cdr.detectChanges();
        setTimeout(() => this.resetSimulationSandbox(), 50);
      },
      error: (err) => alert('Failed to read script contents')
    });
  }

  startCreateWidgetScript() {
    this.activeWidgetScriptName = '';
    this.widgetScriptNameInput = '';
    this.activeCode = '<script>\n  console.log("Custom script ready");\n</script>';
    this.widgetScriptIsNew = true;
    this.widgetLabEditMode = true;
    this.cdr.detectChanges();
    setTimeout(() => this.resetSimulationSandbox(), 50);
  }

  saveWidgetScript() {
    const filename = this.widgetScriptNameInput.trim();
    if (!filename) {
      alert('File name is required');
      return;
    }

    if (!filename.endsWith('.html') && !filename.endsWith('.js')) {
      alert('File name must end with .html or .js');
      return;
    }

    this.http.post('/api/scripts/save', {
      name: filename,
      content: this.activeCode
    }).subscribe({
      next: () => {
        alert('Script successfully saved.');
        this.widgetLabEditMode = false;
        this.loadWidgetScriptsList();
      },
      error: (err) => alert('Failed to save script: ' + (err.error?.error || err.message))
    });
  }

  deleteWidgetScript(name: string) {
    if (confirm(`Are you sure you want to delete widget script: ${name}?`)) {
      this.http.delete(`/api/scripts/delete?name=${name}`).subscribe({
        next: () => {
          this.loadWidgetScriptsList();
        },
        error: (err) => alert('Failed to delete: ' + err.message)
      });
    }
  }

  exitWidgetLabEditor() {
    this.widgetLabEditMode = false;
    this.loadWidgetScriptsList();
  }

  copyCodeToClipboard() {
    if (this.activeCode) {
      navigator.clipboard.writeText(this.activeCode).then(() => alert('Code copied to clipboard!'));
    }
  }

  resetSimulationSandbox() {
    if (!this.iframeRef) return;
    const iframe = this.iframeRef.nativeElement;
    iframe.src = '/api/widget-simulator-host';
  }

  runSimulation() {
    if (!this.iframeRef || !this.activeCode) return;

    const inject = () => {
      const iframe = this.iframeRef.nativeElement;
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc || !doc.body) return;

      // Clean up previous simulation injections
      doc.querySelectorAll('[data-sc-injected]').forEach(el => el.remove());

      const code = this.activeCode;

      // 1. Extract and inject <style> blocks — use fresh spread to avoid lastIndex state bug
      const styleMatches = [...code.matchAll(/<style>([\s\S]*?)<\/style>/gi)];
      for (const m of styleMatches) {
        const styleNode = doc.createElement('style');
        styleNode.setAttribute('data-sc-injected', '');
        styleNode.textContent = m[1];
        doc.head.appendChild(styleNode);
      }

      // Strip style blocks from remaining code
      let codeToRun = code.replace(/<style>[\s\S]*?<\/style>/gi, '');

      // 2. Extract and inject <script> blocks
      const scriptMatches = [...codeToRun.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/gi)];
      if (scriptMatches.length > 0) {
        for (const m of scriptMatches) {
          const scriptNode = doc.createElement('script');
          scriptNode.type = 'text/javascript';
          scriptNode.setAttribute('data-sc-injected', '');
          scriptNode.textContent = m[1];
          doc.body.appendChild(scriptNode);
        }
      } else {
        // 3. No script tags — treat entire (stripped) content as raw JS
        const stripped = codeToRun.trim();
        if (stripped) {
          const scriptNode = doc.createElement('script');
          scriptNode.type = 'text/javascript';
          scriptNode.setAttribute('data-sc-injected', '');
          scriptNode.textContent = stripped;
          doc.body.appendChild(scriptNode);
        }
      }
    };

    const iframe = this.iframeRef.nativeElement;
    // If the iframe hasn't fully loaded yet, wait; otherwise inject immediately
    if (!iframe.contentDocument || iframe.contentDocument.readyState === 'loading') {
      iframe.onload = () => { inject(); iframe.onload = null; };
    } else {
      inject();
    }
  }

  oneClickInstall(name: string) {
    window.open(`/scripts/download/${name}`, '_blank');
  }

  // --- TAMPERMONKEY MANUAL SCRIPT MANAGEMENT ---
  startCreateTampermonkeyScript() {
    this.activeTampermonkeyScriptName = '';
    this.tampermonkeyScriptNameInput = '';
    this.activeTampermonkeyCode = `// ==UserScript==\n// @name         New Userscript\n// @namespace    http://tampermonkey.net/\n// @version      1.0\n// @description  Custom Tampermonkey script\n// @author       You\n// @match        https://*.alteg.io/*\n// @match        https://*.altegio.com/*\n// @grant        none\n// ==UserScript==\n\n(function() {\n    'use strict';\n    console.log("Tampermonkey script initialized");\n})();`;
    this.tampermonkeyScriptIsNew = true;
    this.tampermonkeyEditMode = true;
    this.cdr.detectChanges();
  }

  selectTampermonkeyScript(name: string) {
    this.activeTampermonkeyScriptName = name;
    this.tampermonkeyScriptNameInput = name;
    this.tampermonkeyScriptIsNew = false;

    this.http.get(`/api/scripts/content?name=${name}`, { responseType: 'text' }).subscribe({
      next: (code) => {
        this.activeTampermonkeyCode = code;
        this.tampermonkeyEditMode = true;
        this.cdr.detectChanges();
      },
      error: (err) => alert('Failed to read script contents')
    });
  }

  saveTampermonkeyScript() {
    let filename = this.tampermonkeyScriptNameInput.trim();
    if (!filename) {
      alert('File name is required');
      return;
    }

    if (!filename.endsWith('.user.js')) {
      if (filename.endsWith('.js')) {
        filename = filename.slice(0, -3) + '.user.js';
      } else {
        filename = filename + '.user.js';
      }
    }

    this.http.post('/api/scripts/save', {
      name: filename,
      content: this.activeTampermonkeyCode
    }).subscribe({
      next: () => {
        alert('Tampermonkey script successfully saved.');
        this.tampermonkeyEditMode = false;
        this.loadTampermonkeyScriptsList();
      },
      error: (err: any) => alert('Failed to save script: ' + (err.error?.error || err.message))
    });
  }

  deleteTampermonkeyScript(name: string) {
    if (confirm(`Are you sure you want to delete Tampermonkey script: ${name}?`)) {
      this.http.delete(`/api/scripts/delete?name=${name}`).subscribe({
        next: () => {
          this.loadTampermonkeyScriptsList();
        },
        error: (err) => alert('Failed to delete: ' + err.message)
      });
    }
  }

  exitTampermonkeyEditor() {
    this.tampermonkeyEditMode = false;
    this.loadTampermonkeyScriptsList();
  }

  // --- WIKI KNOWLEDGE BASE ---
  loadWikiArticlesList() {
    this.http.get<string[]>('/api/wiki/list').subscribe({
      next: (data) => {
        this.wikiArticles = data;
        if (data.length > 0 && !this.activeWikiArticle) {
          this.loadWikiArticle(data[0]);
        }
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Failed to load wiki articles list', err)
    });
  }

  loadWikiArticle(article: string) {
    this.http.get<{ file: string, content: string }>(`/api/wiki/read?file=${article}`).subscribe({
      next: (res) => {
        this.activeWikiArticle = res.file;
        this.wikiContentText = res.content;
        this.wikiFileName = res.file;
        this.wikiEditMode = false;
        this.wikiIsNew = false;
        this.parsedWikiHtml = this.parseMarkdown(res.content);
        this.cdr.detectChanges();
      },
      error: (err) => alert('Failed to read wiki article: ' + err.message)
    });
  }

  startWikiCreate() {
    this.wikiIsNew = true;
    this.wikiFileName = '';
    this.wikiContentText = '# New Page\n\nWrite markdown here.';
    this.wikiEditMode = true;
    this.cdr.detectChanges();
  }

  startWikiEdit() {
    this.wikiIsNew = false;
    this.wikiFileName = this.activeWikiArticle;
    this.wikiEditMode = true;
    this.cdr.detectChanges();
  }

  cancelWikiEdit() {
    this.wikiEditMode = false;
    if (this.activeWikiArticle) {
      this.loadWikiArticle(this.activeWikiArticle);
    }
  }

  saveWikiArticle() {
    if (!this.wikiFileName.trim()) {
      alert('Article name cannot be empty');
      return;
    }

    this.http.post<{ success: boolean, file: string }>('/api/wiki/save', {
      file: this.wikiFileName,
      content: this.wikiContentText
    }).subscribe({
      next: (res) => {
        this.wikiEditMode = false;
        this.activeWikiArticle = res.file;
        this.loadWikiArticlesList();
        this.loadWikiArticle(res.file);
      },
      error: (err) => alert('Failed to save article: ' + err.message)
    });
  }

  deleteWikiArticle() {
    if (this.wikiIsNew) {
      this.wikiEditMode = false;
      return;
    }

    if (confirm(`Are you sure you want to delete article: ${this.activeWikiArticle}?`)) {
      this.http.delete(`/api/wiki/delete?file=${this.activeWikiArticle}`).subscribe({
        next: () => {
          this.wikiEditMode = false;
          this.activeWikiArticle = '';
          this.loadWikiArticlesList();
        },
        error: (err) => alert('Failed to delete: ' + err.message)
      });
    }
  }

  private parseMarkdown(markdown: string): string {
    if (!markdown) return '';
    let html = markdown;

    html = html.replace(/^# (.*?)$/gm, '<h1 class="wiki-h1">$1</h1>');
    html = html.replace(/^## (.*?)$/gm, '<h2 class="wiki-h2">$1</h2>');
    html = html.replace(/^### (.*?)$/gm, '<h3 class="wiki-h3">$1</h3>');

    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    html = html.replace(/^\- (.*?)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>)/g, '<ul style="margin-left: 20px;">$1</ul>');
    html = html.replace(/<\/ul>\s*<ul style="margin-left: 20px;">/g, '');

    html = html.replace(/`(.*?)`/g, '<code style="background-color: #15151a; padding: 2px 6px; color: var(--gold-light); font-family: monospace;">$1</code>');

    html = html.replace(/^(?!<h|<ul|<li|<ol)(.*?)$/gm, '<p>$1</p>');
    html = html.replace(/<p><\/p>/g, '');

    return html;
  }

  // --- HELPERS ---
  formatBytes(bytes: number, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }
}
