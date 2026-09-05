import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { buildDailyPlan } from '../dailyLearning/dailyPlan';
import {
  buildTodaySkillStates,
  buildTodayAdaptiveRecommendation,
  launchTodayAdaptiveLesson,
} from './todayAdaptiveRecommendation';
import type { AdaptiveRecommendationV1 } from './adaptiveRecommendation';

const now = new Date('2026-09-05T08:00:00.000Z');

const card = (id: string, overrides: Partial<CardData> = {}): CardData => ({
  id,
  word: id,
  translation: `meaning-${id}`,
  explanation: '',
  phonetic: '',
  emoji: '📘',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

describe('today adaptive recommendation adapter', () => {
  it('maps owner-scoped listening evidence from a licensed chunk to its lexeme state', () => {
    const states = buildTodaySkillStates([{
      schemaVersion: 4,
      id: 'evidence-1',
      ownerId: 'owner-a',
      target: { kind: 'chunk', id: 'voa-chunk' },
      skill: 'listening',
      source: 'listening',
      activityId: 'voa-clip',
      score: 0.25,
      observedAt: now.toISOString(),
    }], 'owner-a', new Map([['voa-chunk', ['lexeme-a']]]));

    expect(states.get('lexeme-a')).toMatchObject({
      target: { kind: 'lexeme', id: 'lexeme-a' },
      ownerId: 'owner-a',
      dimensions: { listening: { score: 0.25, observations: 1 } },
    });
    expect(states.has('other-lexeme')).toBe(false);
  });

  it('projects a signed-in bounded plan and prioritizes due work', () => {
    const plan = buildDailyPlan([
      card('new-item'),
      card('due-item', { reviews: 1, difficulty: 'hard', nextReviewDate: '2026-09-04T08:00:00.000Z' }),
    ], { now });

    expect(buildTodayAdaptiveRecommendation({ ownerId: 'owner-a', plan, isOffline: false, now })).toMatchObject({
      kind: 'exercise',
      lexemeId: 'due-item',
      reason: { kind: 'due', label: 'Review due' },
      window: { targetActivities: 10 },
    });
  });

  it('fails closed when there is no owner or projection input is malformed', () => {
    const plan = buildDailyPlan([card('valid-item')], { now });
    expect(buildTodayAdaptiveRecommendation({ ownerId: null, plan, isOffline: false, now })).toBeNull();
    expect(buildTodayAdaptiveRecommendation({ ownerId: ' ', plan, isOffline: false, now })).toBeNull();
    expect(buildTodayAdaptiveRecommendation({
      ownerId: 'owner-a',
      plan: buildDailyPlan([card('bad/item')], { now }),
      isOffline: false,
      now,
    })).toBeNull();
  });

  it('does not turn a card audio URL into an Immerse recommendation', () => {
    const plan = buildDailyPlan([card('audio-item', { audioUrl: 'https://example.test/audio.mp3' })], { now });

    expect(buildTodayAdaptiveRecommendation({ ownerId: 'owner-a', plan, isOffline: false, now })).not.toMatchObject({
      kind: 'immerse',
    });
  });

  it('launches recommended listening in the card lesson, never the VOA pilot, and keeps its session bound', () => {
    const recommendation: Extract<AdaptiveRecommendationV1, { kind: 'exercise' }> = {
      kind: 'exercise',
      activityId: 'activity-1',
      courseId: 'course-1',
      scenarioId: 'scenario-1',
      lexemeId: 'lexeme-1',
      card: card('lexeme-1'),
      mode: 'listening',
      reason: { kind: 'next', label: 'Continue the scenario' },
      window: { targetActivities: 10, maximumNewItems: 8 },
    };

    expect(launchTodayAdaptiveLesson(recommendation)).toEqual({
      mode: 'listening',
      allowListenPilot: false,
      maximumActivities: 10,
    });
  });
});
