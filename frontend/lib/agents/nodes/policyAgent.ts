import { AgentState, AgentConfig } from '../types'
import { PolicyHit } from '@/types/claims'
import { openaiService } from '@/lib/services/openai'

export class PolicyAgent {
  private policyDatabase: PolicyClause[]

  constructor() {
    this.policyDatabase = this.initializePolicyDatabase()
  }

  async execute(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    const startTime = Date.now()
    
    try {
      // Query policy database using extracted fields and document context
      const policyHits = await this.queryPolicyDatabase(
        state.extractedFields,
        state.documents,
        state.emailText
      )

      const duration = Date.now() - startTime
      
      return {
        currentStep: 'Decision Assembly',
        policyHits,
        auditEvents: [...state.auditEvents, {
          step: 'policy_grounding',
          timestamp: new Date().toISOString(),
          duration,
          agent: 'PolicyAgent',
          status: 'completed',
          details: {
            clausesFound: policyHits.length,
            avgSimilarity: policyHits.reduce((sum, h) => sum + (h.similarity || h.score || 0), 0) / policyHits.length,
            topScore: policyHits.length > 0 ? Math.max(...policyHits.map(h => h.similarity || h.score || 0)) : 0
          }
        }]
      }
    } catch (error) {
      const duration = Date.now() - startTime
      
      return {
        errors: [...state.errors, `Policy grounding failed: ${error}`],
        auditEvents: [...state.auditEvents, {
          step: 'policy_grounding',
          timestamp: new Date().toISOString(),
          duration,
          agent: 'PolicyAgent',
          status: 'failed',
          details: { error: String(error) }
        }]
      }
    }
  }

  private async queryPolicyDatabase(
    extractedFields: Record<string, any>,
    documents: any[],
    emailText: string
  ): Promise<PolicyHit[]> {
    try {
      // Use OpenAI to find relevant policy clauses
      const lossType = extractedFields.lossType || 'Other'
      const description = extractedFields.description || 'Claim submitted'
      
      const openaiResults = await openaiService.queryPolicyDatabase(lossType, description, extractedFields)
      
      // Convert OpenAI results to full PolicyHit format
      const policyHits: PolicyHit[] = openaiResults.map(result => {
        const clause = this.policyDatabase.find(c => c.id === result.clauseId)
        return {
          clauseId: result.clauseId,
          title: result.title,
          content: clause?.content || 'Policy clause content',
          similarity: result.similarity,
          rationale: result.rationale,
          sourceDocument: clause?.sourceDocument || 'Policy Document',
          section: clause?.section || 'Section Unknown'
        }
      })
      
      return policyHits
    } catch (error) {
      console.warn('OpenAI policy query failed, using fallback:', error)
      
      // Fallback to rule-based policy search
      await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 500))

      const searchContext = this.buildSearchContext(extractedFields, documents, emailText)
      const candidateHits = this.findRelevantClauses(searchContext)
      
      const scoredHits = candidateHits.map(clause => ({
        clauseId: clause.id,
        title: clause.title,
        content: clause.content,
        similarity: this.calculateSimilarity(searchContext, clause),
        rationale: this.generateRationale(searchContext, clause),
        sourceDocument: clause.sourceDocument,
        section: clause.section
      }))

