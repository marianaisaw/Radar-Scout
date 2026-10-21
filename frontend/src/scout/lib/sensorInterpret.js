import { fmt } from './utils'

/** Dynamic plain-language interpretation of a gene's Sensor score. */
export function interpretSensor(gene, { nCohorts = null, totalGenes = null } = {}) {
  if (!gene) return { strengths: [], weaknesses: [], summary: '' }

  const strengths = []
  const weaknesses = []

  const fc = gene.log2FC
  const fold = Number.isFinite(fc) ? Math.pow(2, fc) : null

  if (Number.isFinite(fc) && fc > 0) {
    if (fc >= 2) {
      strengths.push(`Strong disease enrichment (${fmt(fold, 1)}× higher in pathogenic vs healthy cells)`)
    } else if (fc >= 0.5) {
      strengths.push(`Moderate disease enrichment (${fmt(fold, 1)}× vs healthy reference)`)
    } else {
      strengths.push(`Modest up-regulation in pathogenic cells (${fmt(fold, 2)}× vs healthy)`)
    }
  } else if (Number.isFinite(fc) && fc <= 0) {
    weaknesses.push('Not up-regulated in pathogenic vs healthy cells — poor disease marker')
  }

  if (Number.isFinite(gene.detect_P)) {
    strengths.push(`Detected in ${fmt(gene.detect_P, 1)}% of pathogenic cells`)
  }
  if (Number.isFinite(gene.detect_H)) {
    strengths.push(`Detected in ${fmt(gene.detect_H, 1)}% of healthy cells`)
  } else if (Number.isFinite(gene.detect_B)) {
    strengths.push(`Reference detection (bystander): ${fmt(gene.detect_B, 1)}%`)
  }

  if (Number.isFinite(gene.delta_detect)) {
    if (gene.delta_detect >= 40) {
      strengths.push(`Near-binary sensor pattern (Δ detection +${fmt(gene.delta_detect, 1)} pts vs reference)`)
    } else if (gene.delta_detect >= 15) {
      strengths.push(`Meaningful detection gap (+${fmt(gene.delta_detect, 1)} pts vs reference)`)
    } else if (gene.delta_detect > 0) {
      weaknesses.push(`Small detection gap (+${fmt(gene.delta_detect, 1)} pts) — sensor may not be cleanly ON/OFF`)
    } else {
      weaknesses.push('No detection advantage over reference population')
    }
  }

  if (Number.isFinite(gene.celltype_spec)) {
    if (gene.celltype_spec >= 0.75) {
      strengths.push(`High cell-type specificity vs bystanders (AUC ${fmt(gene.celltype_spec, 2)})`)
    } else if (gene.celltype_spec < 0.6) {
      weaknesses.push(`Low cell-type specificity (AUC ${fmt(gene.celltype_spec, 2)}) — may fire in other cell types`)
    }
  }

  if (Number.isFinite(gene.detect_B) && gene.detect_B > 15) {
    weaknesses.push(`Expression in bystander cell types (${fmt(gene.detect_B, 1)}% detection)`)
  }

  if (Number.isFinite(gene.OffMax)) {
    if (gene.OffMax <= 0.15) {
      strengths.push('Low worst-case off-target activation')
    } else if (gene.OffMax >= 0.35) {
      weaknesses.push(`Elevated off-target activation (OffMax ${fmt(gene.OffMax, 2)})`)
    }
  }

  const nc = gene.n_cohorts_present ?? gene.n_cohorts
  if (nc && nCohorts && nc >= nCohorts) {
    strengths.push(`Reproducible across all ${nc} pooled cohorts`)
  } else if (nc && nc > 1) {
    strengths.push(`Supported in ${nc} cohort${nc > 1 ? 's' : ''}`)
  } else if (nc === 1) {
    weaknesses.push('Evidence from a single cohort only')
  }

  if (Number.isFinite(gene.DSS) && gene.DSS > 1) {
    strengths.push(`Strong disease-marker signal (DSS ${fmt(gene.DSS, 2)})`)
  }

  if (Number.isFinite(gene.RCS) && gene.RCS >= 90) {
    strengths.push(`High cross-metric consensus (RCS ${fmt(gene.RCS, 1)})`)
  }

  const rankNote =
    totalGenes && gene._rank
      ? `Ranked #${gene._rank} of ${totalGenes} by Sensor score`
      : null

  const primaryWeakness = weaknesses[0] || null
  const summary = primaryWeakness
    ? `Strong sensor candidate with caveat: ${primaryWeakness.charAt(0).toLowerCase()}${primaryWeakness.slice(1)}`
    : strengths.length
      ? 'Strong RADAR sensor candidate based on detection pattern and disease enrichment'
      : 'Limited sensor evidence — review supporting metrics'

  return { strengths, weaknesses, summary, rankNote }
}
