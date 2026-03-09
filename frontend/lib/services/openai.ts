import OpenAI from 'openai'

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
  dangerouslyAllowBrowser: true // For demo purposes - in production, use server-side API routes
})

export interface FunctionCall {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required: string[]
  }
}

export interface LLMResponse {
  content: string
  functionCalls?: Array<{
    name: string
    arguments: Record<string, any>
  }>
}

export class OpenAIService {
  private model: string
  private temperature: number

  constructor(model: string = 'gpt-4-1106-preview', temperature: number = 0.1) {
    this.model = model
    this.temperature = temperature
  }

  async callLLM(
    prompt: string,
    systemPrompt?: string,
    functions?: FunctionCall[]
  ): Promise<LLMResponse> {
    try {
      const messages: any[] = []
      
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt })
      }
      
      messages.push({ role: 'user', content: prompt })

      const requestConfig: any = {
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: 2000
      }

      // Add function calling if functions are provided
      if (functions && functions.length > 0) {
        requestConfig.functions = functions
        requestConfig.function_call = 'auto'
      }

      const response = await openai.chat.completions.create(requestConfig)
      
      const choice = response.choices[0]
      
      if (!choice) {
        throw new Error('No response from OpenAI')
      }

      const result: LLMResponse = {
        content: choice.message?.content || ''
      }

      // Handle function calls
      if (choice.message?.function_call) {
        result.functionCalls = [{
          name: choice.message.function_call.name,
          arguments: JSON.parse(choice.message.function_call.arguments || '{}')
        }]
      }

      return result
    } catch (error) {
      console.error('OpenAI API call failed:', error)
      throw new Error(`OpenAI API call failed: ${error}`)
    }
  }

  async extractClaimFields(emailText: string, documents: string[]): Promise<Record<string, any>> {
    const systemPrompt = `You are an expert insurance claims processor. Extract structured claim information from the provided email and documents. Be precise and only extract information that is explicitly stated or can be confidently inferred.`

    const prompt = `Extract claim fields from this FNOL email and attachments:

EMAIL:
${emailText}

DOCUMENTS:
${documents.join('\n\n---\n\n')}

Extract the following fields if present:
- policyNumber: Insurance policy number
- claimantName: Name of the person filing the claim
- contactEmail: Contact email address
- contactPhone: Contact phone number
- lossDate: Date when the loss occurred (YYYY-MM-DD format)
- lossType: Type of loss (Collision, Water, Fire, Theft, Liability, Other)
- lossLocation: Where the loss occurred
- description: Brief description of what happened
- vehicleInfo: If auto claim - year, make, model, license plate
- propertyAddress: If property claim - property address
- estimatedDamage: Estimated damage amount if mentioned

Return ONLY a JSON object with the extracted fields. Use null for missing fields.`

    const functions: FunctionCall[] = [{
      name: 'extract_claim_fields',
      description: 'Extract structured claim information from email and documents',
      parameters: {
        type: 'object',
        properties: {
          policyNumber: { type: 'string', description: 'Insurance policy number' },
          claimantName: { type: 'string', description: 'Name of claimant' },
          contactEmail: { type: 'string', description: 'Contact email' },
          contactPhone: { type: 'string', description: 'Contact phone number' },
          lossDate: { type: 'string', description: 'Loss date in YYYY-MM-DD format' },
          lossType: { 
            type: 'string', 
            enum: ['Collision', 'Water', 'Fire', 'Theft', 'Liability', 'Other'],
            description: 'Type of loss'
          },
          lossLocation: { type: 'string', description: 'Location where loss occurred' },
          description: { type: 'string', description: 'Description of what happened' },
          vehicleInfo: { 
            type: 'object',
            properties: {
              year: { type: 'string' },
              make: { type: 'string' },
              model: { type: 'string' },
              licensePlate: { type: 'string' }
            },
            description: 'Vehicle information for auto claims'
          },
          propertyAddress: { type: 'string', description: 'Property address for property claims' },
          estimatedDamage: { type: 'number', description: 'Estimated damage amount' }
        },
        required: []
      }
    }]

    const response = await this.callLLM(prompt, systemPrompt, functions)
    
    if (response.functionCalls && response.functionCalls.length > 0) {
      return response.functionCalls[0].arguments
    }
    
    // Fallback: try to parse JSON from content
    try {
      return JSON.parse(response.content)
    } catch {
      throw new Error('Failed to extract structured claim fields from LLM response')
    }
  }

  async classifyDocument(filename: string, content: string): Promise<{
    type: string
    confidence: number
    keyFields: Record<string, any>
  }> {
    const systemPrompt = `You are a document classification expert for insurance claims. Classify the document type and extract key fields.`

    const prompt = `Classify this document and extract key information:

FILENAME: ${filename}
CONTENT:
${content.substring(0, 2000)}...

Classify the document type as one of:
- PoliceReport
- RepairEstimate  
- Invoice
- MedicalRecord
- IncidentReport
- DamagePhoto
- Other

Also extract relevant key fields based on the document type.`

    const functions: FunctionCall[] = [{
      name: 'classify_document',
      description: 'Classify document type and extract key fields',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['PoliceReport', 'RepairEstimate', 'Invoice', 'MedicalRecord', 'IncidentReport', 'DamagePhoto', 'Other'],
            description: 'Document type classification'
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Confidence score for classification'
          },
          keyFields: {
            type: 'object',
            description: 'Key fields extracted from the document'
          }
        },
        required: ['type', 'confidence', 'keyFields']
      }
    }]

    const response = await this.callLLM(prompt, systemPrompt, functions)
    
    if (response.functionCalls && response.functionCalls.length > 0) {
      const args = response.functionCalls[0].arguments
      return {
        type: args.type || 'Other',
        confidence: args.confidence || 0.5,
        keyFields: args.keyFields || {}
      }
    }
    
    // Fallback classification
    return {
      type: 'Other',
      confidence: 0.5,
      keyFields: {}
    }
  }

  async generateFieldEvidence(
    fieldName: string, 
    value: any, 
    emailText: string, 
    documents: string[]
  ): Promise<{
    confidence: number
    sourceLocator: string
    rationale: string
  }> {
    const systemPrompt = `You are an evidence analyst for insurance claims. Identify the source and rationale for extracted field values.`

    const prompt = `Analyze the evidence for this extracted field:

FIELD: ${fieldName}
VALUE: ${value}

SOURCE TEXT:
EMAIL: ${emailText}

DOCUMENTS:
${documents.join('\n\n---\n\n')}

Provide:
1. Confidence score (0-1) for this field extraction
2. Source locator (where in the text this value was found)
3. Brief rationale explaining why this value was extracted`

    const functions: FunctionCall[] = [{
      name: 'analyze_field_evidence',
      description: 'Analyze evidence for extracted field',
      parameters: {
        type: 'object',
        properties: {
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Confidence score for field extraction'
          },
          sourceLocator: {
            type: 'string',
            description: 'Location where value was found (e.g., email_text:100-150, doc1:50-75)'
          },
          rationale: {
            type: 'string',
            description: 'Brief explanation of why this value was extracted'
          }
        },
        required: ['confidence', 'sourceLocator', 'rationale']
      }
    }]

    const response = await this.callLLM(prompt, systemPrompt, functions)
    
    if (response.functionCalls && response.functionCalls.length > 0) {
      const args = response.functionCalls[0].arguments
      return {
        confidence: args.confidence || 0.7,
        sourceLocator: args.sourceLocator || 'text_inference',
        rationale: args.rationale || 'Inferred from document context'
      }
    }
    
    // Fallback evidence
    return {
      confidence: 0.7,
      sourceLocator: 'text_inference',
      rationale: 'Inferred from document context'
    }
  }

  async queryPolicyDatabase(
    lossType: string,
    description: string,
    extractedFields: Record<string, any>
  ): Promise<Array<{
    clauseId: string
    title: string
    similarity: number
    rationale: string
  }>> {
    const systemPrompt = `You are a policy database search expert. Given claim information, identify the most relevant policy clauses.`

    const prompt = `Find relevant policy clauses for this claim:

LOSS TYPE: ${lossType}
DESCRIPTION: ${description}
EXTRACTED FIELDS: ${JSON.stringify(extractedFields, null, 2)}

Based on this information, identify which of these policy clauses are most relevant:

AUTO INSURANCE:
- AUTO-COL-001: Collision Coverage - covers vehicle collisions
- AUTO-LIAB-001: Bodily Injury Liability - covers injury to others
- AUTO-PD-001: Property Damage Liability - covers damage to others' property

HOMEOWNERS:
- HO-WATER-001: Water Damage Coverage - covers sudden water damage
- HO-STORM-001: Wind and Hail Coverage - covers storm damage

COMMERCIAL LIABILITY:
- CGL-SLIP-001: Premises Liability Coverage - covers slip and fall
- CGL-MED-001: Medical Payments Coverage - covers medical expenses

Return the top 3 most relevant clauses with similarity scores.`

    const functions: FunctionCall[] = [{
      name: 'query_policy_clauses',
      description: 'Find relevant policy clauses for the claim',
      parameters: {
        type: 'object',
        properties: {
          relevantClauses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                clauseId: { type: 'string', description: 'Policy clause ID' },
                title: { type: 'string', description: 'Clause title' },
                similarity: { 
                  type: 'number', 
                  minimum: 0, 
                  maximum: 1,
                  description: 'Similarity score to the claim'
                },
                rationale: { type: 'string', description: 'Why this clause is relevant' }
              },
              required: ['clauseId', 'title', 'similarity', 'rationale']
            },
            maxItems: 3
          }
        },
        required: ['relevantClauses']
      }
    }]

    const response = await this.callLLM(prompt, systemPrompt, functions)
    
    if (response.functionCalls && response.functionCalls.length > 0) {
      return response.functionCalls[0].arguments.relevantClauses || []
    }
    
    return []
  }

  async summarizeProcessing(
    extractedFields: Record<string, any>,
    documents: any[],
    policyHits: any[]
  ): Promise<{
    summary: string
    recommendations: string[]
    riskFlags: string[]
  }> {
    const systemPrompt = `You are a claims processing supervisor. Summarize the automated processing results and provide recommendations.`

    const prompt = `Summarize this automated claim processing:

EXTRACTED FIELDS:
${JSON.stringify(extractedFields, null, 2)}

DOCUMENTS PROCESSED: ${documents.length}
DOCUMENT TYPES: ${documents.map(d => d.type).join(', ')}

POLICY HITS: ${policyHits.length}
TOP POLICY MATCH: ${policyHits[0]?.title || 'None'}

Provide:
1. A brief summary of the claim
2. Recommendations for next steps
3. Any risk flags or concerns`

    const functions: FunctionCall[] = [{
      name: 'summarize_claim_processing',
      description: 'Summarize claim processing results',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Brief summary of the claim and processing'
          },
          recommendations: {
            type: 'array',
            items: { type: 'string' },
            description: 'Recommended next steps'
          },
          riskFlags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Risk flags or concerns identified'
          }
        },
        required: ['summary', 'recommendations', 'riskFlags']
      }
    }]

    const response = await this.callLLM(prompt, systemPrompt, functions)
    
    if (response.functionCalls && response.functionCalls.length > 0) {
      const args = response.functionCalls[0].arguments
      return {
        summary: args.summary || 'Claim processed automatically with extracted information.',
        recommendations: args.recommendations || ['Review extracted information', 'Verify policy coverage'],
        riskFlags: args.riskFlags || []
      }
    }
    
    return {
      summary: 'Claim processed automatically with extracted information.',
      recommendations: ['Review extracted information', 'Verify policy coverage'],
      riskFlags: []
    }
  }
}

// Export singleton instance
export const openaiService = new OpenAIService()