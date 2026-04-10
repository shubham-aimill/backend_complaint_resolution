(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/lib/clientCache.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getCached",
    ()=>getCached,
    "removeCached",
    ()=>removeCached,
    "removeCachedByPrefix",
    ()=>removeCachedByPrefix,
    "setCached",
    ()=>setCached
]);
const memoryCache = new Map();
function safeNow() {
    return Date.now();
}
function readFromStorage(key) {
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch  {
        return null;
    }
}
function writeToStorage(key, envelope) {
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    try {
        window.localStorage.setItem(key, JSON.stringify(envelope));
    } catch  {
    // Best-effort cache only
    }
}
function getCached(key) {
    const now = safeNow();
    const fromMemory = memoryCache.get(key);
    if (fromMemory) {
        if (fromMemory.expiresAt > now) return fromMemory.value;
        memoryCache.delete(key);
    }
    const fromStorage = readFromStorage(key);
    if (!fromStorage) return null;
    if (fromStorage.expiresAt <= now) {
        removeCached(key);
        return null;
    }
    memoryCache.set(key, fromStorage);
    return fromStorage.value;
}
function setCached(key, value, ttlMs) {
    const envelope = {
        value,
        expiresAt: safeNow() + ttlMs
    };
    memoryCache.set(key, envelope);
    writeToStorage(key, envelope);
}
function removeCached(key) {
    memoryCache.delete(key);
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    try {
        window.localStorage.removeItem(key);
    } catch  {
    // Best-effort cache only
    }
}
function removeCachedByPrefix(prefix) {
    for (const key of Array.from(memoryCache.keys())){
        if (key.startsWith(prefix)) memoryCache.delete(key);
    }
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    try {
        for(let i = window.localStorage.length - 1; i >= 0; i--){
            const key = window.localStorage.key(i);
            if (key && key.startsWith(prefix)) window.localStorage.removeItem(key);
        }
    } catch  {
    // Best-effort cache only
    }
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/confidence.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Confidence score thresholds used across the application.
 * All displayed confidence values should be real-time (from extraction), not static.
 */ __turbopack_context__.s([
    "CONFIDENCE",
    ()=>CONFIDENCE,
    "isHighConfidence",
    ()=>isHighConfidence,
    "isLowConfidence",
    ()=>isLowConfidence,
    "isMediumConfidence",
    ()=>isMediumConfidence
]);
const CONFIDENCE = {
    /** High: auto-approve / trusted */ THRESHOLD_HIGH: 0.8,
    /** Medium: proceed with normal review */ THRESHOLD_MEDIUM: 0.6,
    /** Low: requires manual review */ THRESHOLD_LOW: 0
};
function isHighConfidence(c) {
    return c >= CONFIDENCE.THRESHOLD_HIGH;
}
function isMediumConfidence(c) {
    return c >= CONFIDENCE.THRESHOLD_MEDIUM && c < CONFIDENCE.THRESHOLD_HIGH;
}
function isLowConfidence(c) {
    return c < CONFIDENCE.THRESHOLD_MEDIUM;
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/normalizeClaim.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
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
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/hooks/useMailChain.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useMailChain",
    ()=>useMailChain
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
'use client';
;
function useMailChain(ingestedId) {
    _s();
    const [chain, setChain] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])([]);
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const fetch = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useMailChain.useCallback[fetch]": async ()=>{
            if (!ingestedId) return;
            setLoading(true);
            try {
                const res = await window.fetch(`/api/ingested-claims/${encodeURIComponent(ingestedId)}/thread`);
                if (res.ok) {
                    const data = await res.json();
                    setChain(Array.isArray(data) ? data : data.thread ?? []);
                }
            } catch  {
            // silently fail — UI shows empty state
            } finally{
                setLoading(false);
            }
        }
    }["useMailChain.useCallback[fetch]"], [
        ingestedId
    ]);
    return {
        chain,
        loading,
        fetch
    };
}
_s(useMailChain, "m7rcoFUWBDEcb6DEHAK3HVKC8AI=");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/hooks/useComplaintDecision.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useComplaintDecision",
    ()=>useComplaintDecision
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
'use client';
;
function useComplaintDecision(claimData, ingestedId) {
    _s();
    const [status, setStatus] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])('pending');
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [error, setError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const decide = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useComplaintDecision.useCallback[decide]": async (params)=>{
            setLoading(true);
            setError(null);
            try {
                // 1. Send the letter email to the complainant (as a reply in the original thread)
                if (params.recipient) {
                    const emailRes = await fetch('/api/send-email', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            to: params.recipient,
                            subject: params.subject,
                            body: params.letter,
                            inReplyTo: params.inReplyTo,
                            references: params.references
                        })
                    });
                    if (!emailRes.ok) {
                        const d = await emailRes.json().catch({
                            "useComplaintDecision.useCallback[decide]": ()=>({})
                        }["useComplaintDecision.useCallback[decide]"]);
                        throw new Error(d.error || 'Failed to send email');
                    }
                }
                // 2. Append letter to mail thread
                if (ingestedId) {
                    await fetch(`/api/ingested-claims/${encodeURIComponent(ingestedId)}/thread`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            from: 'Customer Support <support@electronics.com>',
                            subject: params.subject,
                            emailBody: params.letter,
                            direction: 'outbound'
                        })
                    });
                }
                // 3. Update complaint status in backend
                const complaintId = claimData?.claimId;
                if (complaintId) {
                    await fetch(`/api/complaints/${encodeURIComponent(complaintId)}/status`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            status: params.decision === 'accept' ? 'accepted' : 'rejected'
                        })
                    });
                }
                setStatus(params.decision === 'accept' ? 'accepted' : 'rejected');
                return true;
            } catch (err) {
                setError(err instanceof Error ? err.message : 'An error occurred');
                return false;
            } finally{
                setLoading(false);
            }
        }
    }["useComplaintDecision.useCallback[decide]"], [
        claimData?.claimId,
        ingestedId
    ]);
    const reset = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useComplaintDecision.useCallback[reset]": ()=>{
            setStatus('pending');
            setError(null);
        }
    }["useComplaintDecision.useCallback[reset]"], []);
    return {
        status,
        loading,
        error,
        decide,
        reset
    };
}
_s(useComplaintDecision, "MU4ttj/ZxxLMEMEMgPDLedtxL1o=");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/hooks/useAppointment.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useAppointment",
    ()=>useAppointment
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
'use client';
;
function useAppointment() {
    _s();
    const [booked, setBooked] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [loading, setLoading] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [error, setError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [details, setDetails] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const book = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useAppointment.useCallback[book]": async (params)=>{
            setLoading(true);
            setError(null);
            try {
                const res = await fetch('/api/appointments', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(params)
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to book appointment');
                setDetails(data);
                setBooked(true);
                return true;
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to book appointment');
                return false;
            } finally{
                setLoading(false);
            }
        }
    }["useAppointment.useCallback[book]"], []);
    return {
        booked,
        loading,
        error,
        details,
        book
    };
}
_s(useAppointment, "yS119A8Oy0/c7P0jYq3nyrK4Mnc=");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/hooks/useEmailDraft.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "useEmailDraft",
    ()=>useEmailDraft
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
'use client';
;
function useEmailDraft() {
    _s();
    const [draft, setDraft] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [sent, setSent] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])({
        acknowledgment: false,
        moreInfo: false,
        acceptance: false,
        rejection: false
    });
    const [sending, setSending] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [error, setError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const open = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useEmailDraft.useCallback[open]": (type, body, recipient, subject, inReplyTo, references)=>{
            setDraft({
                type,
                body,
                recipient,
                subject,
                inReplyTo,
                references
            });
            setError(null);
        }
    }["useEmailDraft.useCallback[open]"], []);
    const close = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useEmailDraft.useCallback[close]": ()=>{
            setDraft(null);
            setError(null);
        }
    }["useEmailDraft.useCallback[close]"], []);
    const updateBody = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useEmailDraft.useCallback[updateBody]": (body)=>{
            setDraft({
                "useEmailDraft.useCallback[updateBody]": (prev)=>prev ? {
                        ...prev,
                        body
                    } : prev
            }["useEmailDraft.useCallback[updateBody]"]);
        }
    }["useEmailDraft.useCallback[updateBody]"], []);
    const updateRecipient = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useEmailDraft.useCallback[updateRecipient]": (recipient)=>{
            setDraft({
                "useEmailDraft.useCallback[updateRecipient]": (prev)=>prev ? {
                        ...prev,
                        recipient
                    } : prev
            }["useEmailDraft.useCallback[updateRecipient]"]);
        }
    }["useEmailDraft.useCallback[updateRecipient]"], []);
    const send = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useEmailDraft.useCallback[send]": async ()=>{
            if (!draft) return;
            setSending(true);
            setError(null);
            try {
                const res = await fetch('/api/send-email', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        to: draft.recipient,
                        subject: draft.subject,
                        body: draft.body,
                        inReplyTo: draft.inReplyTo,
                        references: draft.references
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to send email');
                setSent({
                    "useEmailDraft.useCallback[send]": (prev)=>({
                            ...prev,
                            [draft.type]: true
                        })
                }["useEmailDraft.useCallback[send]"]);
                setDraft(null);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to send email');
            } finally{
                setSending(false);
            }
        }
    }["useEmailDraft.useCallback[send]"], [
        draft
    ]);
    return {
        draft,
        sent,
        sending,
        error,
        open,
        close,
        send,
        updateBody,
        updateRecipient
    };
}
_s(useEmailDraft, "rzlLGI9xmP4kYULIcdrXjqIyYSc=");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/app/page.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>Home
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/navigation.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$components$2f$AnimatePresence$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/framer-motion/dist/es/components/AnimatePresence/index.mjs [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$render$2f$dom$2f$motion$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/framer-motion/dist/es/render/dom/motion.mjs [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$Header$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/Header.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$HomePage$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/HomePage.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ReviewPage$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/ReviewPage.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$DecisionPage$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/DecisionPage.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$DashboardPage$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/DashboardPage.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$FAQPage$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/FAQPage.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$auth$2f$AuthContext$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/auth/AuthContext.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$clientCache$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/clientCache.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
'use client';
;
;
;
;
;
;
;
;
;
;
;
function Home() {
    _s();
    const router = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRouter"])();
    const { isAuthenticated, loading } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$auth$2f$AuthContext$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useAuth"])();
    const [currentStage, setCurrentStage] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])('home');
    const [claimData, setClaimData] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [isProcessing, setIsProcessing] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    // Redirect to login if not authenticated
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "Home.useEffect": ()=>{
            if (!loading && !isAuthenticated) {
                router.push('/login');
            }
        }
    }["Home.useEffect"], [
        isAuthenticated,
        loading,
        router
    ]);
    // Show loading state while checking authentication
    if (loading) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "min-h-screen bg-white flex items-center justify-center",
            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "text-center",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "w-12 h-12 border-4 border-[#991B1B] border-t-transparent rounded-full animate-spin mx-auto mb-4"
                    }, void 0, false, {
                        fileName: "[project]/app/page.tsx",
                        lineNumber: 35,
                        columnNumber: 11
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        className: "text-[#64748B]",
                        children: "Loading..."
                    }, void 0, false, {
                        fileName: "[project]/app/page.tsx",
                        lineNumber: 36,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/app/page.tsx",
                lineNumber: 34,
                columnNumber: 9
            }, this)
        }, void 0, false, {
            fileName: "[project]/app/page.tsx",
            lineNumber: 33,
            columnNumber: 7
        }, this);
    }
    // Don't render main app if not authenticated
    if (!isAuthenticated) {
        return null;
    }
    const handleStageChange = (stage)=>{
        if ((stage === 'review' || stage === 'decision') && !claimData) return;
        if (stage === 'decision' && claimData?.autoDecision === 'DESK_REJECT') return;
        setCurrentStage(stage);
    };
    const handleClaimProcessed = (data)=>{
        setClaimData(data);
        setCurrentStage('review');
    };
    const handleLoadClaim = async (claimId)=>{
        const cacheKey = `cache:processed-claims:detail:${claimId}`;
        const ttlMs = 5 * 60 * 1000;
        const cached = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$clientCache$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getCached"])(cacheKey);
        if (cached) {
            setClaimData(cached);
        }
        try {
            const res = await fetch(`/api/claims/${encodeURIComponent(claimId)}`);
            if (res.ok) {
                const data = await res.json();
                setClaimData(data);
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$clientCache$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["setCached"])(cacheKey, data, ttlMs);
            }
        } catch (err) {
            console.error('Failed to load claim:', err);
        }
    };
    const renderCurrentStage = ()=>{
        switch(currentStage){
            case 'home':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$HomePage$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                    onProcessClaim: handleClaimProcessed,
                    isProcessing: isProcessing,
                    setIsProcessing: setIsProcessing
                }, void 0, false, {
                    fileName: "[project]/app/page.tsx",
                    lineNumber: 81,
                    columnNumber: 11
                }, this);
            case 'review':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "container mx-auto px-4 py-8",
                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$ReviewPage$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                        claimData: claimData,
                        onNextStage: ()=>setCurrentStage('decision'),
                        onPreviousStage: ()=>setCurrentStage('home'),
                        onLoadClaim: handleLoadClaim
                    }, void 0, false, {
                        fileName: "[project]/app/page.tsx",
                        lineNumber: 90,
                        columnNumber: 13
                    }, this)
                }, void 0, false, {
                    fileName: "[project]/app/page.tsx",
                    lineNumber: 89,
                    columnNumber: 11
                }, this);
            case 'decision':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "container mx-auto px-4 py-8",
                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$DecisionPage$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                        claimData: claimData,
                        onNextStage: ()=>setCurrentStage('dashboard'),
                        onPreviousStage: ()=>setCurrentStage('review'),
                        onLoadClaim: handleLoadClaim
                    }, void 0, false, {
                        fileName: "[project]/app/page.tsx",
                        lineNumber: 101,
                        columnNumber: 13
                    }, this)
                }, void 0, false, {
                    fileName: "[project]/app/page.tsx",
                    lineNumber: 100,
                    columnNumber: 11
                }, this);
            case 'dashboard':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: "container mx-auto px-4 py-8",
                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$DashboardPage$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                        claimData: claimData ?? null,
                        onReset: ()=>{
                            setCurrentStage('home');
                            setClaimData(null);
                        }
                    }, void 0, false, {
                        fileName: "[project]/app/page.tsx",
                        lineNumber: 112,
                        columnNumber: 13
                    }, this)
                }, void 0, false, {
                    fileName: "[project]/app/page.tsx",
                    lineNumber: 111,
                    columnNumber: 11
                }, this);
            case 'faq':
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$FAQPage$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                    fileName: "[project]/app/page.tsx",
                    lineNumber: 122,
                    columnNumber: 16
                }, this);
            default:
                return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$HomePage$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                    onProcessClaim: handleClaimProcessed,
                    isProcessing: isProcessing,
                    setIsProcessing: setIsProcessing
                }, void 0, false, {
                    fileName: "[project]/app/page.tsx",
                    lineNumber: 124,
                    columnNumber: 16
                }, this);
        }
    };
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "min-h-screen bg-[#F8FAFC] relative",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$Header$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                currentStage: currentStage,
                onStageChange: handleStageChange,
                claimData: claimData
            }, void 0, false, {
                fileName: "[project]/app/page.tsx",
                lineNumber: 130,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("main", {
                className: "relative z-10",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$components$2f$AnimatePresence$2f$index$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["AnimatePresence"], {
                    mode: "wait",
                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$framer$2d$motion$2f$dist$2f$es$2f$render$2f$dom$2f$motion$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["motion"].div, {
                        initial: {
                            opacity: 0,
                            y: 12,
                            scale: 0.98
                        },
                        animate: {
                            opacity: 1,
                            y: 0,
                            scale: 1
                        },
                        exit: {
                            opacity: 0,
                            y: -6,
                            scale: 0.99
                        },
                        transition: {
                            duration: 0.2,
                            ease: 'easeOut'
                        },
                        children: renderCurrentStage()
                    }, currentStage, false, {
                        fileName: "[project]/app/page.tsx",
                        lineNumber: 133,
                        columnNumber: 11
                    }, this)
                }, void 0, false, {
                    fileName: "[project]/app/page.tsx",
                    lineNumber: 132,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/app/page.tsx",
                lineNumber: 131,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/app/page.tsx",
        lineNumber: 129,
        columnNumber: 5
    }, this);
}
_s(Home, "uJeZp/99Gn2mDB2IyMOFpFURHhc=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$navigation$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRouter"],
        __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$auth$2f$AuthContext$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useAuth"]
    ];
});
_c = Home;
var _c;
__turbopack_context__.k.register(_c, "Home");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=_71077f3d._.js.map