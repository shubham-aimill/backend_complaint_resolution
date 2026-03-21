'use client'

import { useState, useEffect } from 'react'
import {
  Clock,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  RefreshCw,
  Download,
  FileText,
  Shield,
  BarChart3,
  PieChart as PieChartIcon,
} from 'lucide-react'
import { ClaimData } from '@/types/claims'
import { CONFIDENCE } from '@/lib/confidence'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'

interface DashboardKpis {
  totalClaims: number
  claimsThisWeek: number
  claimsThisMonth: number
  claimsByLossType: Record<string, number>
  coverageMatchRate: number
  avgConfidence: number
  totalDocumentsProcessed: number
  claimsByDate: Array<{ date: string; count: number }>
  recentClaims: Array<{
    claimId: string
    policyNumber?: string
    claimantName?: string
    lossType: string
    createdAt: string
    policyMatches: number
  }>
  complaintsByDecision: Record<string, number>
  warrantyStatusCounts: Record<string, number>
  complaintsByCategory: Record<string, number>
  autoEmailsSent?: number
  autoEmailsAttempted?: number
}

interface DashboardPageProps {
  claimData: ClaimData | null
  onReset: () => void
}

const LOSS_TYPE_COLORS: Record<string, string> = {
  Collision: '#991B1B',
  Water: '#0EA5E9',
  Fire: '#F59E0B',
  Theft: '#8B5CF6',
  Liability: '#10B981',
  Other: '#64748B',
  AutoCollision: '#3B82F6',
  PropertyDamage: '#06B6D4',
}

const DECISION_COLORS: Record<string, string> = {
  APPROVE_REPAIR: '#10B981',
  APPROVE_REPLACEMENT: '#059669',
  DESK_REJECT: '#DC2626',
  ESCALATE: '#F59E0B',
  PENDING_REVIEW: '#8B5CF6',
  UNKNOWN: '#94A3B8',
}

const WARRANTY_COLORS: Record<string, string> = {
  WITHIN_WARRANTY: '#10B981',
  OUT_OF_WARRANTY: '#F59E0B',
  UNKNOWN: '#94A3B8',
}

