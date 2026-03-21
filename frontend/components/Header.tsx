'use client'

import React, { useState } from 'react'
import { ProcessingStage } from '@/types/claims'
import { motion } from 'framer-motion'
import { Inbox, ScanSearch, GitMerge, LayoutDashboard, LogOut, Check } from 'lucide-react'
import ConfigModal from './ConfigModal'
import { useAuth } from '@/lib/auth/AuthContext'

interface HeaderProps {
  currentStage: ProcessingStage
  onStageChange: (stage: ProcessingStage) => void
}

const stages = [
  { id: 'home',      label: 'Inbox',      sub: 'Ingest & select',    icon: Inbox },
  { id: 'review',    label: 'Review',     sub: 'Extract & validate', icon: ScanSearch },
  { id: 'decision',  label: 'Resolution', sub: 'Decide & respond',   icon: GitMerge },
  { id: 'dashboard', label: 'Dashboard',  sub: 'KPIs & metrics',     icon: LayoutDashboard },
] as const

const ORDER: ProcessingStage[] = ['home', 'review', 'decision', 'dashboard']

export default function Header({ currentStage, onStageChange }: HeaderProps) {
  const [showConfig, setShowConfig] = useState(false)
  const { user, logout } = useAuth()

  const currentIdx = ORDER.indexOf(currentStage)

  return (
    <>
      <header className="bg-white border-b border-[#E5E7EB] sticky top-0 z-50 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-6">
          <div className="flex items-center justify-between h-[68px] gap-6">

            {/* Logo */}
            <div className="flex items-center gap-3 min-w-fit">
              <img src="/image.png" alt="Logo" className="h-8 w-auto object-contain" />
              <div className="hidden sm:block">
                <p className="text-[13px] font-bold text-[#111827] leading-none tracking-tight">AI Mill</p>
                <p className="text-[11px] text-[#9CA3AF] leading-none mt-0.5 font-medium">After-Sales Portal</p>
              </div>
            </div>

            {/* Stepper nav */}
            <nav className="flex items-center gap-0 flex-1 max-w-2xl mx-auto">
              {stages.map((stage, idx) => {
                const Icon = stage.icon
                const isActive  = currentStage === stage.id
                const isDone    = currentIdx > idx
                const isLocked  = (stage.id === 'review' || stage.id === 'decision') && currentIdx < idx && currentIdx === 0

                return (
                  <React.Fragment key={stage.id}>
                    {/* Step */}
                    <button
                      onClick={() => !isLocked && onStageChange(stage.id as ProcessingStage)}
                      disabled={!!isLocked}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all
                        ${isActive  ? 'bg-[#FEF2F2]' : ''}
                        ${isLocked  ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-[#F9FAFB]'}
                      `}
                    >
                      {/* Circle */}
                      <motion.div
                        animate={{
                          backgroundColor: isDone ? '#059669' : isActive ? '#991B1B' : '#E5E7EB',
                          scale: isActive ? 1.08 : 1,
                        }}
                        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm"
                      >
                        {isDone ? (
                          <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                        ) : (
                          <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-[#9CA3AF]'}`} strokeWidth={2} />
                        )}
                      </motion.div>

                      {/* Label */}
                      <div className="hidden lg:block">
                        <p className={`text-[12px] font-semibold leading-none ${isActive ? 'text-[#991B1B]' : isDone ? 'text-[#059669]' : 'text-[#374151]'}`}>
                          {stage.label}
                        </p>
                        <p className="text-[10px] text-[#9CA3AF] leading-none mt-0.5 font-medium">{stage.sub}</p>
                      </div>
                    </button>

                    {/* Connector line */}
                    {idx < stages.length - 1 && (
                      <div className="flex-1 mx-1 h-px relative overflow-hidden rounded-full min-w-[20px] max-w-[60px]">
                        <div className="absolute inset-0 bg-[#E5E7EB]" />
                        <motion.div
                          className="absolute inset-0 origin-left bg-gradient-to-r from-[#991B1B] to-[#B91C1C]"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: currentIdx > idx ? 1 : 0 }}
                          transition={{ duration: 0.35, ease: 'easeOut' }}
                        />
                      </div>
                    )}
                  </React.Fragment>
                )
              })}
            </nav>

            {/* User */}
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
