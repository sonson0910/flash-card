import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { QuizQuestion } from './practiceModel';
import { QuizView } from './QuizView';
import { SpellingView } from './SpellingView';
import { StudyView, resolveStudyRecallMode } from './StudyView';
import { StoryView } from './StoryView';
import { ReviewControls } from '../../components/study/ReviewControls';
import { ActiveRecallPrompt } from '../../components/flashcard/ActiveRecallPrompt';

const quizQuestion: QuizQuestion = {
  card: {
    id: 'hello',
    word: 'hello',
    translation: 'xin chào',
    explanation: 'A greeting.',
    phonetic: '/həˈləʊ/',
    emoji: '👋',
    category: 'Greetings',
    audioUrl: null,
    imageUrl: null,
  },
  type: 'en-to-vi',
  options: ['xin chào', 'tạm biệt', 'cảm ơn', 'xin lỗi'],
  correctAnswer: 'xin chào',
};

describe('practice view accessibility contracts', () => {
  it('keeps focus visible and avoids transition-all across practice screens', () => {
    const sources = ['QuizView.tsx', 'SpellingView.tsx', 'StoryView.tsx', 'StudyView.tsx']
      .map(file => readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8'))
      .join('\n');

    expect(sources).not.toContain('outline-none');
    expect(sources).not.toContain('transition-all');
    expect(sources).toContain('focus-visible:');
    expect(sources).toContain('motion-reduce:');
  });

  it('groups quiz answers with a legend and lets long choices wrap', () => {
    const longAnswer = 'một-câu-trả-lời-rất-dài-không-có-khoảng-trắng-để-kiểm-tra-xuống-dòng';
    const html = renderToStaticMarkup(
      <QuizView
        questions={[{ ...quizQuestion, options: [longAnswer, 'tạm biệt'], correctAnswer: longAnswer }]}
        currentIndex={0}
        selectedAnswer={null}
        answeredCorrectly={null}
        score={0}
        showResults={false}
        onSelect={vi.fn()}
        onNext={vi.fn()}
        onRestart={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toMatch(/<fieldset[^>]*>.*?<legend[^>]*>Choose one answer<\/legend>.*?<button/s);
    expect(html).toMatch(new RegExp(`<span[^>]*class="[^"]*whitespace-normal[^"]*\\[overflow-wrap:anywhere\\][^"]*"[^>]*>${longAnswer}<\\/span>`));
    expect(html).not.toContain('truncate');
  });

  it('renders quiz feedback as an atomic live-region announcement', () => {
    const html = renderToStaticMarkup(
      <QuizView
        questions={[quizQuestion]}
        currentIndex={0}
        selectedAnswer="xin chào"
        answeredCorrectly
        score={1}
        showResults={false}
        onSelect={vi.fn()}
        onNext={vi.fn()}
        onRestart={vi.fn(async () => {})}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('Correct answer.');
    expect(html).toMatch(/<button[^>]*lang="vi"[^>]*>.*?xin chào.*?<\/button>/s);
  });

  it('marks Vietnamese quiz prompts and feedback according to the question direction', () => {
    const vietnamesePromptHtml = renderToStaticMarkup(
      <QuizView
        questions={[{ ...quizQuestion, type: 'vi-to-en', options: ['hello', 'goodbye'], correctAnswer: 'hello' }]}
        currentIndex={0}
        selectedAnswer={null}
        answeredCorrectly={null}
        score={0}
        showResults={false}
        onSelect={vi.fn()}
        onNext={vi.fn()}
        onRestart={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const vietnameseAnswerHtml = renderToStaticMarkup(
      <QuizView
        questions={[quizQuestion]}
        currentIndex={0}
        selectedAnswer="tạm biệt"
        answeredCorrectly={false}
        score={0}
        showResults={false}
        onSelect={vi.fn()}
        onNext={vi.fn()}
        onRestart={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(vietnamesePromptHtml).toMatch(/<span[^>]*lang="vi"[^>]*>“xin chào”<\/span>/);
    expect(vietnameseAnswerHtml).toContain('<span lang="vi">“xin chào”</span>');
  });

  it('renders spelling feedback, focus destinations, progress semantics, and full-size actions', () => {
    const questionHtml = renderToStaticMarkup(
      <SpellingView
        cards={[quizQuestion.card]}
        currentIndex={0}
        input="goodbye"
        checked
        correct={false}
        score={0}
        showResults={false}
        onInput={vi.fn()}
        onCheck={vi.fn()}
        onNext={vi.fn()}
        onRestart={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const resultsHtml = renderToStaticMarkup(
      <SpellingView
        cards={[quizQuestion.card]}
        currentIndex={0}
        input="hello"
        checked
        correct
        score={1}
        showResults
        onInput={vi.fn()}
        onCheck={vi.fn()}
        onNext={vi.fn()}
        onRestart={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(questionHtml).toContain('id="spelling-question-heading"');
    expect(questionHtml).toMatch(/<h3[^>]*lang="vi"[^>]*>xin chào<\/h3>/);
    expect(questionHtml).toContain('role="status"');
    expect(questionHtml).toContain('aria-live="polite"');
    expect(questionHtml).toContain('aria-atomic="true"');
    expect(questionHtml).toContain('Incorrect. The correct answer is “hello”.');
    expect(questionHtml).toContain('role="progressbar"');
    expect(questionHtml).toContain('aria-label="Spelling progress"');
    expect(questionHtml).toContain('aria-valuemin="0"');
    expect(questionHtml).toContain('aria-valuemax="1"');
    expect(questionHtml).toContain('aria-valuenow="1"');
    expect(questionHtml).toMatch(/<button[^>]*class="[^"]*min-h-11[^"]*"[^>]*>.*?Exit<\/button>/s);
    expect(resultsHtml).toContain('aria-labelledby="spelling-results-heading"');
    expect(resultsHtml).toContain('id="spelling-results-heading"');
    expect(resultsHtml).toContain('tabindex="-1"');
  });

  it('renders story generation as busy status and the result with a labelled heading', () => {
    const loadingHtml = renderToStaticMarkup(
      <StoryView story={null} loading onGenerate={vi.fn()} onClose={vi.fn()} />,
    );
    const storyHtml = renderToStaticMarkup(
      <StoryView
        story={{ story: 'Hello there.', translation: 'Xin chào.' }}
        loading={false}
        onGenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(loadingHtml).toContain('aria-busy="true"');
    expect(loadingHtml).toContain('Creating your story');
    expect(storyHtml).toContain('aria-labelledby="story-heading"');
    expect(storyHtml).toContain('Your story is ready.');
    expect(storyHtml).toMatch(/<p[^>]*lang="vi"[^>]*>Xin chào\.<\/p>/);
  });

  it('renders story failures as retryable errors rather than completed reading content', () => {
    const html = renderToStaticMarkup(
      <StoryView
        story={null}
        loading={false}
        error="Could not generate a story right now. Please try again."
        onGenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not generate a story right now. Please try again.');
    expect(html).toContain('Try again');
    expect(html).not.toContain('Reading in context');
    expect(html).not.toContain('Your story is ready.');
  });

  it('announces review persistence while saving and leaves failed reviews retryable', () => {
    const savingHtml = renderToStaticMarkup(
      <ReviewControls revealed reviewed={false} saving onRate={vi.fn()} />,
    );
    const failedHtml = renderToStaticMarkup(
      <ReviewControls
        revealed
        reviewed={false}
        error="Could not save this review. Choose a rating to try again."
        onRate={vi.fn()}
      />,
    );

    expect(savingHtml).toContain('Saving review');
    expect(savingHtml).toMatch(/<button[^>]*disabled=/);
    expect(savingHtml).not.toContain('Review saved');
    expect(failedHtml).toContain('role="alert"');
    expect(failedHtml).toContain('Choose a rating to try again');
    expect(failedHtml).not.toMatch(/<button[^>]*disabled=/);
  });

  it('advertises only modifier-based study character shortcuts', () => {
    const controlsHtml = renderToStaticMarkup(
      <ReviewControls revealed reviewed={false} onRate={vi.fn()} />,
    );
    const studyHtml = renderToStaticMarkup(
      <StudyView
        cards={[quizQuestion.card]}
        index={0}
        recallMode="en-to-vi"
        revealed={false}
        reviewedCardId={null}
        customDecks={[]}
        onClose={vi.fn()}
        onRecallMode={vi.fn()}
        onReveal={vi.fn()}
        onBookmark={vi.fn()}
        onAssignDeck={vi.fn()}
        onUpdateCard={vi.fn()}
        onImageUnavailable={vi.fn()}
        onRate={vi.fn()}
        onIndex={vi.fn()}
      />,
    );

    expect(controlsHtml).toContain('aria-keyshortcuts="Alt+1"');
    expect(controlsHtml).toContain('aria-keyshortcuts="Alt+4"');
    expect(studyHtml).toContain('Alt+1…4');
    expect(studyHtml).toContain('Alt+S / Alt+P / Alt+R');
  });

  it('disables image recall and preserves the English-answer direction when image media is unavailable', () => {
    const cardWithoutUsableImage = {
      ...quizQuestion.card,
      imageUrl: 'https://example.com/untrusted-image.jpg',
    };
    const studyHtml = renderToStaticMarkup(
      <StudyView
        cards={[cardWithoutUsableImage]}
        index={0}
        recallMode="image-to-word"
        revealed={false}
        reviewedCardId={null}
        customDecks={[]}
        onClose={vi.fn()}
        onRecallMode={vi.fn()}
        onReveal={vi.fn()}
        onBookmark={vi.fn()}
        onAssignDeck={vi.fn()}
        onUpdateCard={vi.fn()}
        onImageUnavailable={vi.fn()}
        onRate={vi.fn()}
        onIndex={vi.fn()}
      />,
    );

    expect(resolveStudyRecallMode(cardWithoutUsableImage, 'image-to-word')).toBe('vi-to-en');
    expect(studyHtml).toMatch(/<option value="image-to-word" disabled="">Image → Word<\/option>/);
    expect(studyHtml).toMatch(/<option value="vi-to-en" selected="">Vietnamese → English<\/option>/);
    expect(studyHtml).toContain('Recall the English word');
    expect(studyHtml).not.toContain('Name what you see');
    expect(studyHtml).not.toContain('No illustration available');
  });

  it('keeps image recall available for a supported image URL', () => {
    const cardWithSupportedImage = {
      ...quizQuestion.card,
      imageUrl: 'https://images.pexels.com/photos/123/example.jpg',
    };
    const studyHtml = renderToStaticMarkup(
      <StudyView
        cards={[cardWithSupportedImage]}
        index={0}
        recallMode="image-to-word"
        revealed={false}
        reviewedCardId={null}
        customDecks={[]}
        onClose={vi.fn()}
        onRecallMode={vi.fn()}
        onReveal={vi.fn()}
        onBookmark={vi.fn()}
        onAssignDeck={vi.fn()}
        onUpdateCard={vi.fn()}
        onImageUnavailable={vi.fn()}
        onRate={vi.fn()}
        onIndex={vi.fn()}
      />,
    );

    expect(studyHtml).toMatch(/<option value="image-to-word" selected="">Image → Word<\/option>/);
    expect(studyHtml).not.toMatch(/<option value="image-to-word" disabled=/);
    expect(studyHtml).toContain('Name what you see');
  });

  it('falls back to the English-answer direction after a supported image fails at runtime', () => {
    const cardWithSupportedImage = {
      ...quizQuestion.card,
      imageUrl: 'https://images.pexels.com/photos/123/missing.jpg',
    };

    expect(resolveStudyRecallMode(cardWithSupportedImage, 'image-to-word', true)).toBe('vi-to-en');
  });

  it('exposes a missing recall illustration as a named image placeholder', () => {
    const html = renderToStaticMarkup(
      <ActiveRecallPrompt card={quizQuestion.card} mode="image-to-word" onReveal={vi.fn()} />,
    );

    expect(html).toMatch(/<div[^>]*role="img"[^>]*aria-label="No illustration available"/);
  });
});
