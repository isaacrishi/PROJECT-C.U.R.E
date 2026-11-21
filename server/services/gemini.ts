import { GoogleGenAI, Type } from '@google/genai';
import { searchIntegratedLiterature, type LiteratureResult } from './literature.js';
import type { CitationAuditResult } from '../../src/types.js';

export function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientGeminiError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVERLOADED') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('FETCH FAILED')
  );
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function safeParseGeminiJson<T = Record<string, unknown>>(rawText: string | undefined | null): T {
  const cleaned = (rawText ?? '').trim();
  if (!cleaned) {
    throw new Error('Model returned an empty JSON response.');
  }
  const unfenced = cleaned
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced) as T;
  } catch {
    const firstBrace = unfenced.indexOf('{');
    const lastBrace = unfenced.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(unfenced.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('Model returned malformed JSON that could not be parsed safely.');
  }
}

export async function callGeminiWithFailover(params: {
  ai: GoogleGenAI;
  primaryModel?: string;
  contents: string;
  config: Record<string, unknown>;
  onStage?: (stage: string, detail: string) => void;
}) {
  const requested = params.primaryModel || 'gemini-4-hydrogen';
  const backoffDelays = [650, 1400];
  let lastError: unknown;

  for (let attempt = 0; attempt <= backoffDelays.length; attempt++) {
    try {
      const response = await params.ai.models.generateContent({
        model: requested,
        contents: params.contents,
        config: params.config,
      });
      return {
        response,
        modelUsed: requested,
        failoverTriggered: attempt > 0,
        failoverNote:
          attempt > 0
            ? `Recovered on retry #${attempt} using ${requested} after transient upstream availability error.`
            : undefined,
      };
    } catch (err) {
      lastError = err;
      if (!isTransientGeminiError(err) || attempt === backoffDelays.length) {
        break;
      }
      const waitMs = backoffDelays[attempt];
      params.onStage?.(
        'failover_retry',
        `Upstream model ${requested} returned transient 429/503. Retrying in ${waitMs}ms (attempt ${attempt + 1}/${backoffDelays.length})...`
      );
      await delayMs(waitMs);
    }
  }

  // Only fail over horizontally/downward within free-tier text models (never upgrade to paid models)
  if (requested === 'gemini-4-hydrogen' && isTransientGeminiError(lastError)) {
    const fallbackModel = 'gemini-3.1-flash-lite';
    params.onStage?.(
      'failover_fallback',
      `Primary model ${requested} remained unavailable; failing over cleanly to ${fallbackModel}.`
    );
    const response = await params.ai.models.generateContent({
      model: fallbackModel,
      contents: params.contents,
      config: params.config,
    });
    return {
      response,
      modelUsed: fallbackModel,
      failoverTriggered: true,
      failoverNote: `Primary model ${requested} experienced upstream 503/429 after retries; automatically failed over to ${fallbackModel}.`,
    };
  }

  throw lastError;
}

export interface StructuredInvestigationOutput {
  step1_question_understanding: string;
  step2_biological_domain: string[];
  step3_evidence_needed: string[];
  step4_retrieved_sources_summary: string;
  step5_source_quality_and_limitations: string;
  step6_biological_relationships: string;
  step7_conflicting_evidence_uncertainties: string;
  step8_candidate_hypotheses: Array<{
    title: string;
    proposed_mechanism: string;
    relevant_genes: string[];
    validation_approach: string;
  }>;
  step9_confidence_assessment: {
    level: 'high_established' | 'moderate_peer_reviewed' | 'low_preliminary' | 'insufficient_evidence';
    rationale: string;
  };
  step10_findings_and_references: {
    summary: string;
    traceable_citations: Array<{
      identifier: string;
      title: string;
      evidence_class: string;
      url: string;
    }>;
  };
  unresolved_questions: string[];
  insufficient_evidence_flag: boolean;
}

