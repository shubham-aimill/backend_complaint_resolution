'use client'

import React, { useState } from 'react'
import { ProcessingStage, ClaimData } from '@/types/claims'
import { motion } from 'framer-motion'
import { Inbox, ScanSearch, GitMerge, LayoutDashboard, LogOut, Check, Ban, MessageCircle } from 'lucide-react'
import ConfigModal from './ConfigModal'
import { useAuth } from '@/lib/auth/AuthContext'

interface HeaderProps {
  currentStage: ProcessingStage
  onStageChange: (stage: ProcessingStage) => void
  claimData?: ClaimData | null
}

// FAQ is a standalone module (first in nav), not part of the sequential workflow.
// Workflow steps are: home → review → decision → dashboard
const workflowStages = [
  { id: 'home',      label: 'Inbox',      sub: 'Ingest & select',    icon: Inbox },
  { id: 'review',    label: 'Review',     sub: 'Extract & validate', icon: ScanSearch },
  { id: 'decision',  label: 'Resolution', sub: 'Decide & respond',   icon: GitMerge },
  { id: 'dashboard', label: 'Dashboard',  sub: 'KPIs & metrics',     icon: LayoutDashboard },
] as const

const WORKFLOW_ORDER: ProcessingStage[] = ['home', 'review', 'decision', 'dashboard']

export default function Header({ currentStage, onStageChange, claimData }: HeaderProps) {
  const [showConfig, setShowConfig] = useState(false)
  const { user, logout } = useAuth()

  const isFaqActive = currentStage === 'faq'
  const workflowIdx = WORKFLOW_ORDER.indexOf(currentStage as typeof WORKFLOW_ORDER[number])
  const isDeskReject = claimData?.autoDecision === 'DESK_REJECT'

  return (
    <>
      <header className="bg-white border-b border-[#E5E7EB] sticky top-0 z-50 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-6">
          <div className="flex items-center justify-between h-[68px] gap-4">

            {/* Logo */}
            <div className="flex items-center gap-3 min-w-fit">
              <img src="/image.png" alt="Logo" className="h-8 w-auto object-contain" />
              <div className="hidden sm:block">
                <p className="text-[14px] font-bold text-[#111827] leading-none tracking-tight">Complaint Resolution Portal</p>
                <p className="text-[10px] text-[#9CA3AF] leading-none mt-0.5 font-medium">By AI Mill</p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex items-center gap-1 flex-1 justify-center">

              {/* FAQ Auto Resolution — standalone module tab */}
              <button
                onClick={() => onStageChange('faq')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-left transition-all
                  ${isFaqActive
                    ? 'bg-[#991B1B] text-white shadow-sm'
                    : 'text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#374151]'}
                `}
              >
                <MessageCircle className={`w-4 h-4 flex-shrink-0 ${isFaqActive ? 'text-white' : 'text-[#9CA3AF]'}`} strokeWidth={2} />
                <div className="hidden lg:block">
                  <p className={`text-[12px] font-semibold leading-none whitespace-nowrap ${isFaqActive ? 'text-white' : 'text-[#374151]'}`}>
                    FAQ Auto Resolution
                  </p>
                  <p className={`text-[10px] leading-none mt-0.5 font-medium ${isFaqActive ? 'text-red-200' : 'text-[#9CA3AF]'}`}>
                    Auto-resolved queries
                  </p>
                </div>
              </button>

              {/* Separator between FAQ module and workflow */}
              <div className="w-px h-7 bg-[#E5E7EB] mx-1 flex-shrink-0" />

              {/* Workflow stepper: Inbox → Review → Resolution → Dashboard */}
              {workflowStages.map((stage, idx) => {
                const Icon = stage.icon
                const isActive   = currentStage === stage.id
                const wIdx       = WORKFLOW_ORDER.indexOf(stage.id as typeof WORKFLOW_ORDER[number])
                const isDone     = workflowIdx > wIdx && !isFaqActive
                const isLocked   = ((stage.id === 'review' || stage.id === 'decision') && !claimData)
                  || (stage.id === 'decision' && isDeskReject)
                const isRejected = stage.id === 'decision' && isDeskReject

                return (
                  <React.Fragment key={stage.id}>
                    <button
                      onClick={() => !isLocked && onStageChange(stage.id as ProcessingStage)}
                      disabled={!!isLocked}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all
                        ${isActive  ? 'bg-[#FEF2F2]' : ''}
                        ${isLocked  ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-[#F9FAFB]'}
                      `}
                    >
                      {/* Progress circle */}
                      <motion.div
                        animate={{
                          backgroundColor: isDone ? '#059669' : isActive ? '#991B1B' : isRejected ? '#DC2626' : '#E5E7EB',
                          scale: isActive ? 1.08 : 1,
                        }}
                        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm"
                      >
                        {isDone ? (
                          <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                        ) : isRejected ? (
                          <Ban className="w-3.5 h-3.5 text-white" strokeWidth={2} />
                        ) : (
                          <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-[#9CA3AF]'}`} strokeWidth={2} />
                        )}
                      </motion.div>

                      {/* Label */}
                      <div className="hidden lg:block">
                        <p className={`text-[12px] font-semibold leading-none ${isActive ? 'text-[#991B1B]' : isDone ? 'text-[#059669]' : isRejected ? 'text-[#DC2626]' : 'text-[#374151]'}`}>
                          {stage.label}
                        </p>
                        <p className="text-[10px] text-[#9CA3AF] leading-none mt-0.5 font-medium">
                          {isRejected ? 'Desk Rejected' : stage.sub}
                        </p>
                      </div>
                    </button>

                    {/* Connector between workflow steps */}
                    {idx < workflowStages.length - 1 && (
                      <div className="flex-1 mx-1 h-px relative overflow-hidden rounded-full min-w-[16px] max-w-[48px]">
                        <div className="absolute inset-0 bg-[#E5E7EB]" />
                        <motion.div
                          className="absolute inset-0 origin-left bg-gradient-to-r from-[#991B1B] to-[#B91C1C]"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: (workflowIdx > wIdx && !isFaqActive) ? 1 : 0 }}
                          transition={{ duration: 0.35, ease: 'easeOut' }}
                        />
                      </div>
                    )}
                  </React.Fragment>
                )
              })}
            </nav>

            {/* User area */}
            <div className="flex items-center gap-2 min-w-fit">
              {user && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB]">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#991B1B] to-[#B91C1C] flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">{user.name?.charAt(0).toUpperCase()}</span>
                  </div>
                  <span className="text-xs text-[#374151] font-medium hidden sm:inline max-w-[100px] truncate">
                    {user.name}
                  </span>
                </div>
              )}
              <button
                onClick={logout}
                className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#EF4444] hover:bg-red-50 transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <ConfigModal isOpen={showConfig} onClose={() => setShowConfig(false)} onSave={() => {}} />
    </>
  )
}
