# Specialist Central - Automation Center (v1.2.1)

**Specialist Central** is a unified, modular, and containerized automation and productivity dashboard. It is designed to assist specialists in parsing CRM exports, managing online booking widget scripts, local localizations, and maintaining documentation, all while featuring a classical Art-Deco aesthetic.

## Architecture

The application runs entirely inside an orchestrated Docker environment:
- **Frontend Container (`specialist_frontend`):** An Angular application served via Nginx on port `4200`. It proxies API requests to the backend.
- **Backend Container (`specialist_backend`):** A Node.js Express server running on top of a Playwright-enabled base image. Serves port `3000`.
- **SQLite Database (`db/`):** Persists configuration details, settings, and job statuses.
- **Volume Mounts:**
  - `./wiki` -> `/app/wiki` (Persistent Knowledge Base markdown articles)
  - `./scripts-collection` -> `/app/scripts-collection` (Custom Widget & Tampermonkey scripts)
  - `./uploads` -> `/app/uploads` (Temporary directory for processing files)
  - `./db` -> `/app/db` (Persistent SQLite storage)

---

## Features & Modules

### 1. Module A: The Parsing Center
Supports multi-tab CRM file parsing mapping exports to Altegio upload standards:
- **Booksy Parser:** Fuzzy-matches bookings, staff lists, and services.
- **Dikidi Parser:** Generates unique lists (employees, services, clients) and formats visits with proper `##0` syntax. Supports ID matching worksheet lookup.
- **Zapis.kz Parser:** Maps visits and inventory datasets.

### 2. Module B: Upload Tools & Fuzzy Matcher
- **Fuzzy Matcher:** Spreadsheet matching and direct copy-paste name-to-ID matching.
- **Clients Sync:** Batch pushes client listings to Altegio API with custom rate-limiting pauses.
- **Translations:** Localizes online booking languages.

### 3. Module C: Widget Customization Lab
A split-screen coding editor:
- **Left:** Code editor for Javascript and CSS widget modifications.
- **Right:** Sandboxed iframe simulating an Altegio Online Booking widget. Click **Run Simulation** to see live DOM changes and formatting (e.g. timeslot filters, label renames) instantly.

### 4. Module D: Tampermonkey Gallery
Allows browser user-scripts to be installed in one click via a served download link header (`Content-Type: application/javascript`).

### 5. Module E: Knowledge Base (Work Wiki)
View and edit custom Markdown articles stored on the host machine. Renders Markdown layouts with gold borders and elegant typography.

---

## Setup & Startup

To launch the entire stack:
1. Ensure Docker and Docker Compose are installed on your host machine.
2. In the project root, run:
   ```bash
   docker compose up --build
   ```
3. Open your browser and navigate to:
   - Frontend Dashboard: `http://localhost:4200`
   - Backend API: `http://localhost:3000`

---

## Pre-seeded Credentials
For verification, the database is pre-seeded with the following configurations:
- **Company ID:** `1299847`
- **Bearer Token:** `wdgankhxxytuwam7ugxs`
- **User Token:** `498c67ba490f6fefe0ce16f2171a3d70`
