export interface LiteratureResult {
  source_db: 'pubmed' | 'europepmc' | 'crossref' | 'clinicaltrials';
  external_id: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  nct_id?: string;
  title: string;
  authors: string[];
  journal: string;
  pub_date: string;
  pub_type: string;
  is_preprint: boolean;
  correction_status: string;
  url: string;
  abstract: string;
  full_text_available: boolean;
  citation_count?: number;
  study_status?: string;
  phase?: string;
}

export interface LiteratureSearchResponse {
  query: string;
  sources_queried: string[];
  results: LiteratureResult[];
  errors: Array<{ source: string; message: string }>;
  queried_at: string;
}

const TIMEOUT_MS = 10000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function searchPubMed(query: string, maxResults = 8, yearFrom?: string): Promise<LiteratureResult[]> {
  const apiKeyParam = process.env.NCBI_API_KEY ? `&api_key=${encodeURIComponent(process.env.NCBI_API_KEY)}` : '';
  const dateFilter = yearFrom ? ` AND ("${yearFrom}/01/01"[Date - Publication] : "3000"[Date - Publication])` : '';
  const term = encodeURIComponent(`${query}${dateFilter}`);

  const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${term}&retmax=${maxResults}&retmode=json&sort=relevance${apiKeyParam}`;
  const esearchRes = await fetchWithTimeout(esearchUrl);
  if (!esearchRes.ok) {
    throw new Error(`PubMed E-search HTTP ${esearchRes.status}`);
  }
  const esearchData = (await esearchRes.json()) as {
    esearchresult?: { idlist?: string[] };
  };
  const idList = esearchData.esearchresult?.idlist ?? [];
  if (idList.length === 0) return [];

  const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${idList.join(',')}&retmode=xml${apiKeyParam}`;
  const efetchRes = await fetchWithTimeout(efetchUrl);
  if (!efetchRes.ok) {
    throw new Error(`PubMed E-fetch HTTP ${efetchRes.status}`);
  }
  const xml = await efetchRes.text();

  const articles: LiteratureResult[] = [];
  const articleBlocks = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) ?? [];

  for (const block of articleBlocks) {
    const pmid = block.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1] ?? '';
    const titleRaw = block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1] ?? 'Untitled Article';
    const journalRaw =
      block.match(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/)?.[1] ??
      block.match(/<MedlineTA>([\s\S]*?)<\/MedlineTA>/)?.[1] ??
      'PubMed Indexed Journal';
    const year = block.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)?.[1] ?? '';
    const month = block.match(/<PubDate>[\s\S]*?<Month>([^<]+)<\/Month>/)?.[1] ?? '';
    const doi = block.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/)?.[1];
    const pmcid = block.match(/<ArticleId IdType="pmc">([^<]+)<\/ArticleId>/)?.[1];

    const abstractParts = [...block.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)].map((m) => {
      const label = m[1].match(/Label="([^"]+)"/)?.[1];
      const text = decodeXmlEntities(m[2]);
      return label ? `${label}: ${text}` : text;
    });

    const authorMatches = [...block.matchAll(/<Author[^>]*>([\s\S]*?)<\/Author>/g)];
    const authors = authorMatches
      .map((am) => {
        const last = am[1].match(/<LastName>([^<]+)<\/LastName>/)?.[1] ?? '';
        const init = am[1].match(/<Initials>([^<]+)<\/Initials>/)?.[1] ?? '';
        const coll = am[1].match(/<CollectiveName>([^<]+)<\/CollectiveName>/)?.[1] ?? '';
        return coll || (last ? `${last} ${init}`.trim() : '');
      })
      .filter(Boolean)
      .slice(0, 12);

    const pubTypes = [...block.matchAll(/<PublicationType[^>]*>([^<]+)<\/PublicationType>/g)].map((m) => m[1]);
    const isRetracted = pubTypes.some((t) => /retract/i.test(t));
    const isErratum = pubTypes.some((t) => /erratum|corrected/i.test(t));
    const isPreprint = pubTypes.some((t) => /preprint/i.test(t));
    const isReview = pubTypes.some((t) => /review/i.test(t));

    articles.push({
      source_db: 'pubmed',
      external_id: pmid,
      pmid,
      pmcid,
      doi,
      title: decodeXmlEntities(titleRaw),
      authors,
      journal: decodeXmlEntities(journalRaw),
      pub_date: [year, month].filter(Boolean).join(' '),
      pub_type: isReview ? 'Review' : pubTypes[0] || 'Research Article',
      is_preprint: isPreprint,
      correction_status: isRetracted ? 'RETRACTED' : isErratum ? 'CORRECTED_OR_ERRATUM' : 'none',
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      abstract: abstractParts.join(' ') || 'Abstract not provided in PubMed XML metadata.',
      full_text_available: Boolean(pmcid),
    });
  }

  return articles;
}

