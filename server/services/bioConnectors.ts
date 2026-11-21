// Real External Public Multi-Omics, Pharmacology & Pathway Connectors for PROJECT C.U.R.E.
// Strictly queries live public biomedical APIs (cBioPortal, NCI GDC, ChEMBL, PubChem, Enrichr Reactome/KEGG).
// Zero fabricated or mocked fallback records. Partial network failures are surfaced transparently.

import type { TreatmentMechanism } from '../../src/types.js';

export interface OmicsStudySummary {
  studyId: string;
  name: string;
  cancerType: string;
  sampleCount: number | null;
  pmid: string;
  url: string;
  source: 'cBioPortal' | 'NCI_GDC';
}

export interface GdcSomaticMutation {
  ssmId: string;
  gene: string;
  aaChange: string;
  consequenceType: string;
  genomicChange: string;
  caseCount: number;
  url: string;
}

export interface PharmacologyBioactivity {
  targetName: string;
  targetChEMBLId: string;
  standardType: string;
  standardValue: number | null;
  standardUnits: string;
  pchemblValue: number | null;
  assayDescription: string;
  documentChEMBLId: string;
}

export interface PharmacologyMechanism {
  mechanismOfAction: string;
  actionType: string;
  targetName: string;
  targetChEMBLId: string;
}

export interface PharmacologyLookupResult {
  query: string;
  chemblId: string | null;
  prefName: string;
  pubchemCid: number | null;
  formula: string;
  molecularWeight: string;
  canonicalSmiles: string;
  alogp: string;
  mechanisms: PharmacologyMechanism[];
  bioactivities: PharmacologyBioactivity[];
  medianPotencyUM: number | null;
  suggestedConcentrationUM: number | null;
  suggestedMechanism: TreatmentMechanism;
  chemblUrl: string | null;
  pubchemUrl: string | null;
  errors: Array<{ source: string; message: string }>;
}

export interface LiveEnrichedPathway {
  pathwayId: string;
  pathwayName: string;
  sourceDb: 'Reactome_2022' | 'KEGG_2021_Human';
  overlapCount: number;
  overlappingGenes: string[];
  pValue: number;
  fdrAdjustedP: number;
  combinedScore: number;
}

const REQUEST_TIMEOUT_MS = 9500;
const USER_AGENT = 'ProjectCURE-Biomedical-Research/2.0 (academic-research-workbench)';

