// The Safety panel's answer from the server (POST <base>api/safety, server/main.py) and its
// wording (docs/plans/v2-safety-snapshot.md, decisions 4 to 6). Pure: no browser or Vite APIs,
// so the browser tests compare the panel with these same functions.
import { isPictogramCode, type PictogramCode } from './ghsPictograms';
import { pubchemCompoundPage } from '../pubchemPage';

const NOT_RESPONDING = { kind: 'not-responding' } as const;

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNameOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export interface GhsStatement {
  code: string;
  /** CLP Annex VI's * notes, "**". */
  annexNote: string | null;
  /** ECHA's share of notifications with this code, "37.7%". */
  share: string | null;
  words: string;
  hazardClass: string | null;
}

/** One source's GHS classification, as PubChem lists it (server/ghs.py). */
export interface GhsClassification {
  source: 'eu' | 'echa' | 'other';
  sourceName: string;
  entry: string | null;
  sourceUrl: string | null;
  /** The EU entry's Annex VI index number. */
  indexNo: string | null;
  notClassified: boolean;
  signal: 'Danger' | 'Warning' | null;
  pictograms: { code: PictogramCode; name: string }[];
  statements: GhsStatement[];
  notes: string[];
  summary: string[];
}

export type SafetyOutcome =
  | {
      kind: 'found';
      cid: number;
      title: string | null;
      url: string;
      /** Null: PubChem lists no GHS classification for this compound. */
      classification: GhsClassification | null;
      /** PubChem's other classifications, not shown: how many, and their sources. */
      others: { count: number; sources: string[] };
    }
  | { kind: 'not-found' }
  | { kind: 'busy' }
  | { kind: 'invalid' }
  | { kind: 'not-responding' };

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isTexts(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isText);
}

function fields(value: unknown, keys: string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const own = Object.keys(record).sort();
  return own.length === keys.length && [...keys].sort().every((k, i) => k === own[i]) ? record : null;
}

function statementFrom(value: unknown): GhsStatement | null {
  const s = fields(value, ['code', 'annex_note', 'share', 'words', 'hazard_class']);
  if (!s || !isText(s.code) || !isText(s.words)) return null;
  if (![s.annex_note, s.share, s.hazard_class].every((v) => v === null || isText(v))) return null;
  return {
    code: s.code,
    annexNote: s.annex_note as string | null,
    share: s.share as string | null,
    words: s.words,
    hazardClass: s.hazard_class as string | null,
  };
}

const CLASSIFICATION_KEYS = [
  'source',
  'source_name',
  'entry',
  'source_url',
  'index_no',
  'not_classified',
  'signal',
  'pictograms',
  'statements',
  'notes',
  'summary',
];

/** A classification exactly as the server sends it, or null if anything is unexpected. */
function classificationFrom(value: unknown): GhsClassification | null {
  const c = fields(value, CLASSIFICATION_KEYS);
  if (!c || (c.source !== 'eu' && c.source !== 'echa' && c.source !== 'other') || !isText(c.source_name)) return null;
  if (![c.entry, c.source_url, c.index_no].every((v) => v === null || isText(v))) return null;
  if (typeof c.not_classified !== 'boolean' || !(c.signal === null || c.signal === 'Danger' || c.signal === 'Warning')) {
    return null;
  }
  if (!Array.isArray(c.pictograms) || !Array.isArray(c.statements) || !isTexts(c.notes) || !isTexts(c.summary)) return null;
  const pictograms = c.pictograms.map((p) => fields(p, ['code', 'name']));
  if (!pictograms.every((p) => p && isPictogramCode(p.code) && isText(p.name))) return null;
  const statements = c.statements.map(statementFrom);
  if (!statements.every((s) => s !== null)) return null;
  // Not classified: no hazards. Classified: at least one statement.
  if (c.not_classified ? statements.length > 0 || pictograms.length > 0 || c.signal !== null : statements.length === 0) {
    return null;
  }
  return {
    source: c.source,
    sourceName: c.source_name,
    entry: c.entry as string | null,
    sourceUrl: c.source_url as string | null,
    indexNo: c.index_no as string | null,
    notClassified: c.not_classified,
    signal: c.signal,
    pictograms: pictograms.map((p) => ({ code: p!.code as PictogramCode, name: p!.name as string })),
    statements: statements as GhsStatement[],
    notes: c.notes,
    summary: c.summary,
  };
}

