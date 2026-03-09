import { AgentState, AgentConfig, UploadedFile } from '../types'
import { DocumentType } from '@/types/claims'
import { openaiService } from '@/lib/services/openai'

export class IngestionAgent {
  async execute(state: AgentState, config: AgentConfig): Promise<Partial<AgentState>> {
    const startTime = Date.now()
    
    try {
      // Log ingestion start
      const auditEvent = {
        step: 'ingestion',
        timestamp: new Date().toISOString(),
        duration: 0,
        agent: 'IngestionAgent',
        status: 'started' as const,
        details: {
          emailLength: state.emailText.length,
          fileCount: state.files.length,
          files: state.files.map(f => ({ name: f.name, size: f.size, type: f.mimeType }))
        }
      }

      // Normalize email text
      const normalizedEmail = this.normalizeEmailText(state.emailText)
      
      // Process and classify attachments
      const documents = await this.processAttachments(state.files)
      
      // Extract basic metadata
      const metadata = this.extractEmailMetadata(normalizedEmail)
      
      const duration = Date.now() - startTime
      
      return {
        currentStep: 'Document Classification',
        documents,
        auditEvents: [...state.auditEvents, {
          ...auditEvent,
          duration,
          status: 'completed',
          details: {
            ...auditEvent.details,
            documentsProcessed: documents.length,
            metadata
          }
        }]
      }
    } catch (error) {
      const duration = Date.now() - startTime
      
      return {
        errors: [...state.errors, `Ingestion failed: ${error}`],
        auditEvents: [...state.auditEvents, {
          step: 'ingestion',
          timestamp: new Date().toISOString(),
          duration,
          agent: 'IngestionAgent',
          status: 'failed',
          details: { error: String(error) }
        }]
      }
    }
  }

  private normalizeEmailText(emailText: string): string {
    // Remove forwarding headers, normalize whitespace
    return emailText
      .replace(/^(From:|To:|Subject:|Date:).*$/gm, '') // Remove headers
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
  }

  private async processAttachments(files: UploadedFile[]): Promise<any[]> {
    const documents = []
    
    for (const file of files) {
      // Simulate OCR/text extraction
      const extractedText = await this.simulateOCR(file)
      
      try {
        // Use OpenAI for document classification
        const classification = await openaiService.classifyDocument(file.name, extractedText)
        
        documents.push({
          id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          type: classification.type as DocumentType,
          mimeType: file.mimeType,
          content: extractedText,
          confidence: classification.confidence,
          keyFields: classification.keyFields,
          metadata: {
            size: file.size,
            processedAt: new Date().toISOString(),
            classificationMethod: 'openai'
          }
        })
      } catch (error) {
        // Fallback to rule-based classification
        console.warn(`OpenAI classification failed for ${file.name}, using fallback:`, error)
        const docType = this.classifyDocument(file.name, extractedText)
        
        documents.push({
          id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          type: docType,
          mimeType: file.mimeType,
          content: extractedText,
          confidence: this.calculateConfidence(file.name, extractedText, docType),
          keyFields: {},
          metadata: {
            size: file.size,
            processedAt: new Date().toISOString(),
            classificationMethod: 'rule_based_fallback'
          }
        })
      }
    }
    
    return documents
  }

  private async simulateOCR(file: UploadedFile): Promise<string> {
    // In a real implementation, this would call Azure Form Recognizer or AWS Textract
    // For demo, we return the provided content (which simulates extracted text)
    
    // Add some realistic OCR processing delay
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000))
    
    return file.content || `[OCR extracted content from ${file.name}]`
  }

  private classifyDocument(fileName: string, content: string): DocumentType {
    const name = fileName.toLowerCase()
    const text = content.toLowerCase()
    
    // Rule-based classification
    if (name.includes('police') || text.includes('police report') || text.includes('officer')) {
      return 'PoliceReport'
    }
    if (name.includes('estimate') || name.includes('repair') || text.includes('estimate') || text.includes('labor')) {
      return 'RepairEstimate'
    }
    if (name.includes('invoice') || name.includes('bill') || text.includes('invoice') || text.includes('total due')) {
      return 'Invoice'
    }
    if (name.includes('photo') || name.includes('image') || name.includes('damage') || text.includes('photo')) {
      return 'DamagePhoto'
    }
    if (name.includes('medical') || text.includes('hospital') || text.includes('patient') || text.includes('diagnosis')) {
      return 'MedicalRecord'
    }
    
    return 'Other'
  }

  private calculateConfidence(fileName: string, content: string, docType: DocumentType): number {
    // Simple confidence scoring based on keyword matches
    let confidence = 0.6 // Base confidence
    
    const keywords = this.getKeywordsForDocType(docType)
    const text = (fileName + ' ' + content).toLowerCase()
    
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        confidence += 0.1
      }
    }
    
    return Math.min(confidence, 1.0)
  }

  private getKeywordsForDocType(docType: DocumentType): string[] {
    const keywordMap: Record<DocumentType, string[]> = {
      PoliceReport: ['police', 'officer', 'badge', 'incident', 'citation', 'vehicle'],
      RepairEstimate: ['estimate', 'repair', 'labor', 'parts', 'total', 'damage'],
      Invoice: ['invoice', 'bill', 'payment', 'due', 'amount', 'services'],
      DamagePhoto: ['photo', 'image', 'damage', 'picture', 'scene'],
      MedicalRecord: ['hospital', 'patient', 'diagnosis', 'treatment', 'doctor', 'medical'],
      IncidentReport: ['incident', 'report', 'accident', 'occurred', 'witness', 'details'],
      Other: []
    }
    
    return keywordMap[docType] || []
  }

  private extractEmailMetadata(emailText: string): Record<string, any> {
    const lines = emailText.split('\n')
    const metadata: Record<string, any> = {}
    
    // Extract basic email components
    for (const line of lines) {
      if (line.startsWith('Subject:')) {
        metadata.subject = line.replace('Subject:', '').trim()
      }
      if (line.startsWith('From:')) {
        metadata.from = line.replace('From:', '').trim()
      }
      if (line.startsWith('Date:')) {
        metadata.date = line.replace('Date:', '').trim()
      }
    }
    
    return metadata
  }
}