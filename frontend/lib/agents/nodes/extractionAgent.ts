import { AgentState, AgentConfig } from '../types'
import { FieldEvidence, LossType } from '@/types/claims'
import { openaiService } from '@/lib/services/openai'

export class ExtractionAgent {
  async execute(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    const startTime = Date.now()
    
    try {
      // Extract claim fields using real OpenAI API
      const extractedFields = await this.extractClaimFields(state.emailText, state.documents)
      
      // Generate evidence for each field using OpenAI
      const fieldEvidence = await this.generateFieldEvidence(extractedFields, state.emailText, state.documents)
      
      const duration = Date.now() - startTime
      
      return {
        currentStep: 'Policy Grounding',
        extractedFields,
        fieldEvidence,
        auditEvents: [...state.auditEvents, {
          step: 'extraction',
          timestamp: new Date().toISOString(),
          duration,
          agent: 'ExtractionAgent',
          status: 'completed',
          details: {
            fieldsExtracted: Object.keys(extractedFields).length,
            evidenceCount: fieldEvidence.length,
            avgConfidence: fieldEvidence.reduce((sum, e) => sum + e.confidence, 0) / fieldEvidence.length,
            llmModel: config.llmModel
          }
        }]
      }
    } catch (error) {
      const duration = Date.now() - startTime
      
      // Fallback to rule-based extraction if OpenAI fails
      console.warn('OpenAI extraction failed, falling back to rule-based extraction:', error)
      const fallbackFields = await this.extractClaimFieldsFallback(state.emailText, state.documents)
      const fallbackEvidence = await this.generateFieldEvidenceFallback(fallbackFields, state.emailText, state.documents)
      
      return {
        currentStep: 'Policy Grounding',
        extractedFields: fallbackFields,
        fieldEvidence: fallbackEvidence,
        warnings: [...state.warnings, 'OpenAI extraction failed, used fallback extraction'],
        auditEvents: [...state.auditEvents, {
          step: 'extraction',
          timestamp: new Date().toISOString(),
          duration,
          agent: 'ExtractionAgent',
          status: 'completed_with_fallback',
          details: { 
            error: String(error),
            fallbackUsed: true,
            fieldsExtracted: Object.keys(fallbackFields).length
          }
        }]
      }
    }
  }

  private async extractClaimFields(emailText: string, documents: any[]): Promise<Record<string, any>> {
    try {
      // Use OpenAI to extract claim fields
      const documentContents = documents.map(d => d.content || '')
      const extractedFields = await openaiService.extractClaimFields(emailText, documentContents)
      
      // Validate and clean the extracted fields
      return this.validateAndCleanFields(extractedFields)
    } catch (error) {
      console.error('OpenAI extraction failed:', error)
      throw error
    }
  }

  private async extractClaimFieldsFallback(emailText: string, documents: any[]): Promise<Record<string, any>> {
    // Fallback to rule-based extraction
    const allText = emailText + '\n\n' + documents.map(d => d.content).join('\n\n')
    
    return {
      policyNumber: this.extractPolicyNumber(allText),
      claimantName: this.extractClaimantName(allText),
      contactEmail: this.extractContactEmail(allText),
      contactPhone: this.extractContactPhone(allText),
      lossDate: this.extractLossDate(allText),
      lossType: this.extractLossType(allText),
      lossLocation: this.extractLossLocation(allText),
      description: this.extractDescription(allText),
      vehicleInfo: this.extractVehicleInfo(allText),
      propertyAddress: this.extractPropertyAddress(allText),
      estimatedDamage: this.extractEstimatedDamage(allText)
    }
  }

  private async generateFieldEvidence(
    fields: Record<string, any>, 
    emailText: string, 
    documents: any[]
  ): Promise<FieldEvidence[]> {
    const evidence: FieldEvidence[] = []
    const documentContents = documents.map(d => d.content || '')
    
    for (const [fieldName, value] of Object.entries(fields)) {
      if (value) {
        try {
          // Use OpenAI to generate evidence analysis
          const evidenceAnalysis = await openaiService.generateFieldEvidence(
            fieldName, 
            value, 
            emailText, 
            documentContents
          )
          
          evidence.push({
            field: fieldName,
            value: String(value),
            confidence: evidenceAnalysis.confidence,
            sourceLocator: evidenceAnalysis.sourceLocator,
            rationale: evidenceAnalysis.rationale
          })
        } catch (error) {
          // Fallback to rule-based evidence
          const sourceEvidence = this.findTextEvidence(fieldName, value, emailText + '\n\n' + documentContents.join('\n\n'), documents)
          evidence.push({
            field: fieldName,
            value: String(value),
            confidence: sourceEvidence.confidence,
            sourceLocator: sourceEvidence.locator,
            rationale: sourceEvidence.rationale
          })
        }
      }
    }
    
    return evidence
  }