export default function DashboardPage({ claimData, onReset }: DashboardPageProps) {
  const [kpis, setKpis] = useState<DashboardKpis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchKpis() {
      try {
        const res = await fetch('/api/dashboard/kpis')
        if (res.ok) {
          const data = await res.json()
          setKpis(data)
        } else {
          setKpis(null)
        }
      } catch (err) {
        setError('Failed to load dashboard data')
        setKpis(null)
      } finally {
        setLoading(false)
      }
    }
    fetchKpis()
  }, [claimData?.claimId])

  const hasClaimData = !!claimData?.decisionPack
  const decisionPack = claimData?.decisionPack
  const processingTime = claimData?.processingTime ?? 0
  const evidence = decisionPack?.evidence ?? []
  const documents = decisionPack?.documents ?? []
  const policyGrounding = decisionPack?.policyGrounding ?? []
  const evidenceSummary = decisionPack?.evidenceSummary

  const totalFields = evidence.length || 1
  const autoPopulatedFields = evidenceSummary?.highConfidenceFields ?? evidence.filter((e) => e.confidence >= CONFIDENCE.THRESHOLD_HIGH).length
  const autoPopPct = Math.round((autoPopulatedFields / totalFields) * 100) || 0

  // Compute coverage match rate from recent claims data (% with at least 1 policy match)
  const coverageRate = (() => {
    if (kpis?.recentClaims && kpis.recentClaims.length > 0) {
      const matched = kpis.recentClaims.filter(c => ((c.policyMatches as number) ?? 0) > 0).length
      return Math.round((matched / kpis.recentClaims.length) * 100)
    }
    return kpis?.coverageMatchRate ?? 0
  })()

  const lossTypeChartData = kpis?.claimsByLossType
    ? Object.entries(kpis.claimsByLossType).map(([name, value]) => ({
        name,
        value,
        color: LOSS_TYPE_COLORS[name] || '#94A3B8',
      }))
    : []

  const decisionChartData = (kpis?.complaintsByDecision && Object.keys(kpis.complaintsByDecision).length > 0)
    ? Object.entries(kpis.complaintsByDecision).map(([name, value]) => ({
        name: name.replace(/_/g, ' '),
        value,
        color: DECISION_COLORS[name] || '#64748B',
      }))
    : []
  const warrantyChartData = (kpis?.warrantyStatusCounts && Object.keys(kpis.warrantyStatusCounts).length > 0)
    ? Object.entries(kpis.warrantyStatusCounts).map(([name, value]) => ({
        name: name.replace(/_/g, ' '),
        value,
        color: WARRANTY_COLORS[name] || '#94A3B8',
      }))
    : []
  const categoryChartData = (kpis?.complaintsByCategory && Object.keys(kpis.complaintsByCategory).length > 0)
    ? Object.entries(kpis.complaintsByCategory).map(([name, value]) => ({
        name,
        value,
        color: LOSS_TYPE_COLORS[name] || '#94A3B8',
      }))
    : []

  let confidenceData = [
    {
      name: `High (≥${Math.round(CONFIDENCE.THRESHOLD_HIGH * 100)}%)`,
      value: evidence.filter((e) => e.confidence >= CONFIDENCE.THRESHOLD_HIGH).length,
      color: '#10B981',
    },
    {
      name: 'Medium',
      value: evidence.filter((e) => e.confidence >= CONFIDENCE.THRESHOLD_MEDIUM && e.confidence < CONFIDENCE.THRESHOLD_HIGH).length,
      color: '#F59E0B',
    },
    {
      name: `Low (<${Math.round(CONFIDENCE.THRESHOLD_MEDIUM * 100)}%)`,
      value: evidence.filter((e) => e.confidence < CONFIDENCE.THRESHOLD_MEDIUM).length,
      color: '#EF4444',
    },
  ].filter((d) => d.value > 0)

  if (confidenceData.length === 0 && evidence.length > 0) {
    confidenceData = [{ name: 'Extracted', value: evidence.length, color: '#991B1B' }]
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Operations Dashboard
          </h1>
          <p className="text-sm text-[#64748B] mt-1">
            Real-time performance and complaint metrics
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!hasClaimData && (
            <p className="text-sm text-[#64748B] hidden sm:block">
              Viewing global metrics. Process or load a complaint to see current-complaint details.
            </p>
          )}
          <button
            onClick={onReset}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#475569] bg-white border border-[#E2E8F0] rounded-lg hover:bg-[#F8FAFC] hover:border-[#CBD5E1] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {hasClaimData ? 'Process New Complaint' : 'Process Complaint'}
          </button>
          <a
            href="/api/claims/export"
            download="complaints-export.csv"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#991B1B] rounded-lg hover:bg-[#7F1D1D] transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </a>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-10 h-10 border-2 border-[#991B1B] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[#FEE2E2] bg-[#FEF2F2] p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-[#DC2626] mx-auto mb-2" />
          <p className="text-sm text-[#991B1B]">{error}</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2.5 bg-[#EFF6FF] rounded-lg">
                  <FileText className="w-5 h-5 text-[#991B1B]" />
                </div>
              </div>
              <p className="text-xs font-medium text-[#64748B] uppercase tracking-wider mb-1">
                Total Complaints Processed
              </p>
              <p className="text-2xl font-bold text-[#0F172A]">
                {kpis?.totalClaims ?? 0}
              </p>
              <p className="text-xs text-[#64748B] mt-2">
                {kpis?.claimsThisWeek ?? 0} this week · {kpis?.claimsThisMonth ?? 0} this month
              </p>
            </div>

            <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2.5 bg-[#F5F3FF] rounded-lg">
                  <TrendingUp className="w-5 h-5 text-[#B91C1C]" />
                </div>
              </div>
              <p className="text-xs font-medium text-[#64748B] uppercase tracking-wider mb-1">
                Avg Extraction Confidence
              </p>
              <p className="text-2xl font-bold text-[#0F172A]">
                {kpis?.avgConfidence ?? evidence.length
                  ? Math.round(
                      (evidence.reduce((s, e) => s + (e.confidence || 0), 0) / evidence.length) * 100
                    )
                  : 0}
                %
              </p>
              <p className="text-xs text-[#64748B] mt-2">
                Across all processed complaints
              </p>
            </div>

            <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2.5 bg-[#FFF7ED] rounded-lg">
                  <Clock className="w-5 h-5 text-[#EA580C]" />
                </div>
              </div>
              <p className="text-xs font-medium text-[#64748B] uppercase tracking-wider mb-1">
                Documents Processed
              </p>
              <p className="text-2xl font-bold text-[#0F172A]">
                {kpis?.totalDocumentsProcessed ?? documents.length}
              </p>
              <p className="text-xs text-[#64748B] mt-2">
                Attachments and evidence
              </p>
            </div>

            <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="p-2.5 bg-[#ECFDF5] rounded-lg">
                  <Shield className="w-5 h-5 text-[#059669]" />
                </div>
              </div>
              <p className="text-xs font-medium text-[#64748B] uppercase tracking-wider mb-1">
                Complaint Coverage Match
              </p>
              <p className="text-2xl font-bold text-[#0F172A]">
                {coverageRate}%
              </p>
              <p className="text-xs text-[#64748B] mt-2">
                Complaints with complaint clause matches
              </p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid lg:grid-cols-2 gap-6 mb-10">
            {/* Complaints Over Time */}
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-6 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#64748B]" />
                Complaints Processed Over Time
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                {kpis?.claimsByDate && kpis.claimsByDate.length > 0 ? (
                  <BarChart
                    data={kpis.claimsByDate.map((d) => ({
                      ...d,
                      shortDate: d.date.slice(5),
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                    <XAxis
                      dataKey="shortDate"
                      stroke="#94A3B8"
                      tick={{ fill: '#64748B', fontSize: 11 }}
                      axisLine={{ stroke: '#E2E8F0' }}
                    />
                    <YAxis
                      stroke="#94A3B8"
                      tick={{ fill: '#64748B', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#FFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      formatter={(value: number) => [value, 'Complaints']}
                    />
                    <Bar dataKey="count" fill="#991B1B" radius={[4, 4, 0, 0]} name="Complaints" />
                  </BarChart>
                ) : (
                  <div className="flex items-center justify-center h-full text-[#94A3B8] text-sm">
                    No complaints data yet. Process complaints to see trends.
                  </div>
                )}
              </ResponsiveContainer>
            </div>

            {/* Complaints by Category */}
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-6 flex items-center gap-2">
                <PieChartIcon className="w-4 h-4 text-[#64748B]" />
                Complaints by Category
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                {lossTypeChartData.length > 0 ? (
                  <PieChart>
                    <Pie
                      data={lossTypeChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) =>
                        `${name} ${(percent * 100).toFixed(0)}%`
                      }
                    >
                      {lossTypeChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#FFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                    />
                  </PieChart>
                ) : (
                  <div className="flex items-center justify-center h-full text-[#94A3B8] text-sm">
                    No loss type distribution yet.
                  </div>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* Row: By Decision, Warranty, Product Category */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-3 shadow-sm">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-2 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#64748B]" />
                By Decision
              </h3>
              <div className="w-full overflow-visible" style={{ height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  {decisionChartData.length > 0 ? (
                    <PieChart margin={{ top: 30, right: 40, bottom: 30, left: 40 }}>
                      <Pie
                        data={decisionChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={60}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, value, cx, cy, midAngle, innerRadius, outerRadius }) => {
                          const RADIAN = Math.PI / 180;
                          const radius = outerRadius + 35;
                          const x = cx + radius * Math.cos(-midAngle * RADIAN);
                          const y = cy + radius * Math.sin(-midAngle * RADIAN);
                          return (
                            <text
                              x={x}
                              y={y}
                              fill="#374151"
                              textAnchor={x > cx ? 'start' : 'end'}
                              dominantBaseline="central"
                              fontSize="10px"
                              fontWeight="600"
                            >
                              {`${name}: ${value}`}
                            </text>
                          );
                        }}
                        labelLine={{
                          stroke: '#94A3B8',
                          strokeWidth: 1,
                        }}
                      >
                        {decisionChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#FFF',
                          border: '1px solid #E2E8F0',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                    </PieChart>
                  ) : (
                    <div className="flex items-center justify-center h-full text-[#94A3B8] text-sm">
                      No decision data yet.
                    </div>
                  )}
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-3 shadow-sm">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-2 flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#64748B]" />
                Warranty Status
              </h3>
              <div className="w-full overflow-visible" style={{ height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  {warrantyChartData.length > 0 ? (
                    <PieChart margin={{ top: 30, right: 40, bottom: 30, left: 40 }}>
                      <Pie
                        data={warrantyChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={60}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, value, cx, cy, midAngle, innerRadius, outerRadius }) => {
                          const RADIAN = Math.PI / 180;
                          const radius = outerRadius + 35;
                          const x = cx + radius * Math.cos(-midAngle * RADIAN);
                          const y = cy + radius * Math.sin(-midAngle * RADIAN);
                          return (
                            <text
                              x={x}
                              y={y}
                              fill="#374151"
                              textAnchor={x > cx ? 'start' : 'end'}
                              dominantBaseline="central"
                              fontSize="10px"
                              fontWeight="600"
                            >
                              {`${name}: ${value}`}
                            </text>
                          );
                        }}
                        labelLine={{
                          stroke: '#94A3B8',
                          strokeWidth: 1,
                        }}
                      >
                        {warrantyChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#FFF',
                          border: '1px solid #E2E8F0',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                    </PieChart>
                  ) : (
                    <div className="flex items-center justify-center h-full text-[#94A3B8] text-sm">
                      No warranty data yet.
                    </div>
                  )}
                </ResponsiveContainer>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-3 shadow-sm">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-2 flex items-center gap-2">
                <PieChartIcon className="w-4 h-4 text-[#64748B]" />
                Product Category
              </h3>
              <div className="w-full overflow-visible" style={{ height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  {categoryChartData.length > 0 ? (
                    <PieChart margin={{ top: 30, right: 40, bottom: 30, left: 40 }}>
                      <Pie
                        data={categoryChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={60}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, value, cx, cy, midAngle, innerRadius, outerRadius }) => {
                          const RADIAN = Math.PI / 180;
                          const radius = outerRadius + 35;
                          const x = cx + radius * Math.cos(-midAngle * RADIAN);
                          const y = cy + radius * Math.sin(-midAngle * RADIAN);
                          return (
                            <text
                              x={x}
                              y={y}
                              fill="#374151"
                              textAnchor={x > cx ? 'start' : 'end'}
                              dominantBaseline="central"
                              fontSize="10px"
                              fontWeight="600"
                            >
                              {`${name}: ${value}`}
                            </text>
                          );
                        }}
                        labelLine={{
                          stroke: '#94A3B8',
                          strokeWidth: 1,
                        }}
                      >
                        {categoryChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#FFF',
                          border: '1px solid #E2E8F0',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                    </PieChart>
                  ) : (
                    <div className="flex items-center justify-center h-full text-[#94A3B8] text-sm">
                      No category data yet.
                    </div>
                  )}
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Bottom Section: Current Complaint + Recent + Confidence */}
          <div className="grid lg:grid-cols-3 gap-6 mb-10">
            {/* Current Complaint Metrics — only when a complaint is loaded */}
            {hasClaimData && (
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-4 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-[#059669]" />
                Current Complaint
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b border-[#F1F5F9]">
                  <span className="text-sm text-[#64748B]">Processing Time</span>
                  <span className="text-sm font-semibold text-[#0F172A]">
                    {((processingTime || 0) / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-[#F1F5F9]">
                  <span className="text-sm text-[#64748B]">Fields Extracted</span>
                  <span className="text-sm font-semibold text-[#0F172A]">{evidence.length}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-[#F1F5F9]">
                  <span className="text-sm text-[#64748B]">High Confidence</span>
                  <span className="text-sm font-semibold text-[#0F172A]">
                    {autoPopulatedFields} ({autoPopPct}%)
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-[#F1F5F9]">
                  <span className="text-sm text-[#64748B]">Policy Clause Matches</span>
                  <span className="text-sm font-semibold text-[#0F172A]">
                    {policyGrounding.length}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3">
                  <span className="text-sm text-[#64748B]">Documents</span>
                  <span className="text-sm font-semibold text-[#0F172A]">{documents.length}</span>
                </div>
              </div>
            </div>
            )}

            {/* Field Confidence Distribution — only when a complaint is loaded */}
            {hasClaimData && (
            <div className="bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-[#0F172A] mb-4">
                Field Confidence (Current Complaint)
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                {confidenceData.length > 0 ? (
                  <PieChart>
                    <Pie
                      data={confidenceData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {confidenceData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend
                      wrapperStyle={{ fontSize: '11px' }}
                      iconType="circle"
                      iconSize={8}
                    />
                  </PieChart>
                ) : (
                  <div className="flex items-center justify-center h-full text-[#94A3B8] text-sm">
                    No evidence data
                  </div>
                )}
              </ResponsiveContainer>
            </div>
            )}

            {/* Recent Complaints */}
            <div className={`bg-white rounded-xl border border-[#E2E8F0] p-6 shadow-sm ${!hasClaimData ? 'lg:col-span-2' : ''}`}>
              <h3 className="text-sm font-semibold text-[#0F172A] mb-4">Recent Complaints</h3>
              {kpis?.recentClaims && kpis.recentClaims.length > 0 ? (
                <div className="space-y-3">
                  {kpis.recentClaims.slice(0, 5).map((c, i) => (
                    <div
                      key={c.claimId || i}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-[#F8FAFC] hover:bg-[#F1F5F9] transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#0F172A] truncate">
                          {c.claimantName || c.policyNumber || c.claimId}
                        </p>
                        <p className="text-xs text-[#64748B]">
                          {c.lossType} · {c.policyMatches} policy clause match{c.policyMatches !== 1 ? 'es' : ''}
                        </p>
                      </div>
                      <span className="text-xs text-[#94A3B8] flex-shrink-0 ml-2">
                        {c.createdAt?.slice(0, 10)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-12 text-[#94A3B8] text-sm">
                  No recent complaints
                </div>
              )}
            </div>
          </div>

          {/* Governance */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-8 shadow-sm">
            <h3 className="text-sm font-semibold text-[#0F172A] mb-6">Governance & Compliance</h3>
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h4 className="text-xs font-medium text-[#64748B] uppercase tracking-wider mb-3">
                  Human-in-the-Loop
                </h4>
                <ul className="text-sm text-[#475569] space-y-2">
                  <li>• No automatic complaint denials</li>
                  <li>• Fields below {Math.round(CONFIDENCE.THRESHOLD_MEDIUM * 100)}% confidence require review</li>
                  <li>• Policy clause matches require verification</li>
                  <li>• All decisions logged with audit trail</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-medium text-[#64748B] uppercase tracking-wider mb-3">
                  Explainability
                </h4>
                <ul className="text-sm text-[#475569] space-y-2">
                  <li>• Every extracted field has evidence source</li>
                  <li>• Policy clauses include similarity scores</li>
                  <li>• Complete audit trail maintained</li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
