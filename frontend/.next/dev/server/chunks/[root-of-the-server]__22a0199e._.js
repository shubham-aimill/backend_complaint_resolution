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
"[project]/lib/normalizeClaim.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Normalize backend complaint response to frontend claim shape.
 *
 * Key renames handled here:
 *   complaintId           → claimId
 *   ingestedComplaintId   → ingestedClaimId
 *   decisionPack.complaintDraft     → decisionPack.claimDraft
 *   decisionPack.customerGrounding  → decisionPack.policyGrounding
 *   decisionPack.customerInfo       → decisionPack.policyHolderInfo
 *   decisionPack.resolutionAssessment → decisionPack.policyAssessment
 *     └─ recordsFound     → clausesFound
 *     └─ customerVerified → coverageConfirmed
 *     └─ topMatchScore    → topSimilarityScore
 *   decisionPack.audit    → top-level auditTrail
 *   processingMetrics     → filled with defaults for insurance-era fields
 *   processingSummary     → filled with defaults for missing fields
 */ __turbopack_context__.s([
    "getClaimDraft",
    ()=>getClaimDraft,
    "normalizeClaimResponse",
    ()=>normalizeClaimResponse
]);
function mapComplaintDraftToClaimDraft(complaintDraft) {
    if (!complaintDraft || typeof complaintDraft !== 'object') return {};
    return {
        ...complaintDraft,
        policyNumber: complaintDraft.policyNumber ?? complaintDraft.complaintRef,
        policyId: complaintDraft.policyId ?? complaintDraft.complaintRef,
        claimantName: complaintDraft.claimantName ?? complaintDraft.customerName,
        contactEmail: complaintDraft.contactEmail ?? complaintDraft.customerEmail,
        lossDate: complaintDraft.lossDate ?? complaintDraft.complaintDate,
        lossType: complaintDraft.lossType ?? complaintDraft.complaintType,
        lossLocation: complaintDraft.lossLocation ?? complaintDraft.location ?? complaintDraft.propertyAddress ?? complaintDraft.productOrService,
        location: complaintDraft.location ?? complaintDraft.lossLocation ?? complaintDraft.propertyAddress ?? complaintDraft.productOrService,
        propertyAddress: complaintDraft.propertyAddress ?? complaintDraft.productOrService
    };
}
/**
 * Map resolutionAssessment (backend) → policyAssessment (frontend).
 * Sub-fields are renamed to match the frontend DecisionPack type.
 */ function mapResolutionAssessment(ra) {
    if (!ra || typeof ra !== 'object') return null;
    return {
        ...ra,
        clausesFound: ra.clausesFound ?? ra.recordsFound ?? 0,
        coverageConfirmed: ra.coverageConfirmed ?? ra.customerVerified ?? false,
        topSimilarityScore: ra.topSimilarityScore ?? ra.topMatchScore ?? 0,
        recommendedActions: ra.recommendedActions ?? []
    };
}
/**
 * Map customerInfo (backend) → policyHolderInfo (frontend).
 * Adds aliases for insurance-era fields the frontend type still references.
 */ function mapCustomerInfo(ci) {
    if (!ci || typeof ci !== 'object') return null;
    return {
        ...ci,
        // Electronics backend sends customer_status; frontend also checks policy_status
        policy_status: ci.policy_status ?? ci.customer_status,
        // complaint_ref acts as policy_number
        policy_number: ci.policy_number ?? ci.complaint_ref ?? ci.customer_id
    };
}
function normalizeClaimResponse(data) {
    if (!data || typeof data !== 'object') return data;
    // ── Top-level key renames ────────────────────────────────────────────────
    const claimId = data.claimId ?? data.complaintId;
    const ingestedClaimId = data.ingestedClaimId ?? data.ingestedComplaintId;
    // Email threading — propagated from the original ingested complaint
    const messageId = data.messageId;
    const threadId = data.threadId;
    // ── DecisionPack normalization ───────────────────────────────────────────
    const dp = data.decisionPack;
    if (!dp) {
        return {
            ...data,
            claimId,
            ingestedClaimId
        };
    }
    // claimDraft ← complaintDraft
    const complaintDraft = dp.complaintDraft;
    const existingClaimDraft = dp.claimDraft;
    const claimDraft = existingClaimDraft && Object.keys(existingClaimDraft).length > 0 ? {
        ...existingClaimDraft,
        ...mapComplaintDraftToClaimDraft(complaintDraft)
    } : mapComplaintDraftToClaimDraft(complaintDraft);
    // policyGrounding ← customerGrounding
    const policyGrounding = dp.policyGrounding ?? dp.customerGrounding ?? [];
    // policyHolderInfo ← customerInfo
    const policyHolderInfo = dp.policyHolderInfo != null ? mapCustomerInfo(dp.policyHolderInfo) : mapCustomerInfo(dp.customerInfo);
    // policyAssessment ← resolutionAssessment
    const policyAssessment = dp.policyAssessment != null ? mapResolutionAssessment(dp.policyAssessment) : mapResolutionAssessment(dp.resolutionAssessment);
    // processingSummary — fill defaults for missing fields
    const ps = dp.processingSummary;
    const processingSummary = ps ? {
        totalTime: ps.totalTime ?? ps.stepsCompleted ?? 0,
        stepsCompleted: ps.stepsCompleted ?? 0,
        stepsWithErrors: ps.stepsWithErrors ?? 0,
        automationLevel: ps.automationLevel ?? 1,
        ...ps
    } : undefined;
    // ── auditTrail at top level ← decisionPack.audit ────────────────────────
    const auditTrail = data.auditTrail ?? dp.audit ?? [];
    // ── processingMetrics — fill defaults for insurance-era fields ──────────
    const pm = data.processingMetrics;
    const processingMetrics = {
        totalProcessingTime: pm?.totalProcessingTime ?? 0,
        averageHandleTime: pm?.averageHandleTime ?? 0,
        fieldsAutoPopulated: pm?.fieldsAutoPopulated ?? 0,
        overrideRate: pm?.overrideRate ?? 0,
        ragHitRate: pm?.ragHitRate ?? 0,
        stepsCompleted: pm?.stepsCompleted ?? 0,
        stepsFailed: pm?.stepsFailed ?? 0,
        successRate: pm?.successRate ?? 1,
        ...pm ?? {}
    };
    return {
        ...data,
        claimId,
        ingestedClaimId,
        messageId,
        threadId,
        auditTrail,
        processingMetrics,
        decisionPack: {
            ...dp,
            claimDraft: Object.keys(claimDraft).length ? claimDraft : dp.claimDraft ?? complaintDraft ?? {},
            policyGrounding,
            policyHolderInfo,
            policyAssessment,
            processingSummary
        }
    };
}
function getClaimDraft(decisionPack) {
    if (!decisionPack) return {};
    const raw = decisionPack.claimDraft ?? decisionPack.complaintDraft;
    if (!raw) return {};
    return mapComplaintDraftToClaimDraft(raw);
}
}),
"[project]/app/api/process-claim/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POST",
    ()=>POST
]);
/**
 * POST /api/process-claim
 * Proxies to FastAPI backend server and normalizes complaintDraft -> claimDraft for frontend.
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2d$config$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/api-config.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$normalizeClaim$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/normalizeClaim.ts [app-route] (ecmascript)");
;
;
;
async function POST(request) {
    try {
        const body = await request.json();
        const { ingestedClaimId } = body;
        if (!ingestedClaimId) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: 'ingestedClaimId is required'
            }, {
                status: 400
            });
        }
        // Proxy to FastAPI server (backend uses process-complaint + ingestedComplaintId)
        const response = await fetch((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$api$2d$config$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getApiUrl"])('api/process-complaint'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ingestedComplaintId: ingestedClaimId
            })
        });
        const data = await response.json();
        if (!response.ok) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: data.detail || data.error || 'Processing failed'
            }, {
                status: response.status
            });
        }
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$normalizeClaim$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["normalizeClaimResponse"])(data));
    } catch (error) {
        console.error('Process claim error:', error);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'Claim processing failed',
            details: String(error)
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__22a0199e._.js.map