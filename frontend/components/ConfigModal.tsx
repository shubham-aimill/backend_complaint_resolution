'use client'

import React, { useState, useEffect } from 'react'
import { X, Key, CheckCircle, AlertCircle } from 'lucide-react'

interface ConfigModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (apiKey: string) => void
}

export default function ConfigModal({ isOpen, onClose, onSave }: ConfigModalProps) {
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [isValid, setIsValid] = useState(false)

  useEffect(() => {
    // Load saved API key from localStorage
    if (typeof window !== 'undefined') {
      const savedKey = localStorage.getItem('openai_api_key')
      if (savedKey) {
        setApiKey(savedKey)
        setIsValid(savedKey.startsWith('sk-') && savedKey.length > 20)
      }
    }
  }, [isOpen])

  const handleSave = () => {
    if (apiKey.trim()) {
      // Save to localStorage and window for immediate use
      if (typeof window !== 'undefined') {
        localStorage.setItem('openai_api_key', apiKey.trim())
        ;(window as any).OPENAI_API_KEY = apiKey.trim()
      }
      onSave(apiKey.trim())
      onClose()
    }
  }

  const handleApiKeyChange = (value: string) => {
    setApiKey(value)
    setIsValid(value.startsWith('sk-') && value.length > 20)
  }

  const clearApiKey = () => {
    setApiKey('')
    setIsValid(false)
    if (typeof window !== 'undefined') {
      localStorage.removeItem('openai_api_key')
      delete (window as any).OPENAI_API_KEY
    }
    onSave('')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">OpenAI Configuration</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              OpenAI API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 pr-12"
              />
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center space-x-1">
                {isValid ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : apiKey ? (
                  <AlertCircle className="w-4 h-4 text-red-500" />
                ) : null}
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <Key className="w-4 h-4" />
                </button>
              </div>
            </div>
            {apiKey && !isValid && (
              <p className="text-sm text-red-600 mt-1">
                API key should start with 'sk-' and be at least 20 characters
              </p>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <h3 className="text-sm font-medium text-blue-900 mb-1">How to get your API key:</h3>
            <ol className="text-sm text-blue-800 space-y-1">
              <li>1. Go to <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="underline">platform.openai.com/api-keys</a></li>
              <li>2. Click "Create new secret key"</li>
              <li>3. Copy the key and paste it here</li>
            </ol>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
            <p className="text-sm text-yellow-800">
              <strong>Demo Mode:</strong> Without an API key, the system will use simulated responses. 
              With a real API key, you'll get actual AI-powered extraction and analysis.
            </p>
          </div>

          <div className="flex justify-between pt-4">
            <button
              onClick={clearApiKey}
              className="px-4 py-2 text-sm text-red-600 hover:text-red-800"
            >
              Clear Key
            </button>
            <div className="space-x-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                disabled={!apiKey.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}