export async function searchEuropePMC(query: string, maxResults = 8, openAccessOnly = false): Promise<LiteratureResult[]> {
  const q = openAccessOnly ? `(${query}) AND OPEN_ACCESS:Y` : query;
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(
    q
  )}&format=json&resultType=core&pageSize=${maxResults}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Europe PMC HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    resultList?: {
      result?: Array<{
        id?: string;
        source?: string;
        pmid?: string;
        pmcid?: string;
        doi?: string;
        title?: string;
        authorString?: string;
        journalTitle?: string;
        bookOrReportDetails?: { publisher?: string };
        pubYear?: string;
        firstPublicationDate?: string;
        pubTypeList?: { pubType?: string[] };
        isOpenAccess?: string;
        hasTextMinedTerms?: string;
        abstractText?: string;
        citedByCount?: number;
      }>;
    };
  };

  const rows = data.resultList?.result ?? [];
  return rows.map((r) => {
    const pubTypes = r.pubTypeList?.pubType ?? [];
    const isPreprint = r.source === 'PPR' || pubTypes.some((t) => /preprint/i.test(t));
    const isReview = pubTypes.some((t) => /review/i.test(t));
    const pmid = r.pmid;
    const pmcid = r.pmcid;
    const doi = r.doi;
    const urlOut = pmcid
      ? `https://europepmc.org/article/PMC/${pmcid.replace(/^PMC/i, '')}`
      : pmid
      ? `https://europepmc.org/article/MED/${pmid}`
      : doi
      ? `https://doi.org/${doi}`
      : `https://europepmc.org/search?query=${encodeURIComponent(r.title || query)}`;

    return {
      source_db: 'europepmc',
      external_id: r.id || pmid || doi || Math.random().toString(36).slice(2),
      pmid,
      pmcid,
      doi,
      title: decodeXmlEntities(r.title || 'Untitled Europe PMC Record'),
      authors: r.authorString ? r.authorString.split(',').map((s) => s.trim()).slice(0, 10) : [],
      journal: r.journalTitle || r.bookOrReportDetails?.publisher || (isPreprint ? 'Preprint Server' : 'Europe PMC'),
      pub_date: r.firstPublicationDate || r.pubYear || '',
      pub_type: isPreprint ? 'Preprint' : isReview ? 'Review' : pubTypes[0] || 'Research Article',
      is_preprint: isPreprint,
      correction_status: 'none',
      url: urlOut,
      abstract: r.abstractText ? decodeXmlEntities(r.abstractText) : 'Abstract unavailable in Europe PMC record.',
      full_text_available: r.isOpenAccess === 'Y' && Boolean(pmcid),
      citation_count: r.citedByCount,
    };
  });
}

export async function searchCrossref(query: string, maxResults = 6): Promise<LiteratureResult[]> {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${maxResults}&select=DOI,title,author,container-title,published,type,abstract,URL,update-to`;
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'PROJECT-CURE/1.0 (mailto:research@cure.local)' },
  });
  if (!res.ok) {
    throw new Error(`Crossref HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    message?: {
      items?: Array<{
        DOI: string;
        title?: string[];
        author?: Array<{ given?: string; family?: string }>;
        'container-title'?: string[];
        published?: { 'date-parts'?: number[][] };
        type?: string;
        abstract?: string;
        URL?: string;
        'update-to'?: Array<{ type?: string }>;
      }>;
    };
  };

  const items = data.message?.items ?? [];
  return items.map((item) => {
    const dp = item.published?.['date-parts']?.[0];
    const pubDate = dp ? dp.join('-') : '';
    const updateType = item['update-to']?.[0]?.type || 'none';
    const isPreprint = item.type === 'posted-content';
    return {
      source_db: 'crossref',
      external_id: item.DOI,
      doi: item.DOI,
      title: decodeXmlEntities(item.title?.[0] || item.DOI),
      authors: (item.author ?? []).map((a) => [a.given, a.family].filter(Boolean).join(' ')).slice(0, 10),
      journal: item['container-title']?.[0] || (isPreprint ? 'Preprint / Posted Content' : 'Crossref Record'),
      pub_date: pubDate,
      pub_type: item.type || 'journal-article',
      is_preprint: isPreprint,
      correction_status: updateType !== 'none' ? updateType.toUpperCase() : 'none',
      url: item.URL || `https://doi.org/${item.DOI}`,
      abstract: item.abstract ? decodeXmlEntities(item.abstract) : 'Abstract not indexed in Crossref metadata; inspect DOI landing page.',
      full_text_available: false,
    };
  });
}

