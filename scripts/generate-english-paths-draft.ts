import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  type CatalogLexemeCandidateV1,
  type CatalogMembershipCandidateV1,
  type CatalogSourceBundleV1,
  type CatalogUnitDescriptorV1,
} from '../src/features/catalogPipeline/catalogContracts';
import { validateCatalogSourceBundle } from '../src/features/catalogPipeline/catalogValidation';
import { createLexemeId, createTrackMembershipId } from '../src/features/multilingual/lexemeIdentity';
import type { LexemeV3, TrackMembershipV3 } from '../src/features/multilingual/schemaV3';

type TrackId = 'general' | 'ielts' | 'toeic';
type PartOfSpeech = 'noun' | 'verb' | 'adjective';

interface DraftLexeme {
  lemma: string;
  partOfSpeech: PartOfSpeech;
  vietnamese: string;
  exampleEn: string;
  exampleVi: string;
}

interface DraftUnit {
  unitId: string;
  titleEn: string;
  titleVi: string;
  lemmas: string[];
}

interface DraftTrack {
  trackId: TrackId;
  tier: 'foundation' | 'core' | 'advanced';
  units: DraftUnit[];
  lexemes: DraftLexeme[];
}

const ROOT = fileURLToPath(new URL('../catalog/english-paths-draft/', import.meta.url));
const OUTPUT = path.join(ROOT, 'source');
const TIMESTAMP = '2026-09-28T00:00:00.000Z';
const PROVENANCE = {
  schemaVersion: 1,
  sourceRef: 'sonflash-english-paths-draft',
  sourceUrl: null,
  licenseId: 'NOASSERTION',
  rightsEvidenceId: null,
  attribution: 'AI-assisted SonFlash draft; independent language and rights review required.',
  authorId: 'codex-editorial-draft',
  origin: 'ai-assisted',
  generator: { provider: 'openai', model: 'gpt-5.6-terra' },
  publishability: 'review-required',
} as const;

const TRACKS = [
  { id: 'general', tier: 'foundation', cefr: 'A2', skills: ['reading', 'writing', 'listening', 'speaking'], category: 'General' },
  { id: 'ielts', tier: 'advanced', cefr: 'B2-C1', skills: ['reading', 'writing', 'listening', 'speaking'], category: 'IELTS' },
  { id: 'toeic', tier: 'core', cefr: 'B1', skills: ['reading', 'listening'], category: 'TOEIC' },
] as const;