function extractIdentifiersFromText(text: string): string[] {
  const found: string[] = [];
  const pmidRe = /\bPMID[:\s#-]*(\d{6,9})\b/gi;
  const pmcRe = /\b(PMC\d{5,9})\b/gi;
  const nctRe = /\b(NCT\d{8})\b/gi;
  const doiRe = /\b(10\.\d{4,9}\/[^\s,;)\]"'<>]+)/gi;

  for (const m of text.matchAll(pmidRe)) found.push(`PMID:${m[1]}`);
  for (const m of text.matchAll(pmcRe)) found.push(m[1].toUpperCase());
  for (const m of text.matchAll(nctRe)) found.push(m[1].toUpperCase());
  for (const m of text.matchAll(doiRe)) found.push(`DOI:${m[1].replace(/[.,;]+$/, '').toLowerCase()}`);
  return found;
}

function normalizeIdentifier(raw: string): string {
  const s = raw.trim();
  const pmid = s.match(/^(?:PMID[:\s#-]*)?(\d{6,9})$/i);
  if (pmid) return `PMID:${pmid[1]}`;
  const pmc = s.match(/^(PMC\d{5,9})$/i);
  if (pmc) return pmc[1].toUpperCase();
  const nct = s.match(/^(NCT\d{8})$/i);
  if (nct) return nct[1].toUpperCase();
  const doi = s.replace(/^DOI[:\s]*/i, '').replace(/[.,;]+$/, '');
  if (/^10\.\d{4,9}\//i.test(doi)) return `DOI:${doi.toLowerCase()}`;
  return s.toUpperCase();
}

export function auditGeneratedCitations(
  structured: StructuredInvestigationOutput,
  verifiedCorpus: Array<{ identifier: string; title: string; url: string }>
): CitationAuditResult {
  const knownNormalized = new Set<string>();
  for (const item of verifiedCorpus) {
    if (item.identifier) knownNormalized.add(normalizeIdentifier(item.identifier));
    for (const id of extractIdentifiersFromText(`${item.identifier} ${item.title} ${item.url}`)) {
      knownNormalized.add(normalizeIdentifier(id));
    }
  }

  const flaggedUngrounded = new Set<string>();
  let strippedCount = 0;

  const originalCitations = structured.step10_findings_and_references?.traceable_citations ?? [];
  const groundedCitations = originalCitations.filter((cit) => {
    const norm = normalizeIdentifier(cit.identifier || '');
    const extracted = extractIdentifiersFromText(`${cit.identifier} ${cit.url}`).map(normalizeIdentifier);
    const isKnown =
      knownNormalized.has(norm) ||
      extracted.some((ex) => knownNormalized.has(ex));

    // Allow explicitly non-ID textbook biology attribution only if not claiming a fake PMID/DOI/NCT
    const looksLikeExternalId = /^(PMID:|DOI:|PMC\d|NCT\d|10\.\d{4,9}\/)/i.test(cit.identifier?.trim() || '');
    if (looksLikeExternalId && !isKnown) {
      flaggedUngrounded.add(cit.identifier);
      strippedCount++;
      return false;
    }
    if (!looksLikeExternalId && !isKnown && knownNormalized.size > 0) {
      // Check if title matches something in corpus
      const titleMatch = verifiedCorpus.some(
        (v) => v.title.toLowerCase() === (cit.title || '').toLowerCase()
      );
      if (!titleMatch) {
        flaggedUngrounded.add(cit.identifier || cit.title);
        strippedCount++;
        return false;
      }
    }
    return true;
  });

  if (structured.step10_findings_and_references) {
    structured.step10_findings_and_references.traceable_citations = groundedCitations;
  }

  // Also scan prose sections for ungrounded external identifiers emitted inline
  const proseCorpus = [
    structured.step4_retrieved_sources_summary,
    structured.step6_biological_relationships,
    structured.step7_conflicting_evidence_uncertainties,
    structured.step10_findings_and_references?.summary,
  ]
    .filter(Boolean)
    .join('\n');

  const verifiedSet = new Set<string>();
  for (const cit of groundedCitations) {
    verifiedSet.add(cit.identifier);
  }
  for (const id of extractIdentifiersFromText(proseCorpus)) {
    const norm = normalizeIdentifier(id);
    if (knownNormalized.has(norm)) {
      verifiedSet.add(id);
    } else {
      flaggedUngrounded.add(id);
    }
  }

  return {
    verifiedCount: verifiedSet.size,
    strippedCount,
    flaggedUngrounded: Array.from(flaggedUngrounded),
    corpusSize: verifiedCorpus.length,
    auditPassed: flaggedUngrounded.size === 0 && strippedCount === 0,
  };
}

export async function runStructuredResearchInvestigation(params: {
  model: string;
  question: string;
  objectives: string;
  cancerType: string;
  mechanisms: string[];
  projectContextSummary: string;
  libraryCitations: Array<{ identifier: string; title: string; abstract: string; url: string; pub_type: string }>;
  liveGroundingEnabled: boolean;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  onStage?: (stage: string, detail: string) => void;
}): Promise<{
  structured: StructuredInvestigationOutput;
  retrievedLiterature: LiteratureResult[];
  literatureErrors: Array<{ source: string; message: string }>;
  tokensUsed: number;
  latencyMs: number;
  modelUsed: string;
  failoverTriggered: boolean;
  failoverNote?: string;
  citationAudit: CitationAuditResult;
}> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured in server environment. Configure it in Secrets to activate the AI Research Engine.');
  }

  let retrievedLiterature: LiteratureResult[] = [];
  let literatureErrors: Array<{ source: string; message: string }> = [];

  if (params.liveGroundingEnabled) {
    params.onStage?.('grounding_literature', 'Querying live PubMed E-utilities and Europe PMC corpora...');
    const searchQuery = [params.cancerType, params.question].filter(Boolean).join(' ').slice(0, 180);
    const litResp = await searchIntegratedLiterature({
      query: searchQuery,
      sources: ['pubmed', 'europepmc'],
      maxPerSource: 4,
    });
    retrievedLiterature = litResp.results;
    literatureErrors = litResp.errors;
  }

  const verifiedCorpus = [
    ...params.libraryCitations.map((c) => ({
      identifier: c.identifier,
      title: c.title,
      type: c.pub_type,
      url: c.url,
      abstract: c.abstract.slice(0, 800),
      origin: 'Project Research Library',
    })),
    ...retrievedLiterature.map((r) => ({
      identifier: r.pmid ? `PMID:${r.pmid}` : r.doi ? `DOI:${r.doi}` : r.external_id,
      title: r.title,
      type: `${r.source_db} (${r.pub_type}${r.is_preprint ? ', PREPRINT' : ''})`,
      url: r.url,
      abstract: r.abstract.slice(0, 800),
      origin: `Live ${r.source_db} retrieval`,
    })),
  ];

  params.onStage?.(
    'constructing_prompt',
    `Assembled ${verifiedCorpus.length} verified corpus source(s); enforcing scientific integrity schema.`
  );

  const systemInstruction = `You are PROJECT C.U.R.E. (Continuous Understanding and Research Engine), an AI-assisted biomedical cancer research intelligence system designed strictly for qualified scientific researchers.

CRITICAL SCIENTIFIC INTEGRITY RULES:
1. NEVER provide medical advice, clinical diagnosis, or treatment recommendations for patients.
2. NEVER fabricate PMIDs, DOIs, NCT IDs, paper titles, authors, or numerical results.
3. ONLY cite identifiers (PMID, DOI, PMCID) that appear explicitly in the VERIFIED RETRIEVED SOURCES provided below or clearly state when relying on general established textbook biology without inventing a citation ID.
4. Distinguish clearly between: Established scientific knowledge, Peer-reviewed findings, Preliminary research / preprints, Observational associations, Computational predictions, AI-generated hypotheses, and Experimentally validated discoveries.
5. NEVER represent correlation as causation or an AI-generated hypothesis as an established finding.
6. If the retrieved literature and project context do not contain enough evidence to answer a specific empirical question reliably, set insufficient_evidence_flag = true and explicitly include "INSUFFICIENT SCIENTIFIC EVIDENCE." in your summary.
7. Execute the 10-step research workflow concisely and transparently, exposing methods, assumptions, limitations, and uncertainties without claiming independent experimental validation.`;

  const promptPayload = {
    active_research_question: params.question,
    objectives: params.objectives || 'Exploratory mechanistic investigation',
    cancer_type: params.cancerType || 'Not specified',
    biological_mechanisms: params.mechanisms,
    project_context: params.projectContextSummary,
    prior_conversation_turns: params.history.slice(-6),
    verified_retrieved_sources: verifiedCorpus,
    live_retrieval_errors: literatureErrors,
  };

  params.onStage?.('invoking_gemini', `Running 10-step structured synthesis on ${params.model || 'gemini-4-hydrogen'}...`);

  const started = Date.now();
  const { response, modelUsed, failoverTriggered, failoverNote } = await callGeminiWithFailover({
    ai,
    primaryModel: params.model || 'gemini-4-hydrogen',
    contents: `Analyze the following cancer research investigation payload and return a rigorous 10-step scientific analysis JSON:\n\n${JSON.stringify(
      promptPayload,
      null,
      2
    )}`,
    onStage: params.onStage,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          step1_question_understanding: { type: Type.STRING },
          step2_biological_domain: { type: Type.ARRAY, items: { type: Type.STRING } },
          step3_evidence_needed: { type: Type.ARRAY, items: { type: Type.STRING } },
          step4_retrieved_sources_summary: { type: Type.STRING },
          step5_source_quality_and_limitations: { type: Type.STRING },
          step6_biological_relationships: { type: Type.STRING },
          step7_conflicting_evidence_uncertainties: { type: Type.STRING },
          step8_candidate_hypotheses: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                proposed_mechanism: { type: Type.STRING },
                relevant_genes: { type: Type.ARRAY, items: { type: Type.STRING } },
                validation_approach: { type: Type.STRING },
              },
              required: ['title', 'proposed_mechanism', 'relevant_genes', 'validation_approach'],
            },
          },
          step9_confidence_assessment: {
            type: Type.OBJECT,
            properties: {
              level: { type: Type.STRING },
              rationale: { type: Type.STRING },
            },
            required: ['level', 'rationale'],
          },
          step10_findings_and_references: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              traceable_citations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    identifier: { type: Type.STRING },
                    title: { type: Type.STRING },
                    evidence_class: { type: Type.STRING },
                    url: { type: Type.STRING },
                  },
                  required: ['identifier', 'title', 'evidence_class', 'url'],
                },
              },
            },
            required: ['summary', 'traceable_citations'],
          },
          unresolved_questions: { type: Type.ARRAY, items: { type: Type.STRING } },
          insufficient_evidence_flag: { type: Type.BOOLEAN },
        },
        required: [
          'step1_question_understanding',
          'step2_biological_domain',
          'step3_evidence_needed',
          'step4_retrieved_sources_summary',
          'step5_source_quality_and_limitations',
          'step6_biological_relationships',
          'step7_conflicting_evidence_uncertainties',
          'step8_candidate_hypotheses',
          'step9_confidence_assessment',
          'step10_findings_and_references',
          'unresolved_questions',
          'insufficient_evidence_flag',
        ],
      },
    },
  });

  const latencyMs = Date.now() - started;
  const structured = safeParseGeminiJson<StructuredInvestigationOutput>(response.text);
  const tokensUsed = response.usageMetadata?.totalTokenCount ?? 0;

  params.onStage?.('auditing_citations', 'Auditing all generated PMID/DOI/NCT citations against retrieved corpus...');
  const citationAudit = auditGeneratedCitations(structured, verifiedCorpus);

  return {
    structured,
    retrievedLiterature,
    literatureErrors,
    tokensUsed,
    latencyMs,
    modelUsed,
    failoverTriggered,
    failoverNote,
    citationAudit,
  };
}

