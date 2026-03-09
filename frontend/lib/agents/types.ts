// Agent system types for LangGraph orchestration
import { ClaimData, Document, FieldEvidence, PolicyHit, AuditEvent } from '@/types/claims'

export interface AgentState {
  // Input data
  emailText: string
  files: UploadedFile[]
  
  // Processing state
  currentStep: string
  startTime: number
  
  // Extracted artifacts
  documents: Document[]
  extractedFields: Record<string, any>
  fieldEvidence: FieldEvidence[]
  policyHits: PolicyHit[]
  
  // Audit trail
  auditEvents: AuditEvent[]
  
  // Final output
  claimData?: ClaimData
  
  // Error handling
  errors: string[]
  warnings: string[]
}

export interface UploadedFile {
  name: string
  content: string
  mimeType: string
  size: number
}

export interface AgentConfig {
  llmModel: string
  confidenceThreshold: number
  maxRetries: number
  timeoutMs: number
}

export interface AgentNode {
  name: string
  execute: (state: AgentState, config: AgentConfig) => Promise<Partial<AgentState>>
}

// Tool schemas for LLM function calling
export interface ExtractionTool {
  name: 'extract_claim_fields'
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
}

export interface ClassificationTool {
  name: 'classify_document'
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
}

export interface PolicyQueryTool {
  name: 'query_policy_database'
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
}