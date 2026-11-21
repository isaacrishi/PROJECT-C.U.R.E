import { jsPDF } from 'jspdf';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

export interface CompiledReportPayload {
  generatedAt: string;
  generatedBy: string;
  project: {
    id: string;
    name: string;
    description: string;
    cancer_area: string;
    primary_objective: string;
    research_questions_json: string;
    visibility: string;
    created_at: string;
  };
  literature: Array<{
    pmid?: string;
    doi?: string;
    nct_id?: string;
    title: string;
    journal: string;
    pub_date: string;
    pub_type: string;
    url: string;
    abstract: string;
    is_preprint: number;
  }>;
  datasets: Array<{
    id: string;
    name: string;
    format: string;
    row_count: number;
    col_count: number;
    missing_count: number;
    is_synthetic: number;
  }>;
  hypotheses: Array<{
    id: string;
    title: string;
    research_question: string;
    biological_rationale: string;
    proposed_mechanism: string;
    assumptions: string;
    limitations: string;
    confidence_level: string;
    validation_approach: string;
    status: string;
  }>;
  evidence: Array<{
    hypothesis_id: string;
    evidence_type: string;
    polarity: string;
    citation_label: string;
    summary: string;
  }>;
  experiments: Array<{
    id: string;
    title: string;
    scientific_question: string;
    study_design: string;
    statistical_methods: string;
    limitations: string;
    version: number;
    status: string;
  }>;
  aiFindings: Array<{
    content: string;
    model_used: string;
    created_at: string;
  }>;
  computationalJobs: Array<{
    job_type: string;
    status: string;
    parameters_json: string;
    result_json: string;
    created_at: string;
  }>;
  simulations?: Array<{
    id: string;
    scenario_name: string;
    treatment_mechanism: string;
    concentration_uM: number;
    seed: number;
    final_metrics_json: string;
    summary_confidence: number;
    model_version_tag: string;
    created_at: string;
  }>;
  autonomousCycles?: Array<{
    id: string;
    goal_prompt: string;
    execution_mode: string;
    status: string;
    completed_iterations: number;
    max_iterations: number;
    iterations?: Array<{
      iteration_number: number;
      criterion_passed: number;
      predicted_viability_end: number | null;
      confidence_score: number;
      evaluation_notes: string;
      failure_diagnosis: string;
      strategy_revision: string;
    }>;
  }>;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportReportJson(payload: CompiledReportPayload) {
  const slug = payload.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `CURE_Report_${slug}.json`);
}

export function exportReportCsv(payload: CompiledReportPayload) {
  const rows: string[][] = [
    ['Section', 'Origin_Classification', 'Identifier', 'Title_or_Variable', 'Status_or_Type', 'Summary_or_Details'],
  ];
  for (const lit of payload.literature) {
    rows.push([
      'Literature',
      'LITERATURE-DERIVED',
      lit.pmid ? `PMID:${lit.pmid}` : lit.doi ? `DOI:${lit.doi}` : lit.nct_id || '',
      lit.title,
      `${lit.pub_type}${lit.is_preprint ? ' (PREPRINT)' : ''}`,
      lit.url,
    ]);
  }
  for (const ds of payload.datasets) {
    rows.push([
      'Dataset',
      ds.is_synthetic ? 'SYNTHETIC DATA' : 'EMPIRICAL DATASET',
      ds.id,
      ds.name,
      ds.format.toUpperCase(),
      `rows=${ds.row_count}; cols=${ds.col_count}; missing=${ds.missing_count}`,
    ]);
  }
  for (const job of payload.computationalJobs) {
    rows.push([
      'Analysis',
      'COMPUTATIONAL RESULT',
      job.job_type,
      job.created_at,
      job.status,
      job.result_json.slice(0, 300),
    ]);
  }
  for (const h of payload.hypotheses) {
    rows.push([
      'Hypothesis',
      'HYPOTHESIS (UNVALIDATED UNTIL TESTED)',
      h.id,
      h.title,
      `${h.status} | conf=${h.confidence_level}`,
      h.proposed_mechanism,
    ]);
  }
  for (const exp of payload.experiments) {
    rows.push([
      'Experiment_Proposal',
      'MANUAL / PROPOSED DESIGN',
      exp.id,
      exp.title,
      `v${exp.version} (${exp.status})`,
      exp.study_design,
    ]);
  }
  for (const ai of payload.aiFindings) {
    rows.push([
      'AI_Synthesis',
      'AI-GENERATED INTERPRETATION',
      ai.model_used || 'gemini',
      ai.created_at,
      'unvalidated_synthesis',
      ai.content.slice(0, 400),
    ]);
  }
  for (const sim of payload.simulations ?? []) {
    rows.push([
      '3D_Bio_Simulation',
      'COMPUTATIONAL SIMULATION (NOT EXPERIMENTAL PROOF)',
      sim.id,
      sim.scenario_name,
      `${sim.treatment_mechanism} | ${sim.concentration_uM} uM | conf=${(sim.summary_confidence * 100).toFixed(1)}%`,
      `model=${sim.model_version_tag}; seed=${sim.seed}; metrics=${sim.final_metrics_json}`,
    ]);
  }
  for (const cyc of payload.autonomousCycles ?? []) {
    rows.push([
      'Autonomous_Cycle',
      'COMPUTATIONAL ITERATION LOOP',
      cyc.id,
      cyc.goal_prompt.slice(0, 140),
      `${cyc.status} (${cyc.completed_iterations}/${cyc.max_iterations})`,
      JSON.stringify(cyc.iterations ?? []).slice(0, 400),
    ]);
  }

  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const slug = payload.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `CURE_Report_${slug}.csv`);
}