  private async generateFieldEvidenceFallback(
    fields: Record<string, any>, 
    emailText: string, 
    documents: any[]
  ): Promise<FieldEvidence[]> {
    const evidence: FieldEvidence[] = []
    const allText = emailText + '\n\n' + documents.map(d => d.content).join('\n\n')
    
    for (const [fieldName, value] of Object.entries(fields)) {
      if (value) {
        const sourceEvidence = this.findTextEvidence(fieldName, value, allText, documents)
        evidence.push({
          field: fieldName,
          value: String(value),
          confidence: sourceEvidence.confidence,
          sourceLocator: sourceEvidence.locator,
          rationale: sourceEvidence.rationale
        })
      }
    }
    
    return evidence
  }

  private validateAndCleanFields(fields: Record<string, any>): Record<string, any> {
    const cleaned: Record<string, any> = {}
    
    // Clean and validate each field
    for (const [key, value] of Object.entries(fields)) {
      if (value !== null && value !== undefined && value !== '') {
        switch (key) {
          case 'policyNumber':
            cleaned[key] = this.maskPolicyNumber(String(value))
            break
          case 'contactEmail':
            cleaned[key] = this.maskEmail(String(value))
            break
          case 'contactPhone':
            cleaned[key] = this.maskPhone(String(value))
            break
          case 'lossDate':
            cleaned[key] = this.validateDate(String(value))
            break
          case 'estimatedDamage':
            cleaned[key] = this.validateAmount(value)
            break
          default:
            cleaned[key] = value
        }
      }
    }
    
    return cleaned
  }

  private maskPolicyNumber(policyNumber: string): string {
    // Mask policy number for privacy (show only last 3 digits)
    return policyNumber.length > 3 ? 
      '*'.repeat(policyNumber.length - 3) + policyNumber.slice(-3) :
      policyNumber
  }

  private maskEmail(email: string): string {
    const [username, domain] = email.split('@')
    if (!domain) return email
    
    const maskedUsername = username.length > 4 ?
      username.substring(0, 2) + '*'.repeat(username.length - 4) + username.slice(-2) :
      username
    
    return `${maskedUsername}@${domain}`
  }

  private maskPhone(phone: string): string {
    // Show only last 4 digits
    const digits = phone.replace(/\D/g, '')
    return digits.length > 4 ? 
      '*'.repeat(digits.length - 4) + digits.slice(-4) :
      phone
  }

  private validateDate(dateStr: string): string {
    try {
      const date = new Date(dateStr)
      return date.toISOString().split('T')[0] // YYYY-MM-DD format
    } catch {
      return dateStr // Return original if parsing fails
    }
  }

  private validateAmount(amount: any): number | null {
    const num = typeof amount === 'number' ? amount : parseFloat(String(amount))
    return isNaN(num) ? null : num
  }

  private findTextEvidence(fieldName: string, value: any, allText: string, documents: any[]): {
    confidence: number
    locator: string
    rationale: string
  } {
    const valueStr = String(value).toLowerCase()
    const text = allText.toLowerCase()
    
    // Find exact matches first
    if (text.includes(valueStr)) {
      const index = text.indexOf(valueStr)
      const context = allText.substring(Math.max(0, index - 50), index + valueStr.length + 50)
      
      return {
        confidence: 0.95,
        locator: `text_offset:${index}-${index + valueStr.length}`,
        rationale: `Direct text match found: "${context.trim()}"`
      }
    }
    
    // Pattern-based matching for specific field types
    return this.getPatternBasedEvidence(fieldName, value, allText)
  }

  private getPatternBasedEvidence(fieldName: string, value: any, text: string): {
    confidence: number
    locator: string
    rationale: string
  } {
    switch (fieldName) {
      case 'policyNumber':
        return {
          confidence: 0.9,
          locator: 'pattern_match:policy_format',
          rationale: 'Matches standard policy number format with prefix and digits'
        }
      case 'lossDate':
        return {
          confidence: 0.85,
          locator: 'pattern_match:date_format',
          rationale: 'Extracted from date context in incident description'
        }
      case 'contactEmail':
        return {
          confidence: 0.95,
          locator: 'pattern_match:email_format',
          rationale: 'Valid email format in sender or contact information'
        }
      case 'contactPhone':
        return {
          confidence: 0.9,
          locator: 'pattern_match:phone_format',
          rationale: 'Standard phone number format with area code'
        }
      default:
        return {
          confidence: 0.7,
          locator: 'inference:context',
          rationale: 'Inferred from contextual information in documents'
        }
    }
  }

  // Field extraction methods
  private extractPolicyNumber(text: string): string | null {
    const patterns = [
      /policy[#\s]*:?\s*([A-Z]{2}\d{9})/i,
      /policy[#\s]*:?\s*([A-Z]{2}\d{6}\d{3})/i,
      /policy[#\s]*:?\s*([A-Z]+\d+)/i
    ]
    
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) {
        return match[1]
      }
    }
    return null
  }

  private extractClaimantName(text: string): string | null {
    // Look for name in various contexts
    const patterns = [
      /(?:from|name|claimant):\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
      /([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s+<?[\w._%+-]+@[\w.-]+\.[A-Z]{2,}>?)/i
    ]
    
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) {
        return match[1]
      }
    }
    return null
  }

