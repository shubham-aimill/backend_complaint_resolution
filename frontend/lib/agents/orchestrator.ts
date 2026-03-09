import { AgentState, AgentConfig, UploadedFile } from './types'
import { ClaimData } from '@/types/claims'
import { IngestionAgent } from './nodes/ingestionAgent'
import { ExtractionAgent } from './nodes/extractionAgent'
import { PolicyAgent } from './nodes/policyAgent'
import { AssemblerAgent } from './nodes/assemblerAgent'

export class LangGraphOrchestrator {
  private ingestionAgent: IngestionAgent
  private extractionAgent: ExtractionAgent
  private policyAgent: PolicyAgent
  private assemblerAgent: AssemblerAgent
  private config: AgentConfig
  private hasOpenAIKey: boolean

  constructor(config?: Partial<AgentConfig>) {
    this.config = {
      llmModel: process.env.OPENAI_MODEL || 'gpt-4-1106-preview',
      confidenceThreshold: 0.6,
      maxRetries: 3,
      timeoutMs: 30000,
      ...config
    }

    // Check if OpenAI API key is available
    this.hasOpenAIKey = !!(process.env.OPENAI_API_KEY || (typeof window !== 'undefined' && (window as any).OPENAI_API_KEY))

    // Initialize agent nodes
    this.ingestionAgent = new IngestionAgent()
    this.extractionAgent = new ExtractionAgent()
    this.policyAgent = new PolicyAgent()
    this.assemblerAgent = new AssemblerAgent()
  }

  async processClaim(emailText: string, files: UploadedFile[]): Promise<ClaimData> {
    const startTime = Date.now()
    
    // Initialize agent state
    let state: AgentState = {
      emailText,
      files,
      currentStep: 'Initializing',
      startTime,
      documents: [],
      extractedFields: {},
      fieldEvidence: [],
      policyHits: [],
      auditEvents: [],
      errors: [],
      warnings: []
    }

    try {
      // Execute agent workflow in sequence
      state = await this.executeWorkflow(state)
      
      if (state.claimData) {
        return state.claimData
      } else {
        throw new Error('Workflow completed but no claim data generated')
      }
    } catch (error) {
      // Add error to audit trail
      state.auditEvents.push({
        step: 'orchestrator_error',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        agent: 'Orchestrator',
        status: 'failed',
        details: { error: String(error) }
      })

      throw new Error(`Claim processing failed: ${error}`)
    }
  }

  private async executeWorkflow(initialState: AgentState): Promise<AgentState> {
    let state = { ...initialState }

    // Step 1: Ingestion Agent
    state.currentStep = 'Document Ingestion'
    state = { ...state, ...(await this.executeWithRetry(
      () => this.ingestionAgent.execute(state, this.config),
      'ingestion'
    ))}

    // Step 2: Extraction Agent
    state.currentStep = 'Field Extraction'
    state = { ...state, ...(await this.executeWithRetry(
      () => this.extractionAgent.execute(state, this.config),
      'extraction'
    ))}

    // Step 3: Policy Agent
    state.currentStep = 'Policy Grounding'
    state = { ...state, ...(await this.executeWithRetry(
      () => this.policyAgent.execute(state, this.config),
      'policy_grounding'
    ))}

    // Step 4: Assembler Agent
    state.currentStep = 'Decision Assembly'
    state = { ...state, ...(await this.executeWithRetry(
      () => this.assemblerAgent.execute(state, this.config),
      'assembly'
    ))}

    return state
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    stepName: string,
    retryCount = 0
  ): Promise<T> {
    try {
      return await Promise.race([
        operation(),
        this.createTimeoutPromise()
      ])
    } catch (error) {
      if (retryCount < this.config.maxRetries) {
        // Log retry attempt
        console.warn(`Retrying ${stepName} (attempt ${retryCount + 1}): ${error}`)
        
        // Exponential backoff
        await new Promise(resolve => 
          setTimeout(resolve, Math.pow(2, retryCount) * 1000)
        )
        
        return this.executeWithRetry(operation, stepName, retryCount + 1)
      } else {
        throw new Error(`${stepName} failed after ${this.config.maxRetries} retries: ${error}`)
      }
    }
  }

  private createTimeoutPromise(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${this.config.timeoutMs}ms`))
      }, this.config.timeoutMs)
    })
  }

  // Utility methods for monitoring and debugging
  getProcessingStatus(state: AgentState): {
    currentStep: string
    progress: number
    estimatedTimeRemaining: number
    errors: string[]
  } {
    const totalSteps = 4 // ingestion, extraction, policy, assembly
    const completedSteps = state.auditEvents.filter(e => e.status === 'completed').length
    const progress = completedSteps / totalSteps
    
    const avgStepTime = state.auditEvents.length > 0 ?
      state.auditEvents.reduce((sum, e) => sum + e.duration, 0) / state.auditEvents.length :
      2000 // Default 2 seconds per step
    
    const estimatedTimeRemaining = (totalSteps - completedSteps) * avgStepTime

    return {
      currentStep: state.currentStep,
      progress,
      estimatedTimeRemaining,
      errors: state.errors
    }
  }

  getAuditTrail(state: AgentState): any[] {
    return state.auditEvents.map(event => ({
      ...event,
      formattedDuration: `${event.duration}ms`,
      formattedTimestamp: new Date(event.timestamp).toLocaleString()
    }))
  }

  // Configuration management
  updateConfig(newConfig: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }

  getConfig(): AgentConfig {
    return { ...this.config }
  }

  // Check OpenAI integration status
  getOpenAIStatus(): {
    available: boolean
    model: string
    message: string
  } {
    return {
      available: this.hasOpenAIKey,
      model: this.config.llmModel,
      message: this.hasOpenAIKey 
        ? `OpenAI integration active with ${this.config.llmModel}` 
        : 'OpenAI API key not configured - using simulation mode'
    }
  }

  // Health check for the orchestrator
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy'
    details: Record<string, any>
  }> {
    try {
      // Test with minimal input
      const testState: AgentState = {
        emailText: 'Test health check',
        files: [],
        currentStep: 'health_check',
        startTime: Date.now(),
        documents: [],
        extractedFields: {},
        fieldEvidence: [],
        policyHits: [],
        auditEvents: [],
        errors: [],
        warnings: []
      }

      // Quick test of each agent
      const results = await Promise.allSettled([
        this.ingestionAgent.execute(testState, this.config),
        this.extractionAgent.execute(testState, this.config),
        this.policyAgent.execute(testState, this.config),
        this.assemblerAgent.execute(testState, this.config)
      ])

      const failedAgents = results.filter(r => r.status === 'rejected').length
      const openaiStatus = this.getOpenAIStatus()
      
      return {
        status: failedAgents === 0 ? 'healthy' : failedAgents <= 1 ? 'degraded' : 'unhealthy',
        details: {
          agentsOnline: results.length - failedAgents,
          totalAgents: results.length,
          config: this.config,
          openaiStatus,
          timestamp: new Date().toISOString()
        }
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: String(error),
          timestamp: new Date().toISOString()
        }
      }
    }
  }
}