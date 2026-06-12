import type { JobVacancy } from './dto/job-vacancy.dto';

/**
 * Cross-source dedupe key: the same vacancy appears on several boards
 * (joblab/aggregators repost gsz and rabota.by listings) under slightly
 * different titles — e.g. joblab appends "(г. Мосты)" to gsz's plain title,
 * and employer legal forms vary ("Евроопт" vs ООО «Евроопт»).
 *
 * Normalization: lowercase, drop quotes, drop a trailing parenthetical, drop
 * a leading legal-form abbreviation, collapse whitespace. Key = title + employer.
 */
const LEGAL_FORM_RE =
  /^(ооо|оао|одо|зао|чуп|чтуп|чпуп|уп|руп|куп|ип|фх|кфх|сооо|иооо|гу|гуо|уо)\s+/;

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/["'«»„“”]/g, '')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEGAL_FORM_RE, '');

export const dedupeKey = (v: Pick<JobVacancy, 'title' | 'employer'>): string =>
  `${normalize(v.title)}|${normalize(v.employer ?? '')}`;
