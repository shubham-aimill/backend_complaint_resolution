'use client'

import React, { useState, useEffect } from 'react'
import { ProcessingStage } from '@/types/claims'
import { motion } from 'framer-motion'
import { 
  Home, 
  Search, 
  CheckCircle, 
  BarChart3,
  Zap,
  Settings,
  Brain,
  LogOut,
  User
} from 'lucide-react'
import ConfigModal from './ConfigModal'
import { useAuth } from '@/lib/auth/AuthContext'

interface HeaderProps {
  currentStage: ProcessingStage
  onStageChange: (stage: ProcessingStage) => void
}

const stages = [
  { id: 'home', label: 'Submit', icon: Home, description: 'Select & Process Complaint' },
  { id: 'review', label: 'Review', icon: Search, description: 'Extraction & Evidence' },
  { id: 'decision', label: 'Resolution', icon: CheckCircle, description: 'Draft Response & Actions' },
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3, description: 'Ops & Metrics' },
] as const

export default function Header({ currentStage, onStageChange }: HeaderProps) {
  const [showConfig, setShowConfig] = useState(false)
  const [hasOpenAIKey, setHasOpenAIKey] = useState(false)
  const { user, logout } = useAuth()

  useEffect(() => {
    // Check for OpenAI API key
    const checkOpenAIKey = () => {
      if (typeof window !== 'undefined') {
        const key = localStorage.getItem('openai_api_key') || (window as any).OPENAI_API_KEY
        setHasOpenAIKey(!!key)
      }
    }
    
    checkOpenAIKey()
    // Check periodically in case key is updated elsewhere
    const interval = setInterval(checkOpenAIKey, 2000)
    return () => clearInterval(interval)
  }, [])

  const handleConfigSave = (apiKey: string) => {
    setHasOpenAIKey(!!apiKey)
  }

  return (
    <>
      <header className="bg-[#FFFAFA] border-b border-red-100/80 sticky top-0 z-50 shadow-sm shadow-red-950/5">
        <div className="container mx-auto px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center space-x-3">
              <div className="flex items-center justify-center w-8 h-8 bg-[#991B1B] rounded">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <div className="flex flex-col">
                <h1 className="text-lg font-semibold text-[#111827]">
                  Complaint Portal
                </h1>
                <p className="text-xs text-[#9CA3AF] font-medium">by AI Mill</p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex items-center space-x-1 px-2 py-1 rounded-xl bg-red-50/40 border border-red-100/50">
              {stages.map((stage, index) => {
                const Icon = stage.icon
                const isActive = currentStage === stage.id
                
                return (
                  <motion.button
                    key={stage.id}
                    onClick={() => onStageChange(stage.id as ProcessingStage)}
                    className={`
                      relative flex items-center space-x-2 px-4 py-2 text-sm font-medium transition-colors rounded-full
                      ${isActive 
                        ? 'text-[#991B1B]' 
                        : 'text-[#6B7280] hover:text-[#374151]'
                      }
                    `}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 24 }}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="header-active-pill"
                        className="absolute inset-0 bg-red-100/70 rounded-full -z-10"
                        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                      />
                    )}
                    <Icon className="w-4 h-4" />
                    <span className="hidden sm:inline">{stage.label}</span>
                  </motion.button>
                )
              })}
            </nav>

            {/* Secondary controls - visually muted */}
            <div className="flex items-center space-x-3">
              <button 
                onClick={() => setShowConfig(true)}
                className="p-1.5 text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              {/* User info and logout */}
              {user && (
                <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-[#F3F4F6]">
                  <User className="w-3.5 h-3.5 text-[#6B7280]" />
                  <span className="text-xs text-[#6B7280] font-medium hidden sm:inline">
                    {user.name}
                  </span>
                </div>
              )}
              <button
                onClick={logout}
                className="p-1.5 text-[#9CA3AF] hover:text-[#EF4444] transition-colors"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
              {/* Image at the very right */}
              <div className="flex items-center space-x-2 ml-2">
                <img 
                  src="/image.png" 
                  alt="AI Mill" 
                  className="h-10 w-auto object-contain"
                />
                <span className="text-xs text-[#9CA3AF] font-medium">By AI Mill</span>
              </div>
            </div>
          </div>
        </div>
      </header>

    <ConfigModal
      isOpen={showConfig}
      onClose={() => setShowConfig(false)}
      onSave={handleConfigSave}
    />
  </>
  )
} 