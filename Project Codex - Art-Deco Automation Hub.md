## 1. Vision & Aesthetic

You are building a unified, highly modular automation and productivity hub.

- **Aesthetic Style:** Classical Art-Deco. Inspired by the masterworks of Jean Dunand and Émile-Jacques Ruhlmann.
    
    - **Visual Language:** Rich dark lacquers (blacks/deep charcoals), warm gold/brass geometric accents, clean symmetrical lines, and sophisticated typography.
        
    - **UI Philosophy:** Form and function are one. It should feel like a high-end luxury dashboard, not a generic bootstrap template.
        

## 2. Technical Stack & Containerized Architecture

To eliminate host-machine dependency issues, this entire application must run inside a orchestrated **Docker** environment.

```
                  ┌────────────────────────────────────────┐
                  │              Docker Host               │
                  └───────────────────┬────────────────────┘
                                      │ (Volume Mounts)
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  Angular App     │         │  NodeJS Backend  │         │  SQLite / Files  │
│  (Nginx/Static)  │ ◄─────► │  (Playwright OS) │ ◄─────► │ (Data Persistent)│
└──────────────────┘         └──────────────────┘         └──────────────────┘
```

### Containerization Strategy (`docker-compose.yml`)

1. **Frontend Container:** An Angular container built via multi-stage Dockerfile, served via Nginx.
    
2. **Backend Container:** A Node.js container built on top of an official **Playwright-enabled base image** (e.g., `[mcr.microsoft.com/playwright:v1.40.0-focal](https://mcr.microsoft.com/playwright:v1.40.0-focal)` or equivalent stable tag) to ensure all browser dependencies are baked in.
    
3. **Data Persistence (Volumes):**
    
    - **Database Volume:** Local SQLite database file mapped to the host to persist configurations and script metadata.
        
    - **Knowledge Base Volume:** A folder mapped to the host to store the physical `.md` files, allowing easy manual edits on the host if needed.
        
    - **Uploads/Temp Volume:** A shared scratchpad folder for processing incoming CRM files.
        

## 3. Core Modules & Specifications

### Module A: The Parsing Center

A unified engine designed to take diverse source files (from different CRMs) and map them to a standardized format ready for Altegio upload.

- **Architecture:** Must use a strict **Strategy Pattern** in the backend. There should be a base `AbstractParser` class. Adding a new CRM parser should be as simple as writing a new class that extends `AbstractParser` and registering it.
    
- **UI Requirements:**
    
    - Subsection tabs for **Booksy**, **Dikidi**, and **Zapis.kz**.
        
    - **Booksy Parser:** Upload zones for _Visits_, _Services_, and _Reviews_.
        
    - **Dikidi Parser:** Upload zone for _Visits_.
        
    - **Zapis.kz Parser:** Upload zones for _Visits_ and _Inventory_.
        
    - Drag-and-drop file upload zones styled with geometric Art-Deco borders.
        
    - Real-time processing log (via WebSockets) showing execution progress inside the container.
        

### Module B: Upload Tools (Altegio Integrations)

This is the interface for executing backend Node scripts that communicate with Altegio's API.

- **Key Tools:**
    
    - **Batch Clients Upload:** Maps parsed client lists and pushes them to Altegio via API.
        
    - **Translations Upload:** Batch updates language translations/localizations.
        
- **Execution:** Each upload tool must run as an isolated job or worker. The Angular UI must show a progress bar and real-time execution logs streamed from the backend container.
    

### Module C: Scripts Browser (The Widget Lab)

A gallery for managing and testing JS/HTML scripts meant for modifying Altegio's online booking widget.

- **Gallery UI:** Cards displaying script titles, descriptions, categories, and tags.
    
- **The Widget Lab (Simulation Mode):** A split-screen interface. On the left: code viewer (read-only/copy). On the right: an iframe or a sandboxed container.
    
    - The container mock-simulates the Altegio widget DOM, allowing the user to click "Run Simulation" to see how the script injects and modifies the mock elements.
        
- **Features:** Quick copy to clipboard, code editor view.
    

### Module D: Tampermonkey Gallery

A dedicated space for browser-user-scripts that cannot be fully automated via Playwright.

- **UI:** Elegant list/grid of available Tampermonkey scripts.
    
- **Features:**
    
    - One-Click Install: The backend must serve these scripts at a `/scripts/download/:name.user.js` endpoint with `Content-Type: application/javascript` so browser extensions automatically intercept and prompt installation.
        

### Module E: Knowledge Base (Work Wiki)

A local, specialized Wikipedia for company guidelines, glossaries, and tasks.

- **Frontend:** A dual-mode interface.
    
    - _View Mode:_ Renders local markdown files beautifully with custom Art-Deco typography.
        
    - _Edit Mode:_ A Markdown editor (with preview) to add, redact, or delete articles.
        
- **Backend Storage:** Reads/writes `.md` files directly to the mapped persistent Docker volume.
    

## 4. Extensibility & Setup Guidelines

- **Zero Host-Dependency:** The application must start cleanly with a single command: `docker-compose up --build`. No local `npm install` or local browser installations should be required on the user's computer.
    
- **Modularity:** Ensure that adding a new parser logic file or adding a new markdown file immediately propagates without needing to rebuild the Docker images, utilizing volume hot-reloading for development.

# Repos
Here are the repos made for different tasks. I'm gonna need you to inspect every one of them and then implement them. In the future there are going to be more and more tools so the app needs to be modular to be able to accept new additions

## Parser repos
[[Dikidi]]
[[Booksy]]

# Tool repos
[[FuzzyMatch]]
[[Widget Scripts]]


There are more to come in the future