export async function searchClinicalTrials(query: string, maxResults = 6): Promise<LiteratureResult[]> {
  const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(query)}&pageSize=${maxResults}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`ClinicalTrials.gov HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    studies?: Array<{
      protocolSection?: {
        identificationModule?: { nctId?: string; briefTitle?: string; officialTitle?: string };
        statusModule?: { overallStatus?: string; startDateStruct?: { date?: string } };
        designModule?: { studyType?: string; phases?: string[] };
        descriptionModule?: { briefSummary?: string };
        sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
      };
    }>;
  };

  return (data.studies ?? []).map((s) => {
    const p = s.protocolSection;
    const nctId = p?.identificationModule?.nctId || 'NCT_UNKNOWN';
    const title = p?.identificationModule?.officialTitle || p?.identificationModule?.briefTitle || nctId;
    const sponsor = p?.sponsorCollaboratorsModule?.leadSponsor?.name || 'ClinicalTrials.gov Registry';
    const phase = p?.designModule?.phases?.join(', ') || p?.designModule?.studyType || 'Clinical Study';
    const status = p?.statusModule?.overallStatus || 'UNKNOWN';
    return {
      source_db: 'clinicaltrials',
      external_id: nctId,
      nct_id: nctId,
      title,
      authors: [sponsor],
      journal: `ClinicalTrials.gov · ${phase} · ${status}`,
      pub_date: p?.statusModule?.startDateStruct?.date || '',
      pub_type: 'Clinical Trial Record',
      is_preprint: false,
      correction_status: 'none',
      url: `https://clinicaltrials.gov/study/${nctId}`,
      abstract: p?.descriptionModule?.briefSummary || 'No brief summary provided in registry.',
      full_text_available: true,
      study_status: status,
      phase,
    };
  });
}

export async function searchIntegratedLiterature(params: {
  query: string;
  sources?: Array<'pubmed' | 'europepmc' | 'crossref' | 'clinicaltrials'>;
  maxPerSource?: number;
  openAccessOnly?: boolean;
  yearFrom?: string;
}): Promise<LiteratureSearchResponse> {
  const sources = params.sources?.length ? params.sources : ['pubmed', 'europepmc', 'clinicaltrials'];
  const maxPerSource = params.maxPerSource ?? 6;

  const tasks = sources.map(async (src) => {
    try {
      if (src === 'pubmed') return { src, items: await searchPubMed(params.query, maxPerSource, params.yearFrom) };
      if (src === 'europepmc')
        return { src, items: await searchEuropePMC(params.query, maxPerSource, Boolean(params.openAccessOnly)) };
      if (src === 'crossref') return { src, items: await searchCrossref(params.query, maxPerSource) };
      return { src, items: await searchClinicalTrials(params.query, maxPerSource) };
    } catch (err) {
      return { src, error: err instanceof Error ? err.message : String(err) };
    }
  });

  const settled = await Promise.all(tasks);
  const results: LiteratureResult[] = [];
  const errors: Array<{ source: string; message: string }> = [];

  for (const s of settled) {
    if ('error' in s && s.error) {
      errors.push({ source: s.src, message: s.error });
    } else if ('items' in s && Array.isArray(s.items)) {
      results.push(...s.items);
    }
  }

  return {
    query: params.query,
    sources_queried: sources,
    results,
    errors,
    queried_at: new Date().toISOString(),
  };
}

export async function probeLiteratureApis(): Promise<
  Array<{ id: string; name: string; status: 'connected' | 'unreachable'; latency_ms: number; detail: string }>
> {
  const checks = [
    {
      id: 'pubmed',
      name: 'NCBI PubMed E-utilities',
      url: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?retmode=json',
    },
    {
      id: 'europepmc',
      name: 'Europe PMC REST API',
      url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TP53&format=json&pageSize=1',
    },
    {
      id: 'crossref',
      name: 'Crossref Metadata API',
      url: 'https://api.crossref.org/works?query=cancer&rows=1',
    },
    {
      id: 'clinicaltrials',
      name: 'ClinicalTrials.gov v2 API',
      url: 'https://clinicaltrials.gov/api/v2/studies?query.term=oncology&pageSize=1',
    },
  ];

  return Promise.all(
    checks.map(async (c) => {
      const start = Date.now();
      try {
        const res = await fetchWithTimeout(c.url);
        const latency_ms = Date.now() - start;
        if (res.ok) {
          return { id: c.id, name: c.name, status: 'connected' as const, latency_ms, detail: `HTTP ${res.status}` };
        }
        return { id: c.id, name: c.name, status: 'unreachable' as const, latency_ms, detail: `HTTP ${res.status}` };
      } catch (err) {
        return {
          id: c.id,
          name: c.name,
          status: 'unreachable' as const,
          latency_ms: Date.now() - start,
          detail: err instanceof Error ? err.message : 'Network error',
        };
      }
    })
  );
}
