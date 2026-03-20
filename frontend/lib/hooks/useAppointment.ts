'use client'

import { useState, useCallback } from 'react'

export interface AppointmentDetails {
  appointmentId?: string
  id?: string
  complaintId: string
  date: string
  time: string
  engineerName: string
  location: string
  bookedAt?: string
  [key: string]: unknown
}

interface BookParams {
  complaintId: string
  date: string
  time: string
  engineerName: string
  location: string
  notes?: string
}

export function useAppointment() {
  const [booked, setBooked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<AppointmentDetails | null>(null)

  const book = useCallback(async (params: BookParams): Promise<boolean> => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to book appointment')
      setDetails(data)
      setBooked(true)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to book appointment')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return { booked, loading, error, details, book }
}