const nonempty = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty, trimmed string.`);
  }
  return value;
};

const createLexeme = (draft: DraftLexeme): CatalogLexemeCandidateV1 => {
  const lemma = nonempty(draft.lemma, 'lemma');
  const vietnamese = nonempty(draft.vietnamese, `${lemma}.vietnamese`);
  const exampleEn = nonempty(draft.exampleEn, `${lemma}.exampleEn`);
  const exampleVi = nonempty(draft.exampleVi, `${lemma}.exampleVi`);
  if (!['noun', 'verb', 'adjective'].includes(draft.partOfSpeech)) {
    throw new TypeError(`${lemma}.partOfSpeech is invalid.`);
  }
  const identity = {
    language: 'en', normalizedLemma: lemma.toLowerCase(),
    partOfSpeech: draft.partOfSpeech, senseKey: 'primary',
  };
  const entity: LexemeV3 = {
    schemaVersion: 3,
    id: createLexemeId(identity),
    ...identity,
    lemma,
    definitions: [{ language: 'vi', text: vietnamese }],
    phonetics: [],
    examples: [{ text: exampleEn, translations: [{ language: 'vi', text: exampleVi }] }],
    collocations: [],
    wordFamily: [],
    media: { audioUrl: null, imageUrl: null },
    compatibility: {
      legacyPartOfSpeech: draft.partOfSpeech,
      translation: vietnamese,
      explanation: '', explanationTranslation: '', emoji: '',
      exampleSentence: exampleEn, exampleTranslation: exampleVi,
      synonyms: [], antonyms: [], register: '', commonMistake: '',
    },
    provenance: {
      source: PROVENANCE.sourceRef,
      license: PROVENANCE.licenseId,
      reviewer: 'unreviewed',
      editorialStatus: 'draft',
    },
    contentVersion: 1,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
  return { entity, provenance: PROVENANCE, review: { status: 'unreviewed' } };
};

const loadTrack = async (id: TrackId): Promise<DraftTrack> => JSON.parse(
  await readFile(path.join(ROOT, `${id}.json`), 'utf8'),
) as DraftTrack;

const assemble = async (): Promise<CatalogSourceBundleV1> => {
  const lexemes: CatalogLexemeCandidateV1[] = [];
  const lexemeById = new Map<string, CatalogLexemeCandidateV1>();
  const memberships: CatalogMembershipCandidateV1[] = [];
  const unitDescriptors: CatalogUnitDescriptorV1[] = [];

  for (const track of TRACKS) {
    const draft = await loadTrack(track.id);
    if (draft.trackId !== track.id || draft.tier !== track.tier) {
      throw new TypeError(`${track.id} has the wrong track or tier.`);
    }
    if (draft.lexemes.length !== 100 || draft.units.length !== 15) {
      throw new TypeError(`${track.id} requires 100 lexemes and 15 units.`);
    }
    const byLemma = new Map(draft.lexemes.map(item => [item.lemma, item]));
    if (byLemma.size !== 100) throw new TypeError(`${track.id} repeats a lexeme.`);
    const assigned = new Set<string>();
    let rank = 0;

    for (const [index, unit] of draft.units.entries()) {
      if (unit.unitId !== `${track.id}-${track.tier}-${index + 1}`) {
        throw new TypeError(`${track.id} unit ${index + 1} has an unstable identifier.`);
      }
      if (unit.lemmas.length < 1 || unit.lemmas.length > 20) {
        throw new TypeError(`${unit.unitId} requires 1–20 lexemes.`);
      }
      unitDescriptors.push({
        unitId: unit.unitId,
        trackId: track.id,
        tier: track.tier,
        ordinal: index + 1,
        titles: [
          { language: 'en', text: nonempty(unit.titleEn, `${unit.unitId}.titleEn`) },
          { language: 'vi', text: nonempty(unit.titleVi, `${unit.unitId}.titleVi`) },
        ],
      });

      for (const lemma of unit.lemmas) {
        const item = byLemma.get(lemma);
        if (!item || assigned.has(lemma)) throw new TypeError(`${unit.unitId} has an unknown or repeated lemma: ${lemma}.`);
        assigned.add(lemma);
        const candidate = createLexeme(item);
        const existing = lexemeById.get(candidate.entity.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(candidate)) {
          throw new TypeError(`${lemma} has conflicting content across tracks.`);
        }
        if (!existing) {
          lexemeById.set(candidate.entity.id, candidate);
          lexemes.push(candidate);
        }
        const identity = { trackId: track.id, lexemeId: candidate.entity.id };
        const entity: TrackMembershipV3 = {
          schemaVersion: 3,
          id: createTrackMembershipId(identity),
          ...identity,
          tier: track.tier,
          cefrLevel: track.cefr,
          topic: unit.titleEn,
          legacyCategory: track.category,
          skills: track.skills,
          rank: rank++,
          lessonGroup: unit.unitId,
          editorialStatus: 'draft',
          contentVersion: 1,
        };
        memberships.push({ entity, provenance: PROVENANCE, review: { status: 'unreviewed' } });
      }
    }
    if (assigned.size !== 100) throw new TypeError(`${track.id} leaves ${100 - assigned.size} lexemes unassigned.`);
  }

  return {
    manifest: {
      manifestVersion: 2,
      catalogId: 'english-paths-wave1-draft',
      contentLanguage: 'en',
      supportLanguages: ['vi'],
      lexemeFiles: ['lexemes.jsonl'],
      membershipFiles: ['memberships.jsonl'],
      unitDescriptorFile: 'unit-descriptors.json',
    },
    lexemes,
    memberships,
    unitDescriptors,
  };
};

const main = async (): Promise<void> => {
  const source = await assemble();
  const result = validateCatalogSourceBundle(source);
  if (result.status !== 'accepted') {
    throw new TypeError(`Draft failed catalog validation: ${JSON.stringify(result.issues)}`);
  }
  await mkdir(OUTPUT, { recursive: true });
  await Promise.all([
    writeFile(path.join(OUTPUT, 'manifest.json'), `${JSON.stringify(source.manifest, null, 2)}\n`),
    writeFile(path.join(OUTPUT, 'lexemes.jsonl'), `${source.lexemes.map(item => JSON.stringify(item)).join('\n')}\n`),
    writeFile(path.join(OUTPUT, 'memberships.jsonl'), `${source.memberships.map(item => JSON.stringify(item)).join('\n')}\n`),
    writeFile(path.join(OUTPUT, 'unit-descriptors.json'), `${JSON.stringify(source.unitDescriptors, null, 2)}\n`),
  ]);
  console.log(JSON.stringify({
    status: 'draft-valid',
    lexemes: source.lexemes.length,
    memberships: source.memberships.length,
    units: source.unitDescriptors?.length,
    publishable: false,
  }));
};

await main();
