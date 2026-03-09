# Complaint Resolution Demo – Run Frontend + Backend

This project has a **Next.js frontend** (from the FNOL Autonomous Claims Orchestrator) and a **FastAPI backend** (Consumer Electronics Complaint Resolution). Use these steps to run the full demo.

## Prerequisites

- **Node.js** 18+ (for frontend)
- **Python 3.10+** (for backend)
- Project root `.env` configured (see below)

## 1. Backend (FastAPI) – port 8020

From the **project root** (`backend_complaint_resolution/`):

```bash
cd backend_modified
python -m backend.fastapi_server
# Or: uvicorn backend.fastapi_server:app --host 0.0.0.0 --port 8020 --reload
```

- API: **http://localhost:8020**
- Docs: **http://localhost:8020/docs**
- Health: **http://localhost:8020/health**

## 2. Frontend (Next.js) – port 3000

From the **project root**:

```bash
cd frontend
npm install
npm run dev
```

- App: **http://localhost:3000** (or http://127.0.0.1:3000)
- Login: use credentials from `frontend/login_credentials.csv` if you use CSV auth

The frontend is wired to the backend via:

- **NEXT_PUBLIC_API_URL** (default `http://localhost:8020`) – set in `.env` or `frontend/.env.local` if needed.
- Next.js loads the project root `.env` automatically (see `frontend/next.config.js`).

## 3. Optional: Sync inbox / ingest emails

Backend uses IMAP or SendGrid for ingestion. Configure in project root `.env` (see backend docs). Then:

- Use **Sync Inbox** in the UI, or
- Call **POST http://localhost:8020/api/sync-inbox**

## Path mapping (frontend → backend)

The frontend keeps “claim” wording in the UI but proxies to the backend’s “complaint” API:

| Frontend (Next)        | Backend (FastAPI)           |
|------------------------|-----------------------------|
| `POST /api/process-claim` (body: `ingestedClaimId`) | `POST /api/process-complaint` (body: `ingestedComplaintId`) |
| `GET /api/ingested-claims`  | `GET /api/ingested-complaints`  |
| `GET /api/claims`          | `GET /api/complaints`          |
| `GET /api/dashboard/kpis`  | `GET /api/dashboard/kpis`      |
| `POST /api/sync-inbox`     | `POST /api/sync-inbox`         |

## Troubleshooting

- **Frontend can’t reach backend**  
  Ensure the backend is running on port 8020 and set `NEXT_PUBLIC_API_URL=http://localhost:8020` if you use a different host/port.

- **CORS**  
  Backend allows all origins by default (`CORS_ORIGINS=*`). Restrict in production via `.env`.

- **Attachments 404**  
  Attachment files live under `backend_modified/data/ingested-attachments/`. The frontend serves them via `GET /api/ingested-claims/[id]/attachments?name=...` using the backend’s stored paths.
