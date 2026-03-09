# Backend ↔ Frontend Flow

## Backend (FastAPI, port 8020)

**Entry:** `backend_modified/backend/fastapi_server.py`  
**Run:** `cd backend_modified && python -m backend.fastapi_server`

### Components

| Component | Role |
|-----------|------|
| **ingested_complaints** | Raw emails from IMAP/SendGrid; CRUD, dedup, attachment storage. Data: `data/ingested-complaints.json`, `data/ingested-attachments/<id>/`. |
| **email_ingestion** | IMAP sync: connect, scan, filter complaint keywords, call `save_ingested_complaint()`. |
| **extraction** | OpenAI: extract fields from email + attachments (incl. vision). |
| **validation** | Warranty / document / product checks. |
| **decision** | Build decision pack and auto-decision. |
| **auto_response** | Send auto email (SMTP) based on decision. |
| **dashboard** | Processed complaints CRUD, KPIs, CSV export. Data: `data/processed-complaints/`. |
| **process_complaint.orchestrator** | Runs: load ingested → extract → validate → decision → auto email → save. |

### API Endpoints (Backend)

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| GET | `/health` | health_check | Health check |
| POST | `/api/process-complaint` | process_complaint_endpoint | Run full pipeline for one ingested complaint |
| GET | `/api/ingested-complaints` | list_ingested_complaints | List refs (default) or full list (?full=true) |
| GET | `/api/ingested-complaints/{id}` | get_ingested_complaint_endpoint | Get one ingested complaint |
| POST | `/api/ingested-complaints/clear` | clear_ingested_complaints_endpoint | Clear all ingested |
| GET | `/api/complaints` | list_processed_complaints | List processed complaint summaries |
| POST | `/api/complaints` | save_complaint_endpoint | Save processed complaint |
| GET | `/api/complaints/{id}` | get_complaint_endpoint | Get one processed complaint |
| GET | `/api/dashboard/kpis` | get_dashboard_kpis_endpoint | Dashboard KPIs |
| POST | `/api/sync-inbox` | sync_inbox_endpoint | IMAP sync and ingest |

---

## Frontend (Next.js, port 3000)

**Entry:** `frontend/` (App Router)  
**Run:** `cd frontend && npm run dev`

### Pages & stages

- **/login** → Auth (CSV or API).
- **/** (main app):
  - **Home** → List ingested complaints, sync inbox, select one, “Process Complaint”.
  - **Review** → Show extracted/decision pack for current claim.
  - **Decision** → Draft, PDF, send email.
  - **Dashboard** → KPIs and history.

### Frontend API routes (Next.js) → Backend

All use `getApiUrl()` from `lib/api-config.ts` → `NEXT_PUBLIC_API_URL` or `http://localhost:8020`.

| Frontend route | Proxies to backend | Notes |
|----------------|--------------------|--------|
| GET `/api/ingested-claims` | GET `/api/ingested-complaints` | List for dropdown; frontend maps `complaintRef` → `policyNumber`. |
| GET `/api/ingested-claims/[id]` | GET `/api/ingested-complaints/[id]` | Single ingested complaint. |
| GET `/api/ingested-claims/[id]/attachments?name=` | — | Next runs `runPython('backend.ingested_complaints', ['get', id])`, then serves file from `backend_modified` path. |
| POST `/api/ingested-claims/clear` | POST `/api/ingested-complaints/clear` | Clear ingested. |
| POST `/api/process-claim` | POST `/api/process-complaint` | Body: `ingestedClaimId` → sent as `ingestedComplaintId`. |
| GET `/api/claims` | GET `/api/complaints` | Processed list. |
| POST `/api/claims` | POST `/api/complaints` | Save processed. |
| GET `/api/claims/[claimId]` | GET `/api/complaints/[claimId]` | Single processed claim. |
| GET `/api/dashboard/kpis` | GET `/api/dashboard/kpis` | Dashboard KPIs. |
| POST `/api/sync-inbox` | POST `/api/sync-inbox` | IMAP sync; response `skippedNoComplaint` mapped to `skippedNoFnol` for UI. |

### Frontend-only API routes (no backend proxy)

| Route | Implementation |
|-------|-----------------|
| POST `/api/auth/login` | `lib/auth/csvAuth` – validate against CSV (frontend or project root). |
| POST `/api/drafts` | `lib/drafts` – create draft; writes to `../data/drafts/` (project root). |
| POST `/api/decision-pack/pdf` | jsPDF in Next – generate PDF. |
| POST `/api/send-email` | nodemailer in Next – send email (uses .env). |
| GET `/api/claims/export` | `runPython('backend.dashboard', ['csv'])` – CSV from backend_modified. |
| POST `/api/webhooks/sendgrid-inbound` | `runPython('backend.ingested_complaints', ['save-webhook'], payload)` – save inbound email. |

---

## Data flow summary

1. **Ingestion**
   - **IMAP:** User clicks “Sync Inbox” → Next `POST /api/sync-inbox` → Backend `sync_inbox()` → `save_ingested_complaint()` → `data/ingested-complaints.json` + `data/ingested-attachments/<id>/`.
   - **SendGrid:** SendGrid POST to Next `POST /api/webhooks/sendgrid-inbound` → `runPython(..., 'save-webhook')` → same `save_ingested_complaint()` and files (backend_modified).

2. **List on frontend**
   - Home fetches `GET /api/ingested-claims` → Next → Backend `GET /api/ingested-complaints` → `get_complaint_references()` from same JSON. Refetch on visibility so webhook mail appears after tab focus.

3. **Process complaint**
   - User selects complaint, clicks “Process Complaint” → Next `POST /api/process-claim` with `ingestedClaimId` → Backend `POST /api/process-complaint` with `ingestedComplaintId` → `process_complaint()` → extract → validate → decision → auto email → save to `data/processed-complaints/`.

4. **Review / Decision / Dashboard**
   - Review/Decision use in-memory `claimData` from process response (or load by claimId via `GET /api/claims/[id]`).
   - Dashboard KPIs: Next `GET /api/dashboard/kpis` → Backend → `get_dashboard_kpis()`.

---

## Config and paths

- **Backend .env:** Loaded from repo root `../.env` or `backend_modified/.env` (see `backend/common/config.py` `_get_env_file()`). FastAPI also loads .env at startup in `fastapi_server.py`.
- **Frontend .env:** Next loads `../.env` in `next.config.js`; `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8020`.
- **Python from Next:** `lib/backend.ts` uses `cwd: BACKEND_MODIFIED`, `PYTHONPATH: BACKEND_MODIFIED` so `backend.*` modules resolve to `backend_modified/backend/`.
- **Attachments:** Stored under `backend_modified/data/ingested-attachments/<complaint_id>/`. Next serves them by reading path from `ingested_complaints` get; if path is absolute (e.g. from another OS), file may be missing on this machine.

---

## Checklist

- [x] All backend endpoints used by the app have a matching Next proxy (or frontend-only impl).
- [x] Process-claim body mapping: `ingestedClaimId` → `ingestedComplaintId`.
- [x] List response mapping: `complaintRef` → `policyNumber` in HomePage.
- [x] Sync-inbox response: `skippedNoComplaint` → `skippedNoFnol` for UI.
- [x] SendGrid webhook: `backend.ingested_complaints` (not `ingested_claims`); response `complaintId`/`complaintRef` mapped to `claimId`/`policyNumber`.
- [x] Refetch ingested list on tab visibility so webhook mail shows without full reload.
