import { Component, OnInit, ChangeDetectorRef, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
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
  
  // Parser file selections
  selectedBookingsFile: File | null = null;
  selectedStaffFile: File | null = null;
  selectedServicesFile: File | null = null;
  selectedDikidiVisitsFile: File | null = null;
  selectedWorksheetFile: File | null = null;
  selectedZapisVisitsFile: File | null = null;
  selectedZapisInventoryFile: File | null = null;
  selectedMatchFile: File | null = null;

  // Configuration options
  booksyThreshold: number = 70.0;
  matchThreshold: number = 70.0;
  companyId: string = '';
  apiToken: string = '';
  textMain: string = '';
  textLib: string = '';
  clientsCsv: string = '';
  translationsJson: string = '';

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
  selectedWidgetScriptName: string = '';
  activeCode: string = '';

  // Wiki articles
  wikiArticles: string[] = [];
  activeWikiArticle: string = '';
  wikiContentText: string = '';
  wikiFileName: string = '';
  wikiEditMode: boolean = false;
  wikiIsNew: boolean = false;
  parsedWikiHtml: string = '';

  @ViewChild('simulationIframe') iframeRef!: ElementRef<HTMLIFrameElement>;
  @ViewChild('logContainer') logContainerRef!: ElementRef<HTMLDivElement>;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadWidgetScriptsList();
    this.loadWikiArticlesList();
    this.loadSettings();
  }

  loadSettings() {
    this.http.get<Record<string, string>>('/api/settings').subscribe({
      next: (data) => {
        if (data['company_id']) this.companyId = data['company_id'];
        if (data['api_token']) this.apiToken = data['api_token'];
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Failed to load settings', err)
    });
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
      setTimeout(() => this.resetSimulationSandbox(), 100);
    }
  }

  getTabTitle(): string {
    switch (this.activeTab) {
      case 'parsers': return 'Parsing Center';
      case 'tools': return 'Upload & Match Tools';
      case 'widget-lab': return 'Widget Customization Lab';
      case 'tampermonkey': return 'Tampermonkey Gallery';
      case 'wiki': return 'Knowledge Base';
      default: return 'Dashboard';
    }
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
    } else if (type === 'Zapis.kz') {
      if (this.selectedZapisVisitsFile) formData.append('visitsFile', this.selectedZapisVisitsFile);
      if (this.selectedZapisInventoryFile) formData.append('inventoryFile', this.selectedZapisInventoryFile);
    }

    this.http.post<{ jobId: string }>('/api/parsers/upload', formData).subscribe({
      next: (res) => {
        this.startLogsStream(res.jobId);
      },
      error: (err) => alert('Failed to start parsing job: ' + (err.error?.error || err.message))
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
    const clientsList = this.clientsCsv.split('\n')
      .map(line => {
        const parts = line.split(',');
        return { name: parts[0]?.trim(), phone: parts[1]?.trim() };
      })
      .filter(c => c.name && c.phone);

    this.http.post<{ jobId: string }>('/api/tools/upload-clients', {
      clientsList,
      companyId: this.companyId,
      token: this.apiToken
    }).subscribe({
      next: (res) => this.startLogsStream(res.jobId),
      error: (err) => alert('Failed to sync: ' + err.message)
    });
  }

  syncTranslationsToAltegio() {
    let translations = {};
    try {
      translations = JSON.parse(this.translationsJson);
    } catch (e) {
      alert('Translations Map must be valid JSON');
      return;
    }

    this.http.post<{ jobId: string }>('/api/tools/upload-translations', {
      translations,
      companyId: this.companyId,
      token: this.apiToken
    }).subscribe({
      next: (res) => this.startLogsStream(res.jobId),
      error: (err) => alert('Failed to sync: ' + err.message)
    });
  }

  // --- WIDGET SCRIPTS GALLERY & sandboxed SIMULATION ---
  loadWidgetScriptsList() {
    this.http.get<ScriptItem[]>('/api/scripts').subscribe({
      next: (data) => {
        this.widgetScripts = data;
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Failed to load scripts list', err)
    });
  }

  onWidgetScriptSelect(event: any) {
    const name = event.target.value;
    this.selectedWidgetScriptName = name;
    if (!name) {
      this.activeCode = '';
      return;
    }

    this.http.get(`/api/scripts/content?name=${name}`, { responseType: 'text' }).subscribe({
      next: (code) => {
        this.activeCode = code;
        this.resetSimulationSandbox();
      },
      error: (err) => alert('Failed to read script contents')
    });
  }

  copyCodeToClipboard() {
    if (this.activeCode) {
      navigator.clipboard.writeText(this.activeCode).then(() => alert('Code copied to clipboard!'));
    }
  }

  resetSimulationSandbox() {
    if (!this.iframeRef) return;
    const iframe = this.iframeRef.nativeElement;
    
    const mockDOM = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; padding: 15px; background: #fafafa; color: #333; margin: 0; }
          .widget-container { border: 1px solid #dddddd; padding: 18px; border-radius: 12px; background: white; max-width: 360px; margin: 0 auto; box-shadow: 0 4px 15px rgba(0,0,0,0.06); }
          .form-input__title { font-weight: 600; font-size: 12px; color: #666; margin-bottom: 5px; display: block; text-transform: uppercase; letter-spacing: 0.5px; }
          .time-interval { display: inline-block; padding: 6px 12px; border: 1px solid #c5a059; border-radius: 6px; font-weight: bold; font-size: 13px; margin: 4px; color: #c5a059; cursor: pointer; text-align: center; }
          .any-staff-icon-container { width: 36px; height: 36px; border-radius: 50%; background: #e5c17d; display: inline-flex; align-items: center; justify-content: center; margin-right: 12px; }
          .any-staff-icon { font-size: 15px; color: white; font-weight: bold; }
          .order-tag.success { padding: 12px; border-radius: 8px; margin-top: 15px; background: #e8f5e9; border: 1px solid #c8e6c9; color: #2e7d32; display: flex; align-items: center; gap: 8px; }
          .order-actions { margin-top: 15px; border-top: 1px solid #f0f0f0; padding-top: 15px; }
          [data-locator="service_price"] { font-weight: 700; color: #292b33; font-size: 13px; }
          [data-locator="master_name"] { font-weight: bold; font-size: 14px; color: #292b33; }
        </style>
      </head>
      <body>
        <div class="widget-container">
          <div style="font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Altegio Simulated Widget</div>
          
          <div style="display: flex; align-items: center; margin-bottom: 15px; padding: 8px; border: 1px solid #f0f0f0; border-radius: 8px;">
            <div class="any-staff-icon-container">
              <span class="any-staff-icon">👤</span>
            </div>
            <div>
              <div data-locator="master_name">Любой специалист</div>
              <small style="color: #999;">Select employee</small>
            </div>
          </div>

          <div style="margin-bottom: 15px;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f9f9f9;">
              <span style="font-size: 13px;">Стрижка мужская</span>
              <span data-locator="service_price">8,000&nbsp;₸</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f9f9f9;" data-locator="service_item_EXCLUDED_ID_1">
              <span style="font-size: 13px;">Окрашивание волос (Исключение)</span>
              <span data-locator="service_price">15,000&nbsp;₸</span>
            </div>
          </div>

          <div style="margin-bottom: 15px;">
            <span class="form-input__title" data-locator="whatsapp_notice_field_placeholder">Phone *</span>
            <input type="text" class="form-input__input" value="+7 (701) 555-12-34" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; font-size: 13px;">
          </div>

          <div style="margin-bottom: 15px;">
            <span class="form-input__title">Available Slots</span>
            <div class="time-interval">10:00</div>
            <div class="time-interval">10:05</div>
            <div class="time-interval">10:30</div>
          </div>

          <div class="order-actions">
            <div class="order-tag success">
              <span data-locator="success_icon">✅</span>
              <span data-locator="created_booking_page_title">Запись успешно создана!</span>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(mockDOM);
      doc.close();
    }
  }

  runSimulation() {
    if (!this.iframeRef || !this.activeCode) return;
    this.resetSimulationSandbox(); // Reset first

    const iframe = this.iframeRef.nativeElement;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      const scriptNode = doc.createElement('script');
      scriptNode.type = 'text/javascript';
      
      // Inject code directly, resolving standard script-only and HTML script wrappers
      let executable = this.activeCode;
      if (executable.trim().startsWith('<script>')) {
        executable = executable.replace(/<script>/g, '').replace(/<\/script>/g, '');
      }
      
      // Append styles if style tag is inside HTML code
      const styleMatches = [...this.activeCode.matchAll(/<style>([\s\S]*?)<\/style>/g)];
      styleMatches.forEach(m => {
        const styleNode = doc.createElement('style');
        styleNode.textContent = m[1];
        doc.head.appendChild(styleNode);
      });

      scriptNode.textContent = executable;
      doc.body.appendChild(scriptNode);
    }
  }

  oneClickInstall(name: string) {
    // Open install script endpoint
    window.open(`/scripts/download/${name}`, '_blank');
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

  // Extremely lightweight Markdown to HTML parser
  private parseMarkdown(markdown: string): string {
    if (!markdown) return '';
    let html = markdown;

    // Headers
    html = html.replace(/^# (.*?)$/gm, '<h1 class="wiki-h1">$1</h1>');
    html = html.replace(/^## (.*?)$/gm, '<h2 class="wiki-h2">$1</h2>');
    html = html.replace(/^### (.*?)$/gm, '<h3 class="wiki-h3">$1</h3>');

    // Bold/Italics
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Bullet points
    html = html.replace(/^\- (.*?)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*?<\/li>)/g, '<ul style="margin-left: 20px;">$1</ul>');
    // clean overlapping ul groups
    html = html.replace(/<\/ul>\s*<ul style="margin-left: 20px;">/g, '');

    // Code blocks
    html = html.replace(/`(.*?)`/g, '<code style="background-color: #1a1a24; padding: 2px 6px; color: var(--gold-light); font-family: monospace;">$1</code>');

    // Paragraphs / Linebreaks
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