export async function analyzeLiteratureCorpus(params: {
  model: string;
  articles: Array<{ identifier: string; title: string; abstract: string; pub_type: string; pub_date: string }>;
  focusQuestion?: string;
}) {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const started = Date.now();
  const { response, modelUsed, failoverTriggered, failoverNote } = await callGeminiWithFailover({
    ai,
    primaryModel: params.model || 'gemini-4-hydrogen',
    contents: `Compare and synthesise these retrieved scientific abstracts/metadata. Explicitly note that full text was not parsed unless stated, identify recurring findings, conflicting evidence, methodological limitations, and extract structured findings per article.\n\nFocus: ${
      params.focusQuestion || 'General oncology evidence synthesis'
    }\n\nArticles:\n${JSON.stringify(params.articles, null, 2)}`,
    config: {
      systemInstruction:
        'You are a biomedical literature analyst. Never fabricate citations or extrapolate claims absent from the supplied abstracts. Clearly separate abstract-only observations from full-text claims.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          recurring_findings: { type: Type.ARRAY, items: { type: Type.STRING } },
          conflicting_findings: { type: Type.ARRAY, items: { type: Type.STRING } },
          overall_limitations: { type: Type.ARRAY, items: { type: Type.STRING } },
          per_article_notes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                identifier: { type: Type.STRING },
                methodology: { type: Type.STRING },
                main_findings: { type: Type.STRING },
                limitations: { type: Type.STRING },
              },
              required: ['identifier', 'methodology', 'main_findings', 'limitations'],
            },
          },
        },
        required: ['recurring_findings', 'conflicting_findings', 'overall_limitations', 'per_article_notes'],
      },
    },
  });

  return {
    analysis: safeParseGeminiJson(response.text),
    tokensUsed: response.usageMetadata?.totalTokenCount ?? 0,
    latencyMs: Date.now() - started,
    modelUsed,
    failoverTriggered,
    failoverNote,
  };
}