export function exportReportPdf(payload: CompiledReportPayload) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const maxWidth = 500;
  let y = 52;

  const addText = (text: string, size = 10, bold = false, color: [number, number, number] = [30, 41, 59]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    for (const line of lines) {
      if (y > 775) {
        doc.addPage();
        y = 52;
      }
      doc.text(line, margin, y);
      y += size * 1.38;
    }
    y += 4;
  };

  addText('Project C.U.R.E. — SCIENTIFIC RESEARCH REPORT', 15, true, [15, 23, 42]);
  addText(`Project: ${payload.project.name} · Cancer Area: ${payload.project.cancer_area}`, 11, true);
  addText(`Generated: ${new Date(payload.generatedAt).toUTCString()} · Investigator: ${payload.generatedBy} · I.R.A.I Corp`, 9, false, [100, 116, 139]);
  addText('Notice: Computational results, literature-derived findings, manual observations, and AI-generated interpretations are explicitly separated. Hypotheses require independent experimental validation.', 8.5, false, [100, 116, 139]);
  y += 8;

  addText('1. Research Objectives & Scope [MANUAL OBSERVATION]', 12, true);
  addText(`Primary Objective: ${payload.project.primary_objective || 'Not specified'}`);
  addText(`Description: ${payload.project.description || 'Not specified'}`);

  addText('2. Data Sources & Computational Analyses [COMPUTATIONAL RESULT]', 12, true);
  if (payload.datasets.length === 0) {
    addText('No datasets linked to this project.');
  } else {
    for (const ds of payload.datasets) {
      addText(`• ${ds.is_synthetic ? '[SYNTHETIC DATA] ' : ''}${ds.name} (${ds.format.toUpperCase()}, n=${ds.row_count}, cols=${ds.col_count}, missing=${ds.missing_count})`);
    }
  }
  for (const job of payload.computationalJobs.slice(0, 6)) {
    addText(`• Job [${job.job_type}] (${job.status}): ${job.result_json.slice(0, 220)}...`, 9);
  }

  addText('3. Literature Evidence [LITERATURE-DERIVED]', 12, true);
  if (payload.literature.length === 0) {
    addText('No literature records indexed for this project.');
  } else {
    for (const lit of payload.literature) {
      const idLabel = lit.pmid ? `PMID:${lit.pmid}` : lit.doi ? `DOI:${lit.doi}` : lit.nct_id || 'REF';
      addText(`• [${idLabel}] ${lit.title} (${lit.journal}, ${lit.pub_date}) — ${lit.pub_type}${lit.is_preprint ? ' [PREPRINT]' : ''}`, 9.5);
      addText(`  URL: ${lit.url}`, 8.5, false, [71, 85, 105]);
    }
  }

  addText('4. Hypotheses & Contradictory Evidence [HYPOTHESIS / MIXED EVIDENCE]', 12, true);
  if (payload.hypotheses.length === 0) {
    addText('No hypotheses documented.');
  } else {
    for (const h of payload.hypotheses) {
      addText(`• ${h.title} [Status: ${h.status} | Confidence: ${h.confidence_level}]`, 10, true);
      addText(`  Question: ${h.research_question}`, 9.5);
      addText(`  Proposed Mechanism: ${h.proposed_mechanism || 'N/A'}`, 9.5);
      addText(`  Limitations: ${h.limitations || 'Not documented'}`, 9.5);
      const linkedEv = payload.evidence.filter((e) => e.hypothesis_id === h.id);
      for (const ev of linkedEv) {
        addText(`    - [${ev.polarity.toUpperCase()} / ${ev.evidence_type}] ${ev.citation_label}: ${ev.summary}`, 9);
      }
    }
  }

  addText('5. Experimental Proposals [MANUAL OBSERVATION — REQUIRES REVIEW]', 12, true);
  if (payload.experiments.length === 0) {
    addText('No experimental plans documented.');
  } else {
    for (const exp of payload.experiments) {
      addText(`• ${exp.title} (v${exp.version}, ${exp.status})`, 10, true);
      addText(`  Study Design: ${exp.study_design || 'N/A'} · Statistical Methods: ${exp.statistical_methods || 'N/A'}`, 9.5);
    }
  }

  addText('6. AI-Assisted Synthesis [AI-GENERATED INTERPRETATION]', 12, true);
  if (payload.aiFindings.length === 0) {
    addText('No AI-assisted synthesis sessions recorded.');
  } else {
    for (const ai of payload.aiFindings.slice(0, 4)) {
      addText(`• [Model: ${ai.model_used || 'gemini'} | ${ai.created_at}] ${ai.content}`, 9.5);
    }
  }

  addText('7. 3D Biological Simulations & Autonomous Iterations [COMPUTATIONAL SIMULATION — NOT EXPERIMENTAL PROOF]', 12, true);
  if ((payload.simulations ?? []).length === 0 && (payload.autonomousCycles ?? []).length === 0) {
    addText('No 3D biological simulations or autonomous research cycles recorded.');
  } else {
    for (const sim of (payload.simulations ?? []).slice(0, 8)) {
      addText(
        `• [3D Sim ${sim.id}] ${sim.scenario_name} (${sim.treatment_mechanism}, ${sim.concentration_uM} uM, seed=${sim.seed}, model=${sim.model_version_tag}) — Confidence: ${(sim.summary_confidence * 100).toFixed(1)}%`,
        9.5
      );
    }
    for (const cyc of (payload.autonomousCycles ?? []).slice(0, 4)) {
      addText(
        `• [Autonomous Cycle ${cyc.id}] ${cyc.goal_prompt} [${cyc.status} · ${cyc.completed_iterations}/${cyc.max_iterations} iters]`,
        9.5,
        true
      );
      for (const it of cyc.iterations ?? []) {
        addText(
          `    - Iter ${it.iteration_number}: Viability=${it.predicted_viability_end ?? 'N/A'}% | Conf=${(it.confidence_score * 100).toFixed(1)}% | ${it.criterion_passed ? 'PASSED' : 'REVISED'} — ${it.evaluation_notes}`,
          8.5
        );
      }
    }
  }

  const slug = payload.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  doc.save(`CURE_Report_${slug}.pdf`);
}

