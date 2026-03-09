import { AgentState, AgentConfig } from '../types'
import { ClaimData, DecisionPack, ClaimDraft } from '@/types/claims'

export class AssemblerAgent {
  async execute(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    const startTime = Date.now()
    
    try {
      // Create the final claim data structure
      const claimData = await this.assembleClaimData(state)
      
      const duration = Date.now() - startTime
      
      return {
        currentStep: 'Review',
        claimData,
        auditEvents: [...state.auditEvents, {
          step: 'assembly',
          timestamp: new Date().toISOString(),
          duration,
          agent: 'AssemblerAgent',
          status: 'completed',
          details: {
            fieldsAssembled: Object.keys(state.extractedFields).length,
            documentsProcessed: state.documents.length,
            policyHitsIncluded: state.policyHits.length,
            totalProcessingTime: Date.now() - state.startTime
          }
        }]
      }
    } catch (error) {
      const duration = Date.now() - startTime
      
      return {
        errors: [...state.errors, `Assembly failed: ${error}`],
        auditEvents: [...state.auditEvents, {
          step: 'assembly',
          timestamp: new Date().toISOString(),
          duration,
          agent: 'AssemblerAgent',
          status: 'failed',
          details: { error: String(error) }
        }]
      }
    }
  }

  private async assembleClaimData(state: AgentState): Promise<ClaimData> {
    // Create claim draft
    const claimDraft = this.createClaimDraft(state.extractedFields, state.documents)
    
    // Assemble decision pack
    const decisionPack = this.createDecisionPack(
      claimDraft,
      state.fieldEvidence,
      state.documents,
      state.policyHits,
      state.auditEvents
    )
    
    // Calculate processing metrics
    const processingMetrics = this.calculateProcessingMetrics(state)
    
    return {
      claimId: this.generateClaimId(),
      decisionPack: {
        ...decisionPack,
        claimDraft,
        evidence: state.fieldEvidence,
        documents: state.documents,
        policyGrounding: state.policyHits,
        audit: state.auditEvents
      },
      auditTrail: state.auditEvents,
      processingMetrics,
      createdAt: new Date().toISOString(),
      status: 'draft'
    }
  }

  private createClaimDraft(extractedFields: Record<string, any>, documents: any[]): ClaimDraft {
    return {
      id: this.generateDraftId(),
      policyNumber: this.sanitizePolicyNumber(extractedFields.policyNumber),
      claimantName: extractedFields.claimantName || 'Unknown',
      contactEmail: this.maskEmail(extractedFields.contactEmail),
      contactPhone: this.maskPhone(extractedFields.contactPhone),
      lossDate: this.formatDate(extractedFields.lossDate),
      lossType: extractedFields.lossType || 'Other',
      lossLocation: extractedFields.lossLocation || 'Not specified',
      description: extractedFields.description || 'Claim details extracted from submitted documents',
      estimatedAmount: extractedFields.estimatedDamage || null,
      
      // Vehicle-specific fields
      vehicleInfo: extractedFields.vehicleInfo || null,
      
      // Property-specific fields  
      propertyAddress: extractedFields.propertyAddress || null,
      
      // Attachments reference
      attachments: documents.map(doc => ({
        id: doc.id,
        name: doc.name,
        mimeType: doc.mimeType || 'application/octet-stream',
        type: doc.type,
        confidence: doc.confidence
      })),
      
      // Coverage assessment
      coverageFound: this.assessCoverage(extractedFields),
      deductible: this.determineDeductible(extractedFields),
      
      // Metadata
      createdAt: new Date().toISOString(),
      source: 'automated_extraction',
      confidence: this.calculateOverallConfidence(extractedFields)
    }
  }

  private createDecisionPack(
    claimDraft: ClaimDraft,
    evidence: any[],
    documents: any[],
    policyHits: any[],
    auditEvents: any[]
  ): DecisionPack {
    return {
      id: this.generateDecisionPackId(),
      claimDraft,
      evidence,
      documents,
      policyGrounding: policyHits,
      audit: auditEvents,
      
      // Evidence summary
      evidenceSummary: {
        totalFields: evidence.length,
        highConfidenceFields: evidence.filter(e => e.confidence >= 0.8).length,
        lowConfidenceFields: evidence.filter(e => e.confidence < 0.6).length,
        avgConfidence: evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length
      },
      
      // Document analysis
      documentAnalysis: {
        totalDocuments: documents.length,
        documentTypes: [...new Set(documents.map(d => d.type))],
        avgDocumentConfidence: documents.reduce((sum, d) => sum + d.confidence, 0) / documents.length,
        missingDocuments: this.identifyMissingDocuments(claimDraft.lossType, documents)
      },
      
      // Policy assessment
      policyAssessment: {
        clausesFound: policyHits.length,
        coverageConfirmed: policyHits.length > 0,
        topSimilarityScore: policyHits.length > 0 ? Math.max(...policyHits.map(h => h.similarity)) : 0,
        recommendedActions: this.generateRecommendations(claimDraft, policyHits, evidence)
      },
      
      // Processing summary
      processingSummary: {
        totalTime: auditEvents.length > 0 ? 
          auditEvents.reduce((sum, e) => sum + e.duration, 0) : 0,
        stepsCompleted: auditEvents.filter(e => e.status === 'completed').length,
        stepsWithErrors: auditEvents.filter(e => e.status === 'failed').length,
        automationLevel: this.calculateAutomationLevel(evidence)
      },
      
      createdAt: new Date().toISOString()
    }
  }

