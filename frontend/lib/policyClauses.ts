/**
 * Policy clauses database — ISO form references and market-standard language.
 * Clauses align with ISO Personal Auto Policy (PAP), ISO HO-3, and ISO CGL forms.
 */

import type { PolicyHit } from '@/types/claims'

export interface PolicyClause {
  clauseId: string
  formRef: string
  title: string
  section: string
  content: string
  lossTypes: string[]
  productTypes: string[]
  /** When set, claim must include this peril or clause is excluded (avoids theft matching water claims) */
  primaryPeril?: string
}

const POLICY_CLAUSES: PolicyClause[] = [
  {
    clauseId: 'PAP-D-001',
    formRef: 'ISO PAP 2018',
    title: 'Part D – Coverage for Damage to Your Auto (Collision)',
    section: 'Part D – Physical Damage',
    content:
      'We will pay for direct and accidental loss to your covered auto caused by collision. "Collision" means the upset of your covered auto or its impact with another vehicle or object. Our limit of liability for loss will be the lesser of: (1) the actual cash value of the stolen or damaged property; or (2) the amount necessary to repair or replace the property with other property of like kind and quality. The deductible shown in the Declarations applies to each loss.',
    lossTypes: ['collision', 'autocollision', 'auto'],
    productTypes: ['auto', 'ac'],
  },
  {
    clauseId: 'PAP-A-002',
    formRef: 'ISO PAP 2018',
    title: 'Part A – Liability Coverage (Bodily Injury)',
    section: 'Part A – Liability',
    content:
      'We will pay damages for bodily injury or death for which any insured becomes legally responsible because of an auto accident. Damages include prejudgment interest awarded against the insured. We will settle or defend, as we consider appropriate, any claim or suit asking for these damages. In addition to our limit of liability, we will pay all defense costs we incur. Our duty to settle or defend ends when our limit of liability for this coverage has been exhausted by payment of judgments or settlements.',
    lossTypes: ['collision', 'autocollision', 'liability', 'bodily injury'],
    productTypes: ['auto', 'ac', 'cl'],
  },
  {
    clauseId: 'PAP-C-003',
    formRef: 'ISO PAP 2018',
    title: 'Part C – Uninsured Motorists Coverage',
    section: 'Part C – Uninsured Motorists',
    content:
      'We will pay compensatory damages which an insured is legally entitled to recover from the owner or operator of an uninsured motor vehicle because of bodily injury sustained by an insured caused by an accident. The owner\'s or operator\'s liability for these damages must arise out of the ownership, maintenance or use of the uninsured motor vehicle. Any judgment for damages arising out of a suit brought without our written consent is not binding on us.',
    lossTypes: ['collision', 'autocollision'],
    productTypes: ['auto', 'ac'],
  },
  {
    clauseId: 'HO3-I-004',
    formRef: 'ISO HO-3 2011',
    title: 'Section I – Accidental Discharge or Overflow of Water',
    section: 'Section I – Perils Insured Against (Coverage A & B)',
    content:
      'We insure for direct physical loss to property described in Coverages A and B caused by: (8) Accidental discharge or overflow of water or steam from within a plumbing, heating, air conditioning or automatic fire protective sprinkler system or from within a household appliance, on the residence premises. This includes the cost to tear out and replace any part of a building necessary to repair the system or appliance from which the water or steam escaped. We do not cover loss to the system or appliance from which the water or steam escaped, or loss caused by or resulting from freezing except as provided in the Freezing of Plumbing peril. We do not cover loss from constant or repeated seepage or leakage over a period of 14 or more days.',
    lossTypes: ['water', 'propertydamage', 'property'],
    productTypes: ['home', 'ho', 'property'],
  },
  {
    clauseId: 'HO3-I-005',
    formRef: 'ISO HO-3 2011',
    title: 'Section I – Windstorm or Hail',
    section: 'Section I – Perils Insured Against',
    content:
      'We insure for direct physical loss to property described in Coverages A and B caused by: (1) Windstorm or hail. This includes damage to roofs, siding, and other exterior surfaces. Tree limb or debris impact to the roof resulting in water intrusion is covered when windstorm or hail is the proximate cause of the damage. We do not cover loss to the interior of a building or the property inside it unless the wind or hail first damages the building, allowing the wind or hail to enter.',
    lossTypes: ['water', 'propertydamage', 'property', 'storm'],
    productTypes: ['home', 'ho', 'property'],
  },
  {
    clauseId: 'HO3-I-006',
    formRef: 'ISO HO-3 2011',
    title: 'Section I – Deductible',
    section: 'Section I – Conditions',
    content:
      'Our payment for loss will be the amount of loss minus your deductible. The deductible applies per occurrence. For loss caused by windstorm or hail, a separate windstorm or hail deductible may apply as shown in the Declarations. This deductible is calculated as a percentage of the Coverage A limit of liability. For all other covered perils, the deductible shown in the Declarations applies. No deductible applies to loss from theft.',
    lossTypes: ['water', 'fire', 'theft', 'propertydamage', 'collision'],
    productTypes: ['home', 'ho', 'auto', 'ac'],
  },
  {
    clauseId: 'HO3-I-007',
    formRef: 'ISO HO-3 2011',
    primaryPeril: 'fire',
    title: 'Section I – Fire or Lightning',
    section: 'Section I – Perils Insured Against',
    content:
      'We insure for direct physical loss to property described in Coverages A and B caused by: (2) Fire or lightning. This includes loss from smoke, scorching, or other damage caused by fire or lightning. We also cover loss from water or other substances used to extinguish the fire. We cover the cost of debris removal resulting from a loss we cover. We do not cover loss caused by fire resulting from agricultural smudging or industrial operations.',
    lossTypes: ['fire'],
    productTypes: ['home', 'ho', 'property'],
  },
  {
    clauseId: 'HO3-I-008',
    formRef: 'ISO HO-3 2011',
    primaryPeril: 'theft',
    title: 'Section I – Theft',
    section: 'Section I – Perils Insured Against',
    content:
      'We insure for direct physical loss to property described in Coverages A and B caused by: (11) Theft, including attempted theft. We also cover loss of property from a known place when it is likely that the property has been stolen. We do not cover loss caused by theft committed by an insured. Proof of loss may require you to furnish a copy of the police report. We may require you to submit to examination under oath.',
    lossTypes: ['theft'],
    productTypes: ['home', 'ho', 'property'],
  },
  {
    clauseId: 'CGL-A-009',
    formRef: 'ISO CG 00 01',
    title: 'Coverage A – Bodily Injury and Property Damage Liability',
    section: 'Coverage A – Insuring Agreement',
    content:
      'We will pay those sums that the insured becomes legally obligated to pay as damages because of "bodily injury" or "property damage" to which this insurance applies. We will have the right and duty to defend the insured against any "suit" seeking those damages. However, we will have no duty to defend the insured against any "suit" seeking damages for "bodily injury" or "property damage" to which this insurance does not apply. We may, at our discretion, investigate any "occurrence" and settle any claim or "suit" that may result. Our duty to settle or defend ends when we have used up the applicable limit of insurance in the payment of judgments or settlements.',
    lossTypes: ['liability', 'slip and fall', 'bodily injury'],
    productTypes: ['commercial', 'cl'],
  },
  {
    clauseId: 'CGL-A-010',
    formRef: 'ISO CG 00 01',
    title: 'Coverage A – Premises and Operations',
    section: 'Coverage A – Bodily Injury and Property Damage',
    content:
      'This insurance applies to "bodily injury" and "property damage" only if: (1) The "bodily injury" or "property damage" is caused by an "occurrence" that takes place in the "coverage territory"; (2) The "bodily injury" or "property damage" occurs during the policy period; and (3) Prior to the policy period, no insured listed under Paragraph 1. of Section II – Who Is An Insured and no "employee" authorized by you to give or receive notice of an "occurrence" or claim, knew that the "bodily injury" or "property damage" had occurred. "Occurrence" means an accident, including continuous or repeated exposure to substantially the same general harmful conditions. Premises liability, including slip, trip and fall incidents on your premises, falls within this coverage.',
    lossTypes: ['liability', 'slip and fall', 'premises'],
    productTypes: ['commercial', 'cl'],
  },
  {
    clauseId: 'GEN-011',
    formRef: 'Standard Conditions',
    title: 'Duties in the Event of Loss',
    section: 'Conditions – Notice and Cooperation',
    content:
      'You must see that the following are done in the event of loss: (a) Give prompt notice to us or our agent; (b) Give a description of how, when and where the loss occurred; (c) Take all reasonable steps to protect the property from further damage, and keep a record of your expenses for consideration in the settlement of the claim; (d) As often as we reasonably require, show the damaged property and provide us with records and documents we request; (e) Submit to examination under oath if we require it.',
    lossTypes: ['collision', 'water', 'fire', 'theft', 'liability', 'propertydamage', 'other'],
    productTypes: ['auto', 'home', 'commercial', 'ac', 'ho', 'cl'],
  },
  {
    clauseId: 'GEN-012',
    formRef: 'Standard Conditions',
    title: 'Loss Payment',
    section: 'Conditions – Settlement',
    content:
      'We will pay for covered loss within 30 days after we receive your proof of loss, if you have complied with all of the terms of this policy and: (a) We have reached agreement with you on the amount of loss; or (b) An appraisal award has been made. We will pay only for the actual cash value of the damage until actual repair or replacement is complete. Once actual repair or replacement is complete, we will pay the amount you actually spend that is necessary to complete the repair or replacement.',
    lossTypes: ['collision', 'water', 'fire', 'theft', 'liability', 'other'],
    productTypes: ['auto', 'home', 'commercial', 'ac', 'ho', 'cl'],
  },
]