export async function exportReportDocx(payload: CompiledReportPayload) {
  const children: Paragraph[] = [
    new Paragraph({
      text: 'Project C.U.R.E. — Scientific Research Report',
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Project: ${payload.project.name} (${payload.project.cancer_area})`, bold: true }),
      ],
    }),
    new Paragraph({
      text: `Generated: ${new Date(payload.generatedAt).toUTCString()} | Investigator: ${payload.generatedBy} | Created by I.R.A.I Corp`,
    }),
    new Paragraph({
      text: 'Provenance Policy: Computational results, literature-derived records, manual observations, and AI-generated interpretations are explicitly delineated. Hypotheses are not established scientific findings.',
    }),
    new Paragraph({ text: '1. Objectives & Methodology [MANUAL OBSERVATION]', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ text: `Primary Objective: ${payload.project.primary_objective || 'Not specified'}` }),
    new Paragraph({ text: `Description: ${payload.project.description || 'Not specified'}` }),
    new Paragraph({ text: '2. Data Sources & Computational Results [COMPUTATIONAL RESULT]', heading: HeadingLevel.HEADING_1 }),
    ...(payload.datasets.length
      ? payload.datasets.map(
          (d) =>
            new Paragraph({
              text: `${d.is_synthetic ? '[SYNTHETIC DATA] ' : ''}${d.name} (${d.format.toUpperCase()}, n=${d.row_count}, cols=${d.col_count}, missing=${d.missing_count})`,
            })
        )
      : [new Paragraph({ text: 'No datasets attached.' })]),
    new Paragraph({ text: '3. Literature Evidence & References [LITERATURE-DERIVED]', heading: HeadingLevel.HEADING_1 }),
    ...(payload.literature.length
      ? payload.literature.map(
          (l) =>
            new Paragraph({
              text: `[${l.pmid ? `PMID:${l.pmid}` : l.doi ? `DOI:${l.doi}` : l.nct_id || 'REF'}] ${l.title} (${l.journal}, ${l.pub_date}) — ${l.url}`,
            })
        )
      : [new Paragraph({ text: 'No literature sources indexed.' })]),
    new Paragraph({ text: '4. Hypotheses & Contradictory Findings', heading: HeadingLevel.HEADING_1 }),
    ...(payload.hypotheses.length
      ? payload.hypotheses.map(
          (h) =>
            new Paragraph({
              text: `${h.title} [${h.status} | ${h.confidence_level}] — Q: ${h.research_question} | Mechanism: ${h.proposed_mechanism} | Limitations: ${h.limitations}`,
            })
        )
      : [new Paragraph({ text: 'No hypotheses recorded.' })]),
    new Paragraph({ text: '5. Proposed Experimental Plans', heading: HeadingLevel.HEADING_1 }),
    ...(payload.experiments.length
      ? payload.experiments.map(
          (e) =>
            new Paragraph({
              text: `${e.title} (v${e.version}, ${e.status}) — Design: ${e.study_design} | Stats: ${e.statistical_methods}`,
            })
        )
      : [new Paragraph({ text: 'No experiment proposals documented.' })]),
    new Paragraph({ text: '6. AI-Generated Interpretations [AI-GENERATED INTERPRETATION]', heading: HeadingLevel.HEADING_1 }),
    ...(payload.aiFindings.length
      ? payload.aiFindings.slice(0, 5).map(
          (a) => new Paragraph({ text: `[${a.model_used || 'gemini'} | ${a.created_at}] ${a.content}` })
        )
      : [new Paragraph({ text: 'No AI synthesis sessions recorded.' })]),
    new Paragraph({
      text: '7. 3D Biological Simulations & Autonomous Cycles [COMPUTATIONAL SIMULATION ONLY]',
      heading: HeadingLevel.HEADING_1,
    }),
    ...((payload.simulations ?? []).length
      ? (payload.simulations ?? []).slice(0, 8).map(
          (s) =>
            new Paragraph({
              text: `[Sim ${s.id}] ${s.scenario_name} (${s.treatment_mechanism}, ${s.concentration_uM} uM, seed=${s.seed}, conf=${(s.summary_confidence * 100).toFixed(1)}%)`,
            })
        )
      : [new Paragraph({ text: 'No 3D biological simulations recorded.' })]),
    ...((payload.autonomousCycles ?? []).length
      ? (payload.autonomousCycles ?? []).slice(0, 4).map(
          (c) =>
            new Paragraph({
              text: `[Cycle ${c.id}] ${c.goal_prompt} (${c.status}, ${c.completed_iterations}/${c.max_iterations} iterations)`,
            })
        )
      : []),
  ];

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const slug = payload.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  triggerDownload(blob, `CURE_Report_${slug}.docx`);
}