  private calculateProcessingMetrics(state: AgentState): any {
    const totalTime = Date.now() - state.startTime
    const completedSteps = state.auditEvents.filter(e => e.status === 'completed').length
    const failedSteps = state.auditEvents.filter(e => e.status === 'failed').length
    
    return {
      totalProcessingTime: totalTime,
      averageHandleTime: totalTime / 60000, // in minutes
      fieldsAutoPopulated: Object.keys(state.extractedFields).filter(key => 
        state.extractedFields[key] !== null && state.extractedFields[key] !== undefined
      ).length,
      overrideRate: 0, // Would be calculated based on manual corrections
      ragHitRate: state.policyHits.length > 0 ? 1 : 0,
      stepsCompleted: completedSteps,
      stepsFailed: failedSteps,
      successRate: completedSteps / (completedSteps + failedSteps)
    }
  }

  // Utility methods
  private generateClaimId(): string {
    return `CLM-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`
  }

  private generateDraftId(): string {
    return `DRAFT-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`
  }

  private generateDecisionPackId(): string {
    return `DP-${Date.now()}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`
  }

  private sanitizePolicyNumber(policyNumber: string | null): string {
    if (!policyNumber) return 'Unknown'
    // Mask policy number for privacy (show only last 3 digits)
    return policyNumber.length > 3 ? 
      '*'.repeat(policyNumber.length - 3) + policyNumber.slice(-3) :
      policyNumber
  }

  private maskEmail(email: string | null): string {
    if (!email) return ''
    const [username, domain] = email.split('@')
    if (!domain) return email
    
    const maskedUsername = username.length > 4 ?
      username.substring(0, 2) + '*'.repeat(username.length - 4) + username.slice(-2) :
      username
    
    return `${maskedUsername}@${domain}`
  }

  private maskPhone(phone: string | null): string {
    if (!phone) return ''
    // Show only last 4 digits
    const digits = phone.replace(/\D/g, '')
    return digits.length > 4 ? 
      '*'.repeat(digits.length - 4) + digits.slice(-4) :
      phone
  }

  private formatDate(dateStr: string | null): string {
    if (!dateStr) return ''
    
    try {
      const date = new Date(dateStr)
      return date.toISOString().split('T')[0] // YYYY-MM-DD format
    } catch {
      return dateStr // Return original if parsing fails
    }
  }

  private assessCoverage(extractedFields: Record<string, any>): boolean {
    // Simple coverage assessment based on policy number presence
    return !!extractedFields.policyNumber
  }

  private determineDeductible(extractedFields: Record<string, any>): number | undefined {
    // Default deductibles based on loss type
    const lossType = extractedFields.lossType
    const defaultDeductibles: Record<string, number> = {
      'Collision': 500,
      'Water': 1000,
      'Wind': 1000,
      'Liability': 0
    }
    
    return defaultDeductibles[lossType] || undefined
  }

  private calculateOverallConfidence(extractedFields: Record<string, any>): number {
    const fields = Object.values(extractedFields).filter(v => v !== null && v !== undefined)
    const requiredFields = ['policyNumber', 'claimantName', 'lossDate', 'lossType']
    const presentRequired = requiredFields.filter(field => extractedFields[field]).length
    
    return (presentRequired / requiredFields.length) * 0.6 + (fields.length / 10) * 0.4
  }

  private identifyMissingDocuments(lossType: string, documents: any[]): string[] {
    const presentTypes = new Set(documents.map(d => d.type))
    const expectedDocuments: Record<string, string[]> = {
      'Collision': ['PoliceReport', 'RepairEstimate', 'DamagePhoto'],
      'Water': ['DamagePhoto', 'RepairEstimate'],
      'Liability': ['IncidentReport', 'MedicalRecord'],
      'Fire': ['DamagePhoto', 'RepairEstimate', 'FireReport'],
      'Theft': ['PoliceReport', 'ItemList']
    }
    
    const expected = expectedDocuments[lossType] || []
    return expected.filter(docType => !presentTypes.has(docType))
  }

  private generateRecommendations(
    claimDraft: ClaimDraft, 
    policyHits: any[], 
    evidence: any[]
  ): string[] {
    const recommendations = []
    
    // Coverage recommendations
    if (policyHits.length === 0) {
      recommendations.push('No matching policy clauses found - review coverage manually')
    } else if (policyHits[0].similarity < 0.8) {
      recommendations.push('Low policy match confidence - adjuster review recommended')
    }
    
    // Evidence recommendations
    const lowConfidenceFields = evidence.filter(e => e.confidence < 0.6)
    if (lowConfidenceFields.length > 0) {
      recommendations.push(`${lowConfidenceFields.length} fields need manual verification`)
    }
    
    // Amount recommendations
    if (claimDraft.estimatedAmount && claimDraft.estimatedAmount > 10000) {
      recommendations.push('High-value claim - senior adjuster review required')
    }
    
    // Document recommendations
    if (!claimDraft.attachments.some(a => a.type === 'DamagePhoto')) {
      recommendations.push('Damage photos recommended for claim validation')
    }
    
    return recommendations
  }

  private calculateAutomationLevel(evidence: any[]): number {
    const highConfidenceFields = evidence.filter(e => e.confidence >= 0.8).length
    return evidence.length > 0 ? highConfidenceFields / evidence.length : 0
  }
}