function inferProductTypes(policyNumber: string): string[] {
  const p = (policyNumber || '').toUpperCase().replace(/\*+/g, '').trim()
  if (p.startsWith('AC') || p.startsWith('AUTO')) return ['auto', 'ac']
  if (p.startsWith('HO') || p.startsWith('HP') || p.startsWith('PROP')) return ['home', 'ho', 'property']
  if (p.startsWith('CL') || p.startsWith('GL') || p.startsWith('COM')) return ['commercial', 'cl']
  return ['auto', 'home', 'commercial', 'ac', 'ho', 'cl']
}

function inferLossTypes(lossType: string, description?: string): string[] {
  const types = new Set<string>()
  const lt = (lossType || '').toLowerCase()
  const desc = (description || '').toLowerCase()
  const combined = `${lt} ${desc}`

  if (/\b(collision|auto|autocollision|accident|vehicle|car)\b/.test(combined)) {
    types.add('collision').add('autocollision').add('auto')
  }
  if (/\b(water|leak|flood|storm|roof|intrusion|ceiling|pipe)\b/.test(combined)) {
    types.add('water').add('propertydamage').add('property')
  }
  if (/\b(fire|smoke)\b/.test(combined)) types.add('fire').add('propertydamage')
  if (/\b(theft|stolen)\b/.test(combined)) types.add('theft').add('propertydamage')
  if (/\b(liability|slip|fall|premises|customer|restaurant|business)\b/.test(combined)) {
    types.add('liability').add('slip and fall').add('premises')
  }
  if (/\b(property|home|house|property damage)\b/.test(combined)) {
    types.add('property').add('propertydamage')
  }

  if (types.size === 0) {
    if (lt) types.add(lt.replace(/\s+/g, ''))
    types.add('other')
  }
  return Array.from(types)
}

function computeSimilarity(
  clause: PolicyClause,
  lossTypes: string[],
  productTypes: string[]
): number {
  const claimLossSet = new Set(lossTypes.map((t) => t.toLowerCase()))

  // Peril-specific clauses (e.g. Theft, Fire) must match their primary peril
  if (clause.primaryPeril) {
    const required = clause.primaryPeril.toLowerCase()
    if (!claimLossSet.has(required) && ![...claimLossSet].some((lt) => lt.includes(required) || required.includes(lt))) {
      return 0
    }
  }

  let score = 0.5
  const clauseLoss = clause.lossTypes.map((t) => t.toLowerCase())
  const clauseProduct = clause.productTypes.map((t) => t.toLowerCase())
  for (const lt of lossTypes) {
    if (clauseLoss.some((c) => c.includes(lt) || lt.includes(c))) {
      score += 0.28
      break
    }
  }
  for (const pt of productTypes) {
    if (clauseProduct.some((c) => c.includes(pt) || pt.includes(c))) {
      score += 0.2
      break
    }
  }
  return Math.min(0.97, score)
}

function buildRationale(clause: PolicyClause, lossType: string, policyNumber: string): string {
  const parts: string[] = [clause.formRef]
  if (lossType) parts.push(`Loss type: ${lossType}`)
  if (policyNumber) parts.push('Product type applicable')
  return parts.join(' • ')
}

/**
 * Get policy grounding (matching clauses) based on extracted claim fields.
 */
export function getPolicyGrounding(extractedFields: Record<string, unknown>): PolicyHit[] {
  const policyNumber = String(extractedFields.policyNumber || '').replace(/\*+/g, '').trim()
  const lossType = String(extractedFields.lossType || 'Other').trim()
  const description = String(extractedFields.description || '')

  const productTypes = policyNumber ? inferProductTypes(policyNumber) : ['auto', 'home', 'commercial', 'ac', 'ho', 'cl']
  const lossTypes = inferLossTypes(lossType, description)

  const scored = POLICY_CLAUSES.map((clause) => {
    const similarity = computeSimilarity(clause, lossTypes, productTypes)
    return {
      ...clause,
      similarity,
      rationale: buildRationale(clause, lossType, policyNumber),
    }
  })

  scored.sort((a, b) => b.similarity - a.similarity)
  const hits = scored.slice(0, 6).filter((s) => s.similarity >= 0.6)

  return hits.map((c) => ({
    clauseId: c.clauseId,
    title: c.title,
    snippet: c.content.slice(0, 140) + (c.content.length > 140 ? '...' : ''),
    content: c.content,
    section: c.section,
    score: c.similarity,
    similarity: c.similarity,
    rationale: c.rationale,
    sourceRef: c.formRef,
    sourceDocument: 'Policy Schedule',
  }))
}