/** What the Safety panel shows, from the server's status and answer. Anything unexpected
 * counts as not responding, so a partial hazard list is never shown; a link is shown only if
 * it is exactly the CID's PubChem page. */
export function safetyOutcome(status: number, body: unknown): SafetyOutcome {
  const answer = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (status === 503 && answer.error === 'busy') return { kind: 'busy' };
  if (status === 400 && answer.error === 'invalid_structure') return { kind: 'invalid' };
  if (status !== 200) return NOT_RESPONDING;
  const a = fields(body, ['found', 'cid', 'title', 'url', 'classification', 'others']);
  const others = fields(a?.others, ['count', 'sources']);
  if (!a || !others || !isCount(others.count) || !isTexts(others.sources)) return NOT_RESPONDING;
  if (a.found === false) {
    const empty = a.cid === null && a.title === null && a.url === null && a.classification === null;
    return empty && others.count === 0 ? { kind: 'not-found' } : NOT_RESPONDING;
  }
  const { cid, title, url } = a;
  if (a.found !== true || !isCount(cid) || cid === 0 || url !== pubchemCompoundPage(cid) || !isNameOrNull(title)) {
    return NOT_RESPONDING;
  }
  const classification = a.classification === null ? null : classificationFrom(a.classification);
  if (a.classification !== null && classification === null) return NOT_RESPONDING;
  return {
    kind: 'found',
    cid,
    title,
    url,
    classification,
    others: { count: others.count, sources: others.sources },
  };
}


/** Decision 4: shown with every result. */
export const REMINDER =
  "For learning only. This is a summary from PubChem, not a safety data sheet (SDS) or a risk assessment. Before you handle any chemical, read the supplier's SDS and your lab's COSHH risk assessment.";

/** What the panel says when it has no classification to show (decision 6). */
export const SAFETY_MESSAGES = {
  asking: 'Asking PubChem…',
  'not-found': 'PubChem has no record of this exact structure, so it has no safety data for it.',
  busy: 'Busy, try again shortly.',
  'not-responding': "The lookup service isn't responding; try again in a minute.",
  invalid: "This structure can't be looked up. Check it for errors such as a wrong valence.",
  reaction: 'Safety works on structures, not reactions.',
} as const;

export function noneListed(cid: number): string {
  return `PubChem lists no GHS hazard classification for this compound (CID ${cid}). That does not mean it is safe. Another form of it (a salt, a hydrate, or a different stereoisomer or ring form) may have its own record.`;
}

export const NOT_CLASSIFIED = 'Not classified as hazardous by this source.';

export function othersLine(count: number, sources: string[]): string {
  const more = count === 1 ? '1 more classification' : `${count} more classifications`;
  // Semicolons: a source's own name may hold a comma ("…(HCIS), Safe Work Australia").
  return `PubChem lists ${more} for this compound (${sources.join('; ')}). They may differ.`;
}

/** ECHA's terms require this acknowledgement, exactly, in each copy of its data. */
export const ECHA_ACKNOWLEDGEMENT = 'Source: European Chemicals Agency, http://echa.europa.eu/';

/** CC BY 4.0 §3(a)(1)(C): the licence's URI, as plain text (invariant 1). */
export const CC_BY = 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)';

/** The credit line for the shown source (decision 5): plain text, never a link. */
export function credit(c: GhsClassification, cid: number): string {
  const via = `via PubChem, CID ${cid}`;
  if (c.source === 'eu') {
    const entry = c.indexNo ? `, entry ${c.indexNo}` : '';
    const where = c.sourceUrl ? `, EUR-Lex (${c.sourceUrl})` : ', EUR-Lex';
    return `Source: Regulation (EC) No 1272/2008 (CLP), Annex VI${entry}${where}, © European Union, ${CC_BY}; ${via}.`;
  }
  if (c.source === 'echa') {
    const of = c.entry ?? 'this substance';
    return `${ECHA_ACKNOWLEDGEMENT}. Notified classification (C&L Inventory) of ${of}, aggregated by PubChem, CID ${cid}.`;
  }
  const parts = [c.sourceName, c.entry, c.sourceUrl].filter((p): p is string => p !== null);
  const inPart = c.sourceName === 'NITE-CMC' ? ', shown in part' : '';
  return `Source: ${parts.join(', ')}; ${via}${inPart}.`;
}