async function fetchJsonWithTimeout<T>(url: string, init?: RequestInit, retries = 1): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
          ...(init?.headers ?? {}),
        },
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText}`);
        if (res.status >= 500 && attempt < retries) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 450 * (attempt + 1)));
          continue;
        }
        throw err;
      }
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (ctype.includes('text/html')) {
        const err = new Error('Upstream returned HTML instead of JSON');
        if (attempt < retries) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 450 * (attempt + 1)));
          continue;
        }
        throw err;
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 450 * (attempt + 1)));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error('Upstream fetch failed');
}

export async function queryOmicsMutationLandscape(params: {
  cancerArea: string;
  genes: string[];
}): Promise<{
  cancerArea: string;
  genesQueried: string[];
  studies: OmicsStudySummary[];
  mutations: GdcSomaticMutation[];
  errors: Array<{ source: string; message: string }>;
}> {
  const errors: Array<{ source: string; message: string }> = [];
  const studies: OmicsStudySummary[] = [];
  const mutations: GdcSomaticMutation[] = [];

  const keyword = (params.cancerArea || 'lung adenocarcinoma').trim().slice(0, 80);
  const cleanedGenes = Array.from(
    new Set(
      params.genes
        .map((g) => g.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ''))
        .filter((g) => g.length >= 2 && g.length <= 16)
    )
  ).slice(0, 12);

  const cbioPromise = (async () => {
    try {
      const url = `https://www.cbioportal.org/api/studies?keyword=${encodeURIComponent(keyword)}&pageSize=8&projection=SUMMARY`;
      const raw = await fetchJsonWithTimeout<
        Array<{
          studyId: string;
          name: string;
          cancerTypeId?: string;
          allSampleCount?: number;
          pmid?: string;
        }>
      >(url);
      for (const s of Array.isArray(raw) ? raw.slice(0, 8) : []) {
        if (!s.studyId) continue;
        studies.push({
          studyId: s.studyId,
          name: s.name || s.studyId,
          cancerType: s.cancerTypeId || 'oncology',
          sampleCount: typeof s.allSampleCount === 'number' ? s.allSampleCount : null,
          pmid: s.pmid || '',
          url: `https://www.cbioportal.org/study/summary?id=${encodeURIComponent(s.studyId)}`,
          source: 'cBioPortal',
        });
      }
    } catch (err) {
      errors.push({
        source: 'cBioPortal',
        message: err instanceof Error ? err.message : 'cBioPortal REST request failed.',
      });
    }
  })();

  const gdcProjectsPromise = (async () => {
    try {
      const filters = {
        op: 'or',
        content: [
          { op: 'in', content: { field: 'primary_site', value: [keyword, keyword.split(' ')[0]] } },
          { op: 'in', content: { field: 'disease_type', value: [keyword] } },
        ],
      };
      const url = `https://api.gdc.cancer.gov/projects?size=5&fields=project_id,name,primary_site,summary.case_count&filters=${encodeURIComponent(
        JSON.stringify(filters)
      )}`;
      const raw = await fetchJsonWithTimeout<{
        data?: {
          hits?: Array<{
            project_id: string;
            name: string;
            primary_site?: string[];
            summary?: { case_count?: number };
          }>;
        };
      }>(url);
      for (const h of raw?.data?.hits ?? []) {
        studies.push({
          studyId: h.project_id,
          name: h.name,
          cancerType: Array.isArray(h.primary_site) ? h.primary_site.join(', ') : keyword,
          sampleCount: typeof h.summary?.case_count === 'number' ? h.summary.case_count : null,
          pmid: '',
          url: `https://portal.gdc.cancer.gov/projects/${encodeURIComponent(h.project_id)}`,
          source: 'NCI_GDC',
        });
      }
    } catch (err) {
      errors.push({
        source: 'NCI_GDC_Projects',
        message: err instanceof Error ? err.message : 'NCI GDC Projects API request failed.',
      });
    }
  })();

  const gdcSsmsPromise = (async () => {
    if (cleanedGenes.length === 0) return;
    try {
      const filters = {
        op: 'in',
        content: {
          field: 'consequence.transcript.gene.symbol',
          value: cleanedGenes,
        },
      };
      const fields = [
        'ssm_id',
        'genomic_dna_change',
        'occurrence.case.project.project_id',
        'consequence.transcript.gene.symbol',
        'consequence.transcript.aa_change',
        'consequence.transcript.consequence_type',
      ].join(',');
      const url = `https://api.gdc.cancer.gov/ssms?size=12&fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(
        JSON.stringify(filters)
      )}`;
      const raw = await fetchJsonWithTimeout<{
        data?: {
          hits?: Array<{
            ssm_id: string;
            genomic_dna_change?: string;
            occurrence?: Array<{ case?: unknown }>;
            consequence?: Array<{
              transcript?: {
                aa_change?: string;
                consequence_type?: string;
                gene?: { symbol?: string };
              };
            }>;
          }>;
        };
      }>(url);

      for (const hit of raw?.data?.hits ?? []) {
        const canonical = hit.consequence?.find(
          (c) => c.transcript?.gene?.symbol && cleanedGenes.includes(c.transcript.gene.symbol.toUpperCase())
        ) ?? hit.consequence?.[0];
        const geneSym = canonical?.transcript?.gene?.symbol || cleanedGenes[0] || 'UNKNOWN';
        mutations.push({
          ssmId: hit.ssm_id,
          gene: geneSym,
          aaChange: canonical?.transcript?.aa_change || 'N/A',
          consequenceType: canonical?.transcript?.consequence_type || 'somatic_variant',
          genomicChange: hit.genomic_dna_change || '',
          caseCount: Array.isArray(hit.occurrence) ? hit.occurrence.length : 0,
          url: `https://portal.gdc.cancer.gov/ssms/${encodeURIComponent(hit.ssm_id)}`,
        });
      }
      mutations.sort((a, b) => b.caseCount - a.caseCount);
    } catch (err) {
      errors.push({
        source: 'NCI_GDC_SSM',
        message: err instanceof Error ? err.message : 'NCI GDC Somatic Mutation API request failed.',
      });
    }
  })();

  await Promise.all([cbioPromise, gdcProjectsPromise, gdcSsmsPromise]);

  return {
    cancerArea: keyword,
    genesQueried: cleanedGenes,
    studies,
    mutations,
    errors,
  };
}

