module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/lib/api-config.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * API Configuration for FastAPI backend.
 * 
 * This file provides a centralized way to configure the API base URL.
 * Set NEXT_PUBLIC_API_URL in your .env.local file (or .env) to point to your FastAPI server.
 * Defaults to http://localhost:8020 for local development.
 * 
 * IMPORTANT: Use localhost (not 0.0.0.0) as browsers cannot access 0.0.0.0
 * The server binds to 0.0.0.0:8020 to accept connections from any interface,
 * but the frontend must use localhost:8020 to connect from the browser.
 */ __turbopack_context__.s([
    "API_BASE_URL",
    ()=>API_BASE_URL,
    "getApiUrl",
    ()=>getApiUrl
]);
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8020';
function getApiUrl(endpoint) {
    // Remove leading slash if present to avoid double slashes
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    return `${API_BASE_URL}/${cleanEndpoint}`;
}
}),
"[project]/app/api/dashboard/kpis/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET
]);
/**
 * GET /api/dashboard/kpis
 * Proxies to FastAPI backend and normalizes to camelCase for frontend.
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2d$config$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/api-config.ts [app-route] (ecmascript)");
;
;
async function GET() {
    try {
        const response = await fetch((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2d$config$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getApiUrl"])('api/dashboard/kpis'), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            const error = await response.json().catch(()=>({}));
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: error.detail || 'Failed to load dashboard KPIs'
            }, {
                status: response.status
            });
        }
        const raw = await response.json();
        const recent = raw.recentComplaints ?? raw.recentClaims ?? [];
        const kpis = {
            totalClaims: raw.totalClaims ?? raw.totalComplaints ?? 0,
            claimsThisWeek: raw.claimsThisWeek ?? raw.complaintsThisWeek ?? 0,
            claimsThisMonth: raw.claimsThisMonth ?? raw.complaintsThisMonth ?? 0,
            claimsByLossType: raw.claimsByLossType ?? raw.complaintsByType ?? {},
            coverageMatchRate: raw.coverageMatchRate ?? 0,
            avgConfidence: raw.avgConfidence ?? raw.avgResolutionConfidence ?? 0,
            totalDocumentsProcessed: raw.totalDocumentsProcessed ?? raw.totalComplaints ?? 0,
            claimsByDate: raw.claimsByDate ?? raw.complaintsByDate ?? [],
            recentClaims: recent.map((c)=>({
                    claimId: c.claimId ?? c.complaintId,
                    policyNumber: c.policyNumber ?? c.customerRef,
                    claimantName: c.claimantName ?? c.customerName,
                    lossType: c.lossType ?? c.complaintType ?? 'Other',
                    createdAt: c.createdAt ?? '',
                    policyMatches: c.policyMatches ?? 0
                })),
            complaintsByDecision: raw.complaintsByDecision ?? {},
            warrantyStatusCounts: raw.warrantyStatusCounts ?? {},
            complaintsByCategory: raw.complaintsByCategory ?? {},
            autoEmailsSent: raw.autoEmailsSent ?? 0,
            autoEmailsAttempted: raw.autoEmailsAttempted ?? 0
        };
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(kpis);
    } catch (error) {
        console.error('Dashboard KPIs error:', error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'Failed to load dashboard KPIs'
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__5e78ac9e._.js.map