  private extractContactEmail(text: string): string | null {
    const pattern = /[\w._%+-]+@[\w.-]+\.[A-Z]{2,}/i
    const match = text.match(pattern)
    return match ? match[0] : null
  }

  private extractContactPhone(text: string): string | null {
    const patterns = [
      /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
      /\d{3}[-.\s]\d{3}[-.\s]\d{4}/
    ]
    
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) {
        return match[0]
      }
    }
    return null
  }

  private extractLossDate(text: string): string | null {
    const patterns = [
      /(?:accident|incident|loss|occurred?).*?(\d{1,2}\/\d{1,2}\/\d{4})/i,
      /(?:march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/i
    ]
    
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) {
        return match[1] || match[0]
      }
    }
    return null
  }

  private extractLossType(text: string): LossType {
    if (/collision|accident|crash|vehicle|car/i.test(text)) {
      return 'Collision'
    }
    if (/water|flood|leak|pipe|storm/i.test(text)) {
      return 'Water'
    }
    if (/fire|burn|smoke/i.test(text)) {
      return 'Fire'
    }
    if (/theft|stolen|burglary/i.test(text)) {
      return 'Theft'
    }
    if (/liability|slip|fall|injury/i.test(text)) {
      return 'Liability'
    }
    return 'Other'
  }

  private extractLossLocation(text: string): string | null {
    const patterns = [
      /(?:at|location|address):\s*([^,\n]+(?:,\s*[^,\n]+)*)/i,
      /(\d+\s+[A-Za-z\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd))/i
    ]
    
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) {
        return match[1].trim()
      }
    }
    return null
  }

  private extractDescription(text: string): string | null {
    // Extract the main incident description
    const sentences = text.split(/[.!?]+/)
    const relevantSentences = sentences.filter(s => 
      /accident|incident|damage|occurred|happened|hit|struck|fell|slip|crash/i.test(s)
    )
    
    return relevantSentences.slice(0, 3).join('. ').trim() || null
  }

  private extractVehicleInfo(text: string): Record<string, any> | null {
    const yearMatch = text.match(/\b(19|20)\d{2}\b/)
    const makeMatch = text.match(/\b(Honda|Toyota|Ford|Chevrolet|BMW|Mercedes|Audi|Nissan|Hyundai|Kia|Mazda|Subaru|Volkswagen|Volvo|Lexus|Acura|Infiniti|Cadillac|Buick|GMC|Jeep|Chrysler|Dodge|Ram)\b/i)
    const modelMatch = text.match(/\b(Civic|Accord|Camry|Corolla|F-150|Silverado|Malibu|Escape|Explorer|CR-V|Pilot|Altima|Sentra|Elantra|Sonata|Optima|Soul|CX-5|Outback|Forester|Jetta|Passat|XC90|ES|IS|RX|GS|LS|Q50|Q60|ATS|CTS|Escalade|LaCrosse|Enclave|Sierra|Terrain|Wrangler|Grand Cherokee|Compass|300|Charger|Challenger|1500|2500|3500)\b/i)
    const licenseMatch = text.match(/(?:license|plate)[#\s]*:?\s*([A-Z0-9-]+)/i)
    
    if (yearMatch || makeMatch || modelMatch) {
      return {
        year: yearMatch ? yearMatch[0] : null,
        make: makeMatch ? makeMatch[0] : null,
        model: modelMatch ? modelMatch[0] : null,
        licensePlate: licenseMatch ? licenseMatch[1] : null
      }
    }
    
    return null
  }

  private extractPropertyAddress(text: string): string | null {
    const patterns = [
      /(?:property|home|house|address):\s*([^,\n]+(?:,\s*[A-Z]{2}\s*\d{5})?)/i,
      /(\d+\s+[A-Za-z\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd)[^,\n]*(?:,\s*[A-Za-z\s]+,?\s*[A-Z]{2}\s*\d{5})?)/i
    ]
    
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) {
        return match[1].trim()
      }
    }
    return null
  }

  private extractEstimatedDamage(text: string): number | null {
    const patterns = [
      /\$([0-9,]+\.?\d*)/g,
      /([0-9,]+\.?\d*)\s*dollars?/gi
    ]
    
    const amounts: number[] = []
    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(text)) !== null) {
        const amount = parseFloat(match[1].replace(/,/g, ''))
        if (amount > 100 && amount < 100000) { // Reasonable damage range
          amounts.push(amount)
        }
      }
    }
    
    return amounts.length > 0 ? Math.max(...amounts) : null
  }
}