      return scoredHits
        .filter(hit => hit.similarity >= 0.6)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5)
    }
  }

  private buildSearchContext(
    extractedFields: Record<string, any>,
    documents: any[],
    emailText: string
  ): string {
    const context = []
    
    // Add loss type and description
    if (extractedFields.lossType) {
      context.push(`Loss Type: ${extractedFields.lossType}`)
    }
    if (extractedFields.description) {
      context.push(`Description: ${extractedFields.description}`)
    }
    
    // Add document types as context
    const docTypes = documents.map(d => d.type).join(', ')
    if (docTypes) {
      context.push(`Document Types: ${docTypes}`)
    }
    
    // Add key extracted fields
    const keyFields = ['vehicleInfo', 'propertyAddress', 'estimatedDamage']
    for (const field of keyFields) {
      if (extractedFields[field]) {
        context.push(`${field}: ${JSON.stringify(extractedFields[field])}`)
      }
    }
    
    return context.join('\n')
  }

  private findRelevantClauses(searchContext: string): PolicyClause[] {
    const context = searchContext.toLowerCase()
    const relevantClauses = []
    
    for (const clause of this.policyDatabase) {
      const clauseText = clause.content.toLowerCase()
      const clauseKeywords = clause.keywords.map(k => k.toLowerCase())
      
      // Check for keyword matches
      let hasMatch = false
      for (const keyword of clauseKeywords) {
        if (context.includes(keyword) || clauseText.includes(keyword)) {
          hasMatch = true
          break
        }
      }
      
      // Check for loss type matches
      if (context.includes('collision') && clause.coverage.includes('collision')) hasMatch = true
      if (context.includes('water') && clause.coverage.includes('water')) hasMatch = true
      if (context.includes('liability') && clause.coverage.includes('liability')) hasMatch = true
      if (context.includes('fire') && clause.coverage.includes('fire')) hasMatch = true
      
      if (hasMatch) {
        relevantClauses.push(clause)
      }
    }
    
    return relevantClauses
  }

  private calculateSimilarity(searchContext: string, clause: PolicyClause): number {
    const context = searchContext.toLowerCase()
    const clauseText = clause.content.toLowerCase()
    
    let score = 0.0
    
    // Keyword matching (40% of score)
    let keywordMatches = 0
    for (const keyword of clause.keywords) {
      if (context.includes(keyword.toLowerCase())) {
        keywordMatches++
      }
    }
    score += (keywordMatches / clause.keywords.length) * 0.4
    
    // Coverage type matching (30% of score)
    for (const coverage of clause.coverage) {
      if (context.includes(coverage.toLowerCase())) {
        score += 0.3
        break
      }
    }
    
    // Text overlap (20% of score)
    const contextWords = context.split(/\s+/)
    const clauseWords = clauseText.split(/\s+/)
    const commonWords = contextWords.filter(word => 
      word.length > 3 && clauseWords.includes(word)
    )
    score += (commonWords.length / Math.max(contextWords.length, clauseWords.length)) * 0.2
    
    // Document type relevance (10% of score)
    if (clause.applicableDocuments.some(docType => context.includes(docType.toLowerCase()))) {
      score += 0.1
    }
    
    return Math.min(score, 1.0)
  }

  private generateRationale(searchContext: string, clause: PolicyClause): string {
    const context = searchContext.toLowerCase()
    const reasons = []
    
    // Check keyword matches
    const matchedKeywords = clause.keywords.filter(k => 
      context.includes(k.toLowerCase())
    )
    if (matchedKeywords.length > 0) {
      reasons.push(`Matched keywords: ${matchedKeywords.join(', ')}`)
    }
    
    // Check coverage matches
    const matchedCoverage = clause.coverage.filter(c => 
      context.includes(c.toLowerCase())
    )
    if (matchedCoverage.length > 0) {
      reasons.push(`Relevant coverage: ${matchedCoverage.join(', ')}`)
    }
    
    // Check document type matches
    const matchedDocs = clause.applicableDocuments.filter(d => 
      context.includes(d.toLowerCase())
    )
    if (matchedDocs.length > 0) {
      reasons.push(`Applicable documents: ${matchedDocs.join(', ')}`)
    }
    
    return reasons.join('; ') || 'General policy relevance'
  }

  private initializePolicyDatabase(): PolicyClause[] {
    return [
      // Auto Insurance Clauses
      {
        id: 'AUTO-COL-001',
        title: 'Collision Coverage',
        content: 'We will pay for direct and accidental loss to your covered auto caused by collision with another object or by upset of your covered auto. Collision coverage is subject to the deductible shown in the Declarations.',
        coverage: ['collision', 'auto'],
        keywords: ['collision', 'crash', 'accident', 'vehicle', 'auto', 'car', 'deductible'],
        applicableDocuments: ['PoliceReport', 'RepairEstimate', 'DamagePhoto'],
        sourceDocument: 'Auto Policy Form AP-2024',
        section: 'Part D - Coverage for Damage to Your Auto',
        deductible: 500
      },
      {
        id: 'AUTO-LIAB-001',
        title: 'Bodily Injury Liability',
        content: 'We will pay damages for bodily injury for which any insured becomes legally responsible because of an auto accident. We will settle or defend, as we consider appropriate, any claim or suit asking for these damages.',
        coverage: ['liability', 'bodily injury'],
        keywords: ['bodily injury', 'liability', 'accident', 'damages', 'lawsuit', 'medical'],
        applicableDocuments: ['PoliceReport', 'MedicalRecord', 'MedicalBill'],
        sourceDocument: 'Auto Policy Form AP-2024',
        section: 'Part A - Liability Coverage'
      },
      {
        id: 'AUTO-PD-001',
        title: 'Property Damage Liability',
        content: 'We will pay damages for property damage for which any insured becomes legally responsible because of an auto accident. Property damage means physical injury to, destruction of, or loss of use of tangible property.',
        coverage: ['liability', 'property damage'],
        keywords: ['property damage', 'liability', 'accident', 'damages', 'physical injury'],
        applicableDocuments: ['PoliceReport', 'RepairEstimate', 'DamagePhoto'],
        sourceDocument: 'Auto Policy Form AP-2024',
        section: 'Part A - Liability Coverage'
      },
      
      // Homeowners Insurance Clauses  
      {
        id: 'HO-WATER-001',
        title: 'Water Damage Coverage',
        content: 'We cover sudden and accidental discharge or overflow of water or steam from within a plumbing, heating, air conditioning, or automatic fire protective sprinkler system, or from within a household appliance.',
        coverage: ['water damage', 'property'],
        keywords: ['water', 'discharge', 'overflow', 'plumbing', 'pipe', 'leak', 'sudden'],
        applicableDocuments: ['DamagePhoto', 'RepairEstimate', 'Invoice'],
        sourceDocument: 'Homeowners Policy Form HO-3',
        section: 'Section I - Property Coverages',
        deductible: 1000
      },
      {
        id: 'HO-STORM-001',
        title: 'Wind and Hail Coverage',
        content: 'We cover direct physical loss to property caused by windstorm or hail. This coverage includes damage caused by objects blown by wind or falling trees due to wind.',
        coverage: ['wind', 'hail', 'storm'],
        keywords: ['wind', 'windstorm', 'hail', 'storm', 'tree', 'branch', 'roof'],
        applicableDocuments: ['DamagePhoto', 'WeatherReport', 'RepairEstimate'],
        sourceDocument: 'Homeowners Policy Form HO-3',
        section: 'Section I - Property Coverages',
        deductible: 1000
      },
      
      // Commercial Liability Clauses
      {
        id: 'CGL-SLIP-001',
        title: 'Premises Liability Coverage',
        content: 'We will pay those sums that the insured becomes legally obligated to pay as damages because of bodily injury or property damage to which this insurance applies caused by an occurrence on premises owned or rented by you.',
        coverage: ['liability', 'premises', 'slip and fall'],
        keywords: ['slip', 'fall', 'premises', 'liability', 'bodily injury', 'occurrence'],
        applicableDocuments: ['IncidentReport', 'MedicalRecord', 'WitnessStatement'],
        sourceDocument: 'Commercial General Liability Policy CGL-2024',
        section: 'Coverage A - Bodily Injury and Property Damage Liability'
      },
      {
        id: 'CGL-MED-001',
        title: 'Medical Payments Coverage',
        content: 'We will pay medical expenses incurred by a person for bodily injury caused by an accident on premises you own or rent or because of your operations, without regard to fault.',
        coverage: ['medical payments', 'no fault'],
        keywords: ['medical expenses', 'medical payments', 'accident', 'premises', 'no fault'],
        applicableDocuments: ['MedicalRecord', 'MedicalBill', 'IncidentReport'],
        sourceDocument: 'Commercial General Liability Policy CGL-2024',
        section: 'Coverage C - Medical Payments'
      }
    ]
  }
}

interface PolicyClause {
  id: string
  title: string
  content: string
  coverage: string[]
  keywords: string[]
  applicableDocuments: string[]
  sourceDocument: string
  section: string
  deductible?: number
}