export async function evaluateResearchOutput(params: {
  model: string;
  claimText: string;
  knownCitations: Array<{ identifier: string; title: string; abstract: string }>;
}) {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  const started = Date.now();
  const { response, modelUsed, failoverTriggered, failoverNote } = await callGeminiWithFailover({
    ai,
    primaryModel: params.model || 'gemini-4-hydrogen',
    contents: `Audit the following scientific text or hypothesis against the provided verified library sources for: (1) citation verification, (2) scientific consistency, (3) contradictory evidence, (4) unsupported claims or correlation-vs-causation leaps.\n\nText to Audit:\n${params.claimText}\n\nVerified Sources:\n${JSON.stringify(
      params.knownCitations,
      null,
      2
    )}`,
    config: {
      systemInstruction:
        'You are a strict scientific peer-review evaluator. Flag any claim lacking citation support in the provided verified sources.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          citation_verified: { type: Type.BOOLEAN },
          consistency_score: { type: Type.NUMBER },
          unsupported_claims: { type: Type.ARRAY, items: { type: Type.STRING } },
          contradictory_notes: { type: Type.STRING },
          reproducibility_assessment: { type: Type.STRING },
        },
        required: [
          'citation_verified',
          'consistency_score',
          'unsupported_claims',
          'contradictory_notes',
          'reproducibility_assessment',
        ],
      },
    },
  });

  return {
    evaluation: safeParseGeminiJson<{
      citation_verified?: boolean;
      consistency_score?: number;
      unsupported_claims?: string[];
      contradictory_notes?: string;
      reproducibility_assessment?: string;
    }>(response.text),
    tokensUsed: response.usageMetadata?.totalTokenCount ?? 0,
    latencyMs: Date.now() - started,
    modelUsed,
    failoverTriggered,
    failoverNote,
  };
}