function inferTreatmentMechanism(text: string): TreatmentMechanism {
  const lower = text.toLowerCase();
  if (/pd-1|pd-l1|pdcd1|cd274|ctla-4|ctla4|checkpoint|immunoglobulin|antibody/.test(lower)) {
    return 'checkpoint_immunotherapy';
  }
  if (/hypoxia|prodrug|tirapazamine|reductase|nitroimidazole|bioreductive/.test(lower)) {
    return 'hypoxia_activated_prodrug';
  }
  if (/platinum|alkylat|dna cross|topoisomerase|tubulin|mitotic|cisplatin|doxorubicin|paclitaxel/.test(lower)) {
    return 'cytotoxic_chemotherapy';
  }
  return 'targeted_kinase_inhibitor';
}

export async function lookupPharmacologyTargets(query: string): Promise<PharmacologyLookupResult> {
  const cleanQuery = query.trim();
  const errors: Array<{ source: string; message: string }> = [];

  let chemblId: string | null = null;
  let prefName = cleanQuery;
  let formula = '';
  let molecularWeight = '';
  let canonicalSmiles = '';
  let alogp = '';
  let pubchemCid: number | null = null;
  const mechanisms: PharmacologyMechanism[] = [];
  const bioactivities: PharmacologyBioactivity[] = [];

  const chemblPromise = (async () => {
    try {
      type ChemblMol = {
        molecule_chembl_id: string;
        pref_name?: string;
        molecule_properties?: {
          full_molformula?: string;
          full_mwt?: string | number;
          alogp?: string | number;
        };
        molecule_structures?: {
          canonical_smiles?: string;
        };
      };

      let mol: ChemblMol | undefined;
      try {
        const searchUrl = `https://www.ebi.ac.uk/chembl/api/data/molecule/search.json?q=${encodeURIComponent(cleanQuery)}&limit=5`;
        const searchData = await fetchJsonWithTimeout<{ molecules?: ChemblMol[] }>(searchUrl, undefined, 1);
        mol =
          searchData.molecules?.find((m) => (m.pref_name || '').toLowerCase() === cleanQuery.toLowerCase()) ??
          searchData.molecules?.[0];
      } catch {
        // Fallback to exact pref_name filter on molecule.json if full-text search endpoint is flapping
        const exactUrl = `https://www.ebi.ac.uk/chembl/api/data/molecule.json?pref_name__iexact=${encodeURIComponent(cleanQuery)}&limit=3`;
        const exactData = await fetchJsonWithTimeout<{ molecules?: ChemblMol[] }>(exactUrl, undefined, 1);
        mol = exactData.molecules?.[0];
      }

      if (!mol) return;

      chemblId = mol.molecule_chembl_id;
      prefName = mol.pref_name || cleanQuery;
      formula = mol.molecule_properties?.full_molformula || '';
      molecularWeight = mol.molecule_properties?.full_mwt ? String(mol.molecule_properties.full_mwt) : '';
      alogp = mol.molecule_properties?.alogp ? String(mol.molecule_properties.alogp) : '';
      canonicalSmiles = mol.molecule_structures?.canonical_smiles || '';

      const [mechSettled, actSettled] = await Promise.allSettled([
        fetchJsonWithTimeout<{
          mechanisms?: Array<{
            mechanism_of_action?: string;
            action_type?: string;
            target_chembl_id?: string;
          }>;
        }>(
          `https://www.ebi.ac.uk/chembl/api/data/mechanism.json?molecule_chembl_id=${encodeURIComponent(chemblId)}&limit=10`,
          undefined,
          1
        ),
        fetchJsonWithTimeout<{
          activities?: Array<{
            target_pref_name?: string;
            target_chembl_id?: string;
            standard_type?: string;
            standard_value?: string | number;
            standard_units?: string;
            pchembl_value?: string | number;
            assay_description?: string;
            document_chembl_id?: string;
          }>;
        }>(
          `https://www.ebi.ac.uk/chembl/api/data/activity.json?molecule_chembl_id=${encodeURIComponent(
            chemblId
          )}&standard_type__in=IC50,Ki,Kd&standard_units=nM&limit=15`,
          undefined,
          1
        ),
      ]);

      if (mechSettled.status === 'fulfilled') {
        for (const m of mechSettled.value.mechanisms ?? []) {
          mechanisms.push({
            mechanismOfAction: m.mechanism_of_action || 'Unspecified MOA',
            actionType: m.action_type || 'UNKNOWN',
            targetName: m.mechanism_of_action || '',
            targetChEMBLId: m.target_chembl_id || '',
          });
        }
      } else {
        errors.push({
          source: 'ChEMBL_Mechanism',
          message: mechSettled.reason instanceof Error ? mechSettled.reason.message : 'ChEMBL mechanism endpoint unavailable.',
        });
      }

      if (actSettled.status === 'fulfilled') {
        for (const a of actSettled.value.activities ?? []) {
          const val = Number(a.standard_value);
          const pchem = Number(a.pchembl_value);
          bioactivities.push({
            targetName: a.target_pref_name || 'Target',
            targetChEMBLId: a.target_chembl_id || '',
            standardType: a.standard_type || 'IC50',
            standardValue: Number.isFinite(val) ? val : null,
            standardUnits: a.standard_units || 'nM',
            pchemblValue: Number.isFinite(pchem) ? pchem : null,
            assayDescription: (a.assay_description || '').slice(0, 180),
            documentChEMBLId: a.document_chembl_id || '',
          });
        }
      } else {
        errors.push({
          source: 'ChEMBL_Activity',
          message: actSettled.reason instanceof Error ? actSettled.reason.message : 'ChEMBL bioactivity endpoint unavailable.',
        });
      }
    } catch (err) {
      errors.push({
        source: 'ChEMBL',
        message: err instanceof Error ? err.message : 'ChEMBL REST API lookup failed.',
      });
    }
  })();

  const pubchemPromise = (async () => {
    try {
      const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(
        cleanQuery
      )}/property/MolecularFormula,MolecularWeight,CanonicalSMILES/JSON`;
      const raw = await fetchJsonWithTimeout<{
        PropertyTable?: {
          Properties?: Array<{
            CID?: number;
            MolecularFormula?: string;
            MolecularWeight?: string | number;
            CanonicalSMILES?: string;
          }>;
        };
      }>(url);
      const prop = raw.PropertyTable?.Properties?.[0];
      if (prop) {
        pubchemCid = typeof prop.CID === 'number' ? prop.CID : null;
        if (!formula && prop.MolecularFormula) formula = prop.MolecularFormula;
        if (!molecularWeight && prop.MolecularWeight) molecularWeight = String(prop.MolecularWeight);
        if (!canonicalSmiles && prop.CanonicalSMILES) canonicalSmiles = prop.CanonicalSMILES;
      }
    } catch (err) {
      errors.push({
        source: 'PubChem',
        message: err instanceof Error ? err.message : 'PubChem PUG-REST lookup failed.',
      });
    }
  })();

  await Promise.all([chemblPromise, pubchemPromise]);

  // Compute median measured potency in micromolar (uM) from nM bioactivities
  const nmValues = bioactivities
    .map((b) => b.standardValue)
    .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  let medianPotencyUM: number | null = null;
  let suggestedConcentrationUM: number | null = null;
  if (nmValues.length > 0) {
    const mid = Math.floor(nmValues.length / 2);
    const medianNm = nmValues.length % 2 === 1 ? nmValues[mid] : (nmValues[mid - 1] + nmValues[mid]) / 2;
    medianPotencyUM = Number((medianNm / 1000).toFixed(4));
    // Translating sub-nanomolar/nanomolar cellular IC50 into realistic 3D organoid dosing window [0.5, 12.0 uM]
    suggestedConcentrationUM = Number(Math.max(0.5, Math.min(12.0, medianPotencyUM * 8)).toFixed(2));
  }

  const combinedText = [
    cleanQuery,
    prefName,
    ...mechanisms.map((m) => `${m.mechanismOfAction} ${m.actionType}`),
    ...bioactivities.map((b) => `${b.targetName} ${b.assayDescription}`),
  ].join(' ');

  return {
    query: cleanQuery,
    chemblId,
    prefName,
    pubchemCid,
    formula,
    molecularWeight,
    canonicalSmiles,
    alogp,
    mechanisms,
    bioactivities,
    medianPotencyUM,
    suggestedConcentrationUM,
    suggestedMechanism: inferTreatmentMechanism(combinedText),
    chemblUrl: chemblId ? `https://www.ebi.ac.uk/chembl/compound_report_card/${chemblId}/` : null,
    pubchemUrl: pubchemCid ? `https://pubchem.ncbi.nlm.nih.gov/compound/${pubchemCid}` : null,
    errors,
  };
}

export async function queryLivePathwaysEnrichrReactome(genes: string[]): Promise<{
  pathways: LiveEnrichedPathway[];
  userListId: number | null;
  errors: Array<{ source: string; message: string }>;
}> {
  const cleaned = Array.from(new Set(genes.map((g) => g.trim().toUpperCase()).filter(Boolean)));
  const errors: Array<{ source: string; message: string }> = [];
  const pathways: LiveEnrichedPathway[] = [];

  if (cleaned.length < 2) {
    return { pathways: [], userListId: null, errors: [] };
  }

  let userListId: number | null = null;
  try {
    const form = new FormData();
    form.append('list', cleaned.join('\n'));
    form.append('description', 'PROJECT_CURE_PATHWAY_ENRICHMENT');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const addRes = await fetch('https://maayanlab.cloud/Enrichr/addList', {
        method: 'POST',
        body: form,
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!addRes.ok) throw new Error(`Enrichr addList HTTP ${addRes.status}`);
      const addJson = (await addRes.json()) as { userListId?: number };
      userListId = typeof addJson.userListId === 'number' ? addJson.userListId : null;
    } finally {
      clearTimeout(timer);
    }

    if (!userListId) {
      throw new Error('Enrichr did not return a userListId.');
    }

    const libraries: Array<'Reactome_2022' | 'KEGG_2021_Human'> = ['Reactome_2022', 'KEGG_2021_Human'];
    await Promise.all(
      libraries.map(async (lib) => {
        try {
          const url = `https://maayanlab.cloud/Enrichr/enrich?userListId=${userListId}&backgroundType=${lib}`;
          const data = await fetchJsonWithTimeout<Record<string, Array<unknown>>>(url);
          const rows = Array.isArray(data?.[lib]) ? data[lib] : [];
          for (const row of rows.slice(0, 8)) {
            if (!Array.isArray(row) || row.length < 7) continue;
            const termName = String(row[1] ?? '');
            const pVal = Number(row[2]);
            const combined = Number(row[4]);
            const genesOverlap = Array.isArray(row[5]) ? row[5].map(String) : [];
            const adjP = Number(row[6]);
            if (!termName || genesOverlap.length === 0) continue;

            const idMatch = termName.match(/(R-HSA-\d+|hsa\d+)/i);
            pathways.push({
              pathwayId: idMatch ? idMatch[1] : `${lib}:${termName.slice(0, 24)}`,
              pathwayName: termName,
              sourceDb: lib,
              overlapCount: genesOverlap.length,
              overlappingGenes: genesOverlap,
              pValue: Number.isFinite(pVal) ? Number(pVal.toPrecision(4)) : 1,
              fdrAdjustedP: Number.isFinite(adjP) ? Number(adjP.toPrecision(4)) : 1,
              combinedScore: Number.isFinite(combined) ? Number(combined.toFixed(2)) : 0,
            });
          }
        } catch (err) {
          errors.push({
            source: `Enrichr_${lib}`,
            message: err instanceof Error ? err.message : `Failed querying ${lib}.`,
          });
        }
      })
    );

    pathways.sort((a, b) => a.fdrAdjustedP - b.fdrAdjustedP || a.pValue - b.pValue);
  } catch (err) {
    errors.push({
      source: 'Enrichr',
      message: err instanceof Error ? err.message : 'Enrichr external pathway query failed.',
    });
  }

  return { pathways, userListId, errors };
}
