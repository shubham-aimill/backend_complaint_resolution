'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import Header from '@/components/Header'
import HomePage from '@/components/HomePage'
import ReviewPage from '@/components/ReviewPage'
import DecisionPage from '@/components/DecisionPage'
import DashboardPage from '@/components/DashboardPage'
import { ClaimData, ProcessingStage } from '@/types/claims'
import { useAuth } from '@/lib/auth/AuthContext'
import { getCached, setCached } from '@/lib/clientCache'

export default function Home() {
  const router = useRouter()
  const { isAuthenticated, loading } = useAuth()
  const [currentStage, setCurrentStage] = useState<ProcessingStage>('home')
  const [claimData, setClaimData] = useState<ClaimData | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, loading, router])

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#991B1B] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-[#64748B]">Loading...</p>
        </div>
      </div>
    )
  }

  // Don't render main app if not authenticated
  if (!isAuthenticated) {
    return null
  }

  const handleStageChange = (stage: ProcessingStage) => {
    // Review and Decision require a loaded/processed claim; Dashboard can show global metrics without one
    if ((stage === 'review' || stage === 'decision') && !claimData) {
      return
    }
    setCurrentStage(stage)
  }

  const handleClaimProcessed = (data: ClaimData) => {
    setClaimData(data)
    setCurrentStage('review')
  }

  const handleLoadClaim = async (claimId: string) => {
    const cacheKey = `cache:processed-claims:detail:${claimId}`
    const ttlMs = 5 * 60 * 1000
    const cached = getCached<ClaimData>(cacheKey)
    if (cached) {
      setClaimData(cached)
    }
    try {
      const res = await fetch(`/api/claims/${encodeURIComponent(claimId)}`)
      if (res.ok) {
        const data = await res.json()
        setClaimData(data)
        setCached(cacheKey, data, ttlMs)
      }
    } catch (err) {
      console.error('Failed to load claim:', err)
    }
  }

  const renderCurrentStage = () => {
    switch (currentStage) {
      case 'home':
        return (
          <HomePage
            onProcessClaim={handleClaimProcessed}
            isProcessing={isProcessing}
            setIsProcessing={setIsProcessing}
          />
        )
      case 'review':
        return (
          <ReviewPage
            claimData={claimData!}
            onNextStage={() => setCurrentStage('decision')}
            onPreviousStage={() => setCurrentStage('home')}
            onLoadClaim={handleLoadClaim}
          />
        )
      case 'decision':
        return (
          <DecisionPage
            claimData={claimData!}
            onNextStage={() => setCurrentStage('dashboard')}
            onPreviousStage={() => setCurrentStage('review')}
            onLoadClaim={handleLoadClaim}
          />
        )
        case 'dashboard':
        return (
          <DashboardPage
            claimData={claimData ?? null}
            onReset={() => {
              setCurrentStage('home')
              setClaimData(null)
            }}
          />
        )
      default:
        return <HomePage onProcessClaim={handleClaimProcessed} isProcessing={isProcessing} setIsProcessing={setIsProcessing} />
    }
  }

  return (
    <div className="min-h-screen bg-white relative">
      <Header currentStage={currentStage} onStageChange={handleStageChange} />
      <main className="container mx-auto px-4 py-16 relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStage}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {renderCurrentStage()}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
} 
