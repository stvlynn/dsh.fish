import type {
  ArtifactAskDto,
  ArtifactDetailDto,
  ArtifactSummaryDto,
  InstallPlanDto,
  PageDto,
} from '@dsh-fish/backend/application/dto/artifact-dto.js'
import type {
  ArtifactReviewsDto,
  ReviewDto,
  ReviewSummaryDto,
} from '@dsh-fish/backend/application/dto/review-dto.js'
import type { ArtifactKind } from '@dsh-fish/backend/domain/artifact/artifact-kind.js'
import type {
  MaintenanceStatus,
  QualityGrade,
} from '@dsh-fish/backend/domain/artifact/quality-score.js'
import type { FacetsDto } from '@dsh-fish/backend/application/use-case/list-catalog-facets.js'

/**
 * The frontend's view of catalog data is the backend's DTO contract, imported
 * as types only. One declaration means a renamed field breaks the build here
 * instead of rendering `undefined` in production.
 */
export type {
  ArtifactAskDto,
  ArtifactDetailDto,
  ArtifactKind,
  ArtifactReviewsDto,
  ArtifactSummaryDto,
  FacetsDto,
  InstallPlanDto,
  MaintenanceStatus,
  PageDto,
  QualityGrade,
  ReviewDto,
  ReviewSummaryDto,
}

export type Artifact = ArtifactSummaryDto
export type ArtifactDetail = ArtifactDetailDto

/**
 * Per-kind presentation.
 *
 * Deliberately colourless. An earlier version gave each kind its own hue
 * which produced a rainbow that competed with the one accent and encoded
 * nothing a reader could learn. The chip says the kind in words and shows
 * the mark from `KIND_ICON`, both of which are unambiguous, translatable and
 * readable without colour vision. The accent is reserved for the two things
 * that genuinely need to stand out: a verified badge and the primary action.
 */
export const KIND_CHIP =
  'inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground'

/**
 * Per-grade presentation.
 *
 * A grade earns a hue where a kind does not: the colour *is* the information
 * (gold is better than grey at a glance), and the letter is always printed too,
 * so nothing is carried by colour alone. Muted fills and borders keep the set
 * quieter than the one accent and the destructive state.
 *
 * The fills are colour-mixed over `--card`, not bare `/10` tints: the badge sits
 * on the card's OG backdrop where the scrim is thinnest, and a translucent fill
 * smudges the letter into the texture. Mixing over `--card` keeps the same tint
 * while staying opaque in both themes.
 */
export const GRADE_BADGE: Readonly<Record<QualityGrade, string>> = {
  S: 'border-amber-500/50 bg-[color-mix(in_oklch,var(--card)_85%,#f59e0b)] text-amber-700 dark:text-amber-400',
  A: 'border-emerald-500/50 bg-[color-mix(in_oklch,var(--card)_85%,#10b981)] text-emerald-700 dark:text-emerald-400',
  B: 'border-sky-500/50 bg-[color-mix(in_oklch,var(--card)_85%,#0ea5e9)] text-sky-700 dark:text-sky-400',
  C: 'border-border bg-muted text-muted-foreground',
}

/**
 * Per-status presentation for maintenance.
 *
 * Same rule as the grade: a status hue, always with the word beside it, each
 * one distinguishable from the destructive deprecated chip that can sit next
 * to it (an abandoned artifact is not necessarily deprecated).
 */
export const MAINTENANCE_CHIP: Readonly<Record<MaintenanceStatus, string>> = {
  active: 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400',
  slowing: 'border-amber-500/30 text-amber-700 dark:text-amber-400',
  stale: 'border-orange-500/30 text-orange-700 dark:text-orange-400',
  abandoned: 'border-border text-muted-foreground',
}

/**
 * The message-key stem for each kind.
 *
 * One map, two suffixes: `.label` names a single artifact ("Skill", on a chip),
 * `.plural` names the collection ("Skills", as a page heading). Deriving both
 * from one stem is what stops a new kind from being half-translated.
 */
const KIND_MESSAGE_STEM: Readonly<Record<ArtifactKind, string>> = {
  bundle: 'artifactKind.bundle',
  profile: 'artifactKind.profile',
  skill: 'artifactKind.skill',
  'agent-preset': 'artifactKind.agentPreset',
}

export function kindLabelKey(kind: ArtifactKind): string {
  return `${KIND_MESSAGE_STEM[kind]}.label`
}

export function kindPluralKey(kind: ArtifactKind): string {
  return `${KIND_MESSAGE_STEM[kind]}.plural`
}

export function kindDescriptionKey(kind: ArtifactKind): string {
  return `${KIND_MESSAGE_STEM[kind]}.description`
}

/**
 * The taxonomy itself, re-exported so the UI layers read it from the entity
 * that owns catalog data rather than reaching into the backend package.
 */
export { ARTIFACT_KINDS, isArtifactKind } from '@dsh-fish/backend/domain/artifact/artifact-kind.js'
export { CATEGORIES, isCategory } from '@dsh-fish/backend/domain/artifact/category.js'
export { TOPICS, isTopic } from '@dsh-fish/backend/domain/artifact/topic.js'
export type { TopicId } from '@dsh-fish/backend/domain/artifact/topic.js'
export {
  FACET_VALUE_LIMITS,
  canAddFacetValue,
  exceededFacet,
} from '@dsh-fish/backend/domain/artifact/facet-bounds.js'
