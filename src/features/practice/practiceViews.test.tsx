import { i18n } from '@lingui/core';
import { messages as enPractice } from '../../i18n/locales/en/practice.po';
i18n.load('en', enPractice); i18n.activate('en');
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { QuizQuestion } from "./practiceModel";
import type { CardData } from "../../types/card";
import { languageName, QuizView } from "./QuizView";
import { SpellingView } from "./SpellingView";
import { StudyView, resolveStudyRecallMode } from "./StudyView";
import { isComprehensionAnswerCorrect, isGrammarAnswerCorrect, normalizeGrammarAnswer } from "./StoryView";
import { StoryView } from "./StoryView";
import { ReviewControls } from "../../components/study/ReviewControls";
import { ActiveRecallPrompt } from "../../components/flashcard/ActiveRecallPrompt";
import { writeFocusModeEnabled } from "../settings/focus-mode-preference";
import { createPracticeSessionLifecycle } from "./practiceSessionLifecycle";
import { usePracticeGames } from "./usePracticeGames";

vi.mock("@lingui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lingui/react")>()),
  Trans: ({
    message,
    values,
  }: {
    message: string;
    values?: Record<string, unknown>;
  }) =>
    message.split(/(\{\w+\})/).map((part) => {
      const key = part.slice(1, -1);
      return part.startsWith("{") && part.endsWith("}")
        ? (values?.[key] ?? part)
        : part;
    }),
  useLingui: () => ({
    _: (message: { message: string }) => message.message,
    i18n: {
      locale: "en",
      _: (id: string, values?: Record<string, unknown>) => {
        const messages: Record<string, string> = {
          "practice.quiz.target-to-native-question":
            "What does {word} mean in {nativeLanguageName}?",
          "practice.quiz.native-to-target-question":
            "Which {targetLanguageName} word matches “{translation}”?",
          "practice.feedback.correct": "Correct answer.",
          "practice.feedback.incorrect":
            "Incorrect. The correct answer is “{correctAnswer}”.",
          "practice.spelling.play-pronunciation":
            "Play pronunciation for {word}",
          "practice.spelling.answer-placeholder":
            "Type the {targetLanguage} word…",
          "practice.spelling.answer-label": "Type the {targetLanguage} word",
          "practice.spelling.progress": "Spelling progress",
          "practice.story.creating": "Creating your story.",
          "practice.story.ready": "Your story is ready.",
          "practice.story.close": "Close story",
        };
        return (messages[id] ?? id).replace(/\{(\w+)\}/g, (_, key) =>
          String(values?.[key] ?? `{${key}}`),
        );
      },
    },
  }),
}));

vi.mock("../../components/motion/GsapEntrance", () => ({
  GsapEntrance: ({ animationKey: _animationKey, variant: _variant, ...props }: Record<string, unknown>) => (
    <div {...props} />
  ),
}));

const gemini = vi.hoisted(() => ({ generateStoryContext: vi.fn() }));

vi.mock("../courses/CourseGate", () => ({
  useCourseSession: () => ({ model: { activeCourse: null } }),
}));

vi.mock("../../lib/gemini", () => ({
  generateStoryContext: gemini.generateStoryContext,
}));

const installMinimalReactDom = () => {
  type DocumentLike = {
    nodeType: number;
    activeElement: ElementNode | null;
    defaultView: typeof globalThis;
    documentElement: ElementNode;
    createElement(tagName: string): ElementNode;
    createElementNS(_namespace: string, tagName: string): ElementNode;
    createTextNode(text: string): TextNode;
    addEventListener(): void;
    removeEventListener(): void;
  };
  class TextNode {
    readonly nodeType = 3;
    readonly nodeName = "#text";
    parentNode: ElementNode | null = null;
    ownerDocument!: DocumentLike;
    constructor(public nodeValue: string) {}
    get textContent() { return this.nodeValue; }
    set textContent(value: string) { this.nodeValue = value; }
  }
  class ElementNode {
    readonly nodeType = 1;
    readonly nodeName: string;
    readonly tagName: string;
    readonly namespaceURI = "http://www.w3.org/1999/xhtml";
    readonly childNodes: Array<ElementNode | TextNode> = [];
    readonly attributes = new Map<string, string>();
    parentNode: ElementNode | null = null;
    ownerDocument!: DocumentLike;
    style = {};
    constructor(tagName: string) { this.nodeName = tagName.toUpperCase(); this.tagName = this.nodeName; }
    appendChild(child: ElementNode | TextNode) { child.parentNode = this; this.childNodes.push(child); return child; }
    insertBefore(child: ElementNode | TextNode, before: ElementNode | TextNode | null) {
      child.parentNode = this;
      const index = before ? this.childNodes.indexOf(before) : -1;
      if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child);
      return child;
    }
    removeChild(child: ElementNode | TextNode) {
      this.childNodes.splice(this.childNodes.indexOf(child), 1);
      child.parentNode = null;
      return child;
    }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    addEventListener() {}
    removeEventListener() {}
    focus() { this.ownerDocument.activeElement = this; }
    click() {
      const propsKey = Object.keys(this).find((key) => key.startsWith("__reactProps$"));
      const event = { currentTarget: this, target: this, preventDefault() {}, stopPropagation() {} };
      (propsKey ? (this as unknown as Record<string, { onClick?: (event: unknown) => void }>)[propsKey]?.onClick : undefined)?.(event);
    }
    get textContent(): string { return this.childNodes.map((child) => child.textContent).join(""); }
    set textContent(value: string) {
      this.childNodes.length = 0;
      if (value) this.appendChild(this.ownerDocument.createTextNode(value));
    }
  }
  const documentLike: DocumentLike = {
    nodeType: 9,
    activeElement: null,
    defaultView: globalThis,
    documentElement: null!,
    createElement: (tagName) => {
      const element = new ElementNode(tagName);
      element.ownerDocument = documentLike;
      return element;
    },
    createElementNS: (_namespace, tagName) => documentLike.createElement(tagName),
    createTextNode: (value) => {
      const text = new TextNode(value);
      text.ownerDocument = documentLike;
      return text;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const container = documentLike.createElement("div");
  documentLike.documentElement = container;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("self", globalThis);
  vi.stubGlobal("top", globalThis);
  vi.stubGlobal("document", documentLike);
  vi.stubGlobal("HTMLElement", ElementNode);
  vi.stubGlobal("HTMLIFrameElement", class HTMLIFrameElement extends ElementNode {});
  vi.stubGlobal("Node", ElementNode);
  return container;
};

const findButton = (root: ReturnType<typeof installMinimalReactDom>, label: string) => {
  const visit = (node: typeof root): typeof root | undefined => {
    if (node.tagName === "BUTTON" && (node.textContent.includes(label) || node.getAttribute("aria-label") === label)) {
      return node;
    }
    return node.childNodes
      .filter((child): child is typeof root => child.nodeType === 1)
      .map(visit)
      .find(Boolean);
  };
  return visit(root);
};

const quizQuestion: QuizQuestion = {
  card: {
    id: "hello",
    word: "hello",
    translation: "xin chào",
    explanation: "A greeting.",
    phonetic: "/həˈləʊ/",
    emoji: "👋",
    category: "Greetings",
    audioUrl: null,
    imageUrl: null,
  },
  type: "target-to-native",
  options: ["xin chào", "tạm biệt", "cảm ơn", "xin lỗi"],
  correctAnswer: "xin chào",
};

describe("practice view accessibility contracts", () => {
  it("wires spelling submits through the shared IME guard", () => {
    const source = readFileSync(fileURLToPath(new URL('./SpellingView.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('createImeSubmitGuard');
    expect(source).toContain('shouldBlockSubmit(event.nativeEvent');
    expect(source).toContain('onCompositionEnd={imeSubmitGuard.onCompositionEnd}');
    expect(source).toContain('shouldBlockKeyDown(event.nativeEvent)');
  });

  it("uses the active UI locale for target and native language names", () => {
    expect(languageName("ko", "en")).toBe("Korean");
    expect(languageName("vi", "en")).toBe("Vietnamese");
    expect(languageName("ko", "vi")).toBe("Tiếng Hàn");
    expect(languageName("vi", "vi")).toBe("Tiếng Việt");
  });

  it("keeps study progress, card content, and rating controls in reading order", () => {
    const studyHtml = renderToStaticMarkup(
      <StudyView
        cards={[quizQuestion.card]}
        index={0}
        recallMode="target-to-native"
        revealed
        reviewedCardId={null}
        customDecks={[]}
        onClose={vi.fn()}
        onRecallMode={vi.fn()}
        onReveal={vi.fn()}
        onBookmark={vi.fn()}
        onAssignDeck={vi.fn()}
        onUpdateCard={vi.fn()}
        onRate={vi.fn()}
        onIndex={vi.fn()}
      />,
    );

    const progress = studyHtml.indexOf("data-study-progress");
    const card = studyHtml.indexOf("data-study-card");
    const rating = studyHtml.indexOf("data-study-rating");

    expect(progress).toBeGreaterThanOrEqual(0);
    expect(card).toBeGreaterThan(progress);
    expect(rating).toBeGreaterThan(card);
    expect(studyHtml).toContain('role="progressbar"');
    expect(studyHtml).toContain('aria-label="Study progress"');
    expect(studyHtml).toContain('aria-valuenow="0"');
    expect(studyHtml).toContain('0 / 1 saved');
  });

  it('renders no card, and so no edit sheet, once the session has no cards after an owner change', () => {
    // The session reports no study cards in the render that follows an owner change, so a sheet
    // opened for the earlier owner's card is unmounted instead of saving against the new owner.
    const studyHtml = renderToStaticMarkup(
      <StudyView
        cards={[]}
        index={0}
        recallMode="target-to-native"
        revealed
        needsIntroduction={false}
        reviewedCardId={null}
        customDecks={[]}
        onClose={vi.fn()}
        onRecallMode={vi.fn()}
        onReveal={vi.fn()}
        onBookmark={vi.fn()}
        onAssignDeck={vi.fn()}
        onUpdateCard={vi.fn()}
        onRate={vi.fn()}
        onIndex={vi.fn()}
      />,
    );

    expect(studyHtml).toBe('');
  });

  it('introduces an unreviewed card before recall and rating', () => {
    const studyHtml = renderToStaticMarkup(
      <StudyView
        cards={[quizQuestion.card]}
        index={0}
        recallMode="target-to-native"
        revealed={false}
        needsIntroduction
        reviewedCardId={null}
        customDecks={[]}
        onClose={vi.fn()}
        onRecallMode={vi.fn()}
        onReveal={vi.fn()}
        onBeginStudyRecall={vi.fn()}
        onBookmark={vi.fn()}
        onAssignDeck={vi.fn()}
        onUpdateCard={vi.fn()}
        onRate={vi.fn()}
        onIndex={vi.fn()}
      />,
    );

    expect(studyHtml).toContain('Meet this word');
    expect(studyHtml).toContain('I’ve reviewed it — start recall');
    expect(studyHtml).toContain('data-card-side="back"');
    expect(studyHtml).toContain('xin chào');
    expect(studyHtml).toContain('hello');
    expect(studyHtml).not.toContain('Reveal answer');
    expect(studyHtml).not.toContain('Rate memory strength');
  });

  it("runs the review in its own shell: close, the saved count, and the hint only while the answer is hidden", () => {
    const study = (props: { revealed: boolean; needsIntroduction?: boolean }) => renderToStaticMarkup(
      <StudyView
        cards={[quizQuestion.card]}
        index={0}
        recallMode="target-to-native"
        reviewedCardId={null}
        customDecks={[]}
        onClose={vi.fn()}
        onRecallMode={vi.fn()}
        onReveal={vi.fn()}
        onBeginStudyRecall={vi.fn()}
        onBookmark={vi.fn()}
        onAssignDeck={vi.fn()}
        onUpdateCard={vi.fn()}
        onRate={vi.fn()}
        onIndex={vi.fn()}
        {...props}
      />,
    );

    const prompt = study({ revealed: false });
    expect(prompt).toContain("data-study-session");
    expect(prompt).toMatch(/class="study-shell-close[^"]*"[^>]*aria-label="Close study mode"/);
    expect(prompt).toMatch(/data-study-count="true"[^>]*><span aria-hidden="true"><span class="study-shell-count__current">0<\/span> \/ 1<\/span>/);
    expect(prompt).toContain("data-study-hint");
    expect(prompt).toContain("Say it out loud first, then reveal");
    expect(prompt.indexOf("data-study-hint")).toBeLessThan(prompt.indexOf("data-study-rating"));
    expect(study({ revealed: true })).not.toContain("data-study-hint");
    expect(study({ revealed: false, needsIntroduction: true })).not.toContain("data-study-hint");
  });

  it("keeps focus visible and avoids transition-all across practice screens", () => {
    const sources = [
      "QuizView.tsx",
      "SpellingView.tsx",
      "StoryView.tsx",
      "StudyView.tsx",
    ]
      .map((file) =>
        readFileSync(
          fileURLToPath(new URL(`./${file}`, import.meta.url)),
          "utf8",
        ),
      )
      .join("\n");

    expect(sources).not.toContain("outline-none");
    expect(sources).not.toContain("transition-all");
    expect(sources).toContain("focus-visible:");
    expect(sources).toContain("motion-reduce:");
  });

  it("groups quiz answers with a legend and lets long choices wrap", () => {
    const longAnswer =
      "một-câu-trả-lời-rất-dài-không-có-khoảng-trắng-để-kiểm-tra-xuống-dòng";
    const html = renderToStaticMarkup(
      <QuizView
        questions={[
          {
            ...quizQuestion,
            options: [longAnswer, "tạm biệt"],
            correctAnswer: longAnswer,
          },
        ]}
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

    expect(html).toMatch(
      /<fieldset[^>]*>.*?<legend[^>]*>Choose one answer<\/legend>.*?<button/s,
    );
    expect(html).toMatch(
      new RegExp(
        `<span[^>]*class="[^"]*whitespace-normal[^"]*\\[overflow-wrap:anywhere\\][^"]*"[^>]*>${longAnswer}<\\/span>`,
      ),
    );
    expect(html).not.toContain("truncate");
  });

  it("renders quiz feedback as an atomic live-region announcement", () => {
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
    expect(html).toContain("Correct answer.");
    expect(html).toMatch(
      /<button[^>]*lang="vi"[^>]*>.*?xin chào.*?<\/button>/s,
    );
  });

  it("advances an answered quiz with Continue and keeps the card wing decorative, behind the card", () => {
    const html = renderToStaticMarkup(
      <QuizView questions={[quizQuestion, quizQuestion]} currentIndex={0} selectedAnswer="xin chào" answeredCorrectly score={1}
        showResults={false} onSelect={vi.fn()} onNext={vi.fn()} onRestart={vi.fn()} onClose={vi.fn()} />,
    );

    expect(html).toMatch(/<button[^>]*>[^<]*Continue/);
    expect(html).not.toMatch(/<button[^>]*>[^<]*Next</);
    expect(html).toMatch(/<span class="practice-quiz__wing crystal-wing-art" aria-hidden="true"><\/span><section data-quiz-question-panel/);
  });

  it("shows a disabled saving action while quiz and spelling results are being confirmed", () => {
    const actions = { onNext: vi.fn(), onRestart: vi.fn(), onClose: vi.fn() };
    const quizHtml = renderToStaticMarkup(
      <QuizView questions={[quizQuestion]} currentIndex={0} selectedAnswer="xin chào" answeredCorrectly score={1}
        showResults={false} savingResult onSelect={vi.fn()} {...actions} />,
    );
    const spellingHtml = renderToStaticMarkup(
      <SpellingView cards={[quizQuestion.card]} currentIndex={0} input="hello" checked correct score={1}
        showResults={false} savingResult onInput={vi.fn()} onCheck={vi.fn()} {...actions} />,
    );

    for (const html of [quizHtml, spellingHtml]) {
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>.*?Saving result/s);
      expect(html).not.toContain('View results');
    }
  });

  it("counts answered quiz and spelling cards for combo, including incorrect answers, and respects focus mode", () => {
    const quiz = () => renderToStaticMarkup(
      <QuizView questions={[quizQuestion, quizQuestion]} currentIndex={1} selectedAnswer="wrong" answeredCorrectly={false} score={0}
        showResults={false} onSelect={vi.fn()} onNext={vi.fn()} onRestart={vi.fn()} onClose={vi.fn()} />,
    );
    const spelling = () => renderToStaticMarkup(
      <SpellingView cards={[quizQuestion.card, quizQuestion.card]} currentIndex={1} input="wrong" checked correct={false} score={0}
        showResults={false} onInput={vi.fn()} onCheck={vi.fn()} onNext={vi.fn()} onRestart={vi.fn()} onClose={vi.fn()} />,
    );

    expect(quiz()).toContain('data-practice-combo="2"');
    expect(spelling()).toContain('data-practice-combo="2"');
    writeFocusModeEnabled(true);
    try {
      expect(quiz()).not.toContain('data-practice-combo');
      expect(spelling()).not.toContain('data-practice-combo');
    } finally {
      writeFocusModeEnabled(false);
    }
  });

  it("marks Vietnamese quiz prompts and feedback according to the question direction", () => {
    const vietnamesePromptHtml = renderToStaticMarkup(
      <QuizView
        questions={[
          {
            ...quizQuestion,
            type: "native-to-target",
            options: ["hello", "goodbye"],
            correctAnswer: "hello",
          },
        ]}
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
    const koreanPromptHtml = renderToStaticMarkup(
      <QuizView
        questions={[
          {
            ...quizQuestion,
            card: { ...quizQuestion.card, language: "ko", word: "안녕" },
          },
        ]}
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

    expect(vietnamesePromptHtml).toContain("Which English word matches ");
    expect(vietnamesePromptHtml).toMatch(
      /<span[^>]*lang="vi"[^>]*>“xin chào”<\/span>/,
    );
    expect(koreanPromptHtml).toMatch(/<span[^>]*lang="ko"[^>]*>“안녕”<\/span>/);
    expect(vietnameseAnswerHtml).toMatch(
      /<span lang="vi"[^>]*>“xin chào”<\/span>/,
    );
  });

  it("renders spelling feedback, focus destinations, progress semantics, and full-size actions", () => {
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
    expect(questionHtml).toMatch(/Incorrect\. The correct answer is <span lang="en">“hello”\.<\/span>/);
    expect(questionHtml).toContain('role="progressbar"');
    expect(questionHtml).toContain('aria-label="Spelling progress"');
    expect(questionHtml).toContain('aria-valuemin="0"');
    expect(questionHtml).toContain('aria-valuemax="1"');
    expect(questionHtml).toContain('aria-valuenow="1"');
    expect(questionHtml).toMatch(
      /<button[^>]*class="[^"]*min-h-11[^"]*"[^>]*>.*?Exit(<\/span>)?<\/button>/s,
    );
    expect(resultsHtml).toContain('aria-labelledby="spelling-results-heading"');
    expect(resultsHtml).toContain('id="spelling-results-heading"');
    expect(resultsHtml).toContain('tabindex="-1"');
  });

  it("mirrors the real spelling input in letter tiles and keeps the textbox as the answer field", () => {
    const actions = { onInput: vi.fn(), onCheck: vi.fn(), onReveal: vi.fn(), onSkip: vi.fn(), onNext: vi.fn(), onRestart: vi.fn(), onClose: vi.fn() };
    const typingHtml = renderToStaticMarkup(
      <SpellingView cards={[quizQuestion.card]} currentIndex={0} input="hel" checked={false} correct={false} score={0} showResults={false} {...actions} />,
    );
    const wrongHtml = renderToStaticMarkup(
      <SpellingView cards={[quizQuestion.card]} currentIndex={0} input="helo" checked correct={false} score={0} showResults={false} {...actions} />,
    );

    expect(typingHtml).toMatch(/<ol[^>]*aria-hidden="true"[^>]*lang="en"/);
    expect(typingHtml.match(/data-state="typed"/g)).toHaveLength(3);
    expect(typingHtml.match(/data-state="empty"/g)).toHaveLength(2);
    expect(typingHtml).toMatch(/<input(?=[^>]*name="spelling-answer")(?=[^>]*value="hel")(?=[^>]*aria-label="Type the English word")/);
    expect(typingHtml).toMatch(/<button[^>]*type="submit"[^>]*>Check/);
    expect(typingHtml).toContain(">Reveal</button>");
    expect(typingHtml).toContain(">Skip</button>");
    expect(typingHtml).toContain('aria-pressed="true"');
    expect(typingHtml).toContain("0.6× slow");

    expect(wrongHtml.match(/data-state="correct"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(wrongHtml).toMatch(/data-state="missing"[^>]*>l</);
    expect(wrongHtml).toContain("Missing letter");
    expect(wrongHtml).not.toContain(">Reveal</button>");
    expect(wrongHtml).toMatch(/<input[^>]*disabled=""/);
  });

  it("renders story generation as busy status and the result with a labelled heading", () => {
    const loadingHtml = renderToStaticMarkup(
      <StoryView story={null} loading onGenerate={vi.fn()} onClose={vi.fn()} />,
    );
    const storyHtml = renderToStaticMarkup(
      <StoryView
        story={{ title: 'A greeting', segments: [{ english: 'Hello there.', vietnamese: 'Xin chào.' }, { english: 'A chance appeared.', vietnamese: 'Một cơ hội đã đến.' }], targetPhrases: ['Hello'], comprehension: { question: 'What appeared?', options: ['A chance', 'A car', 'A bird'], correctIndex: 0, explanationVi: 'Một cơ hội.' }, grammar: { label: 'Past simple', explanationVi: 'Thì quá khứ đơn.', sourceSentence: 'A chance appears.', prompt: 'Use the past simple.', acceptedAnswer: 'A chance appeared.' }, retellPrompt: 'Retell the greeting.' }}
        loading={false}
        onGenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(loadingHtml).toContain('aria-busy="true"');
    expect(loadingHtml).toContain("Creating your story");
    expect(storyHtml).toContain('aria-labelledby="story-heading"');
    expect(storyHtml).toContain("Story ready");
    expect(storyHtml).toMatch(/<p[^>]*lang="vi"[^>]*>Xin chào\.<\/p>/);
    expect(storyHtml).toContain('Read scene 1 in English');
    expect(storyHtml).toContain('Check understanding');
    expect(storyHtml).toContain('Grammar transformation:');
    expect(storyHtml).toContain('This draft stays on this screen and is not submitted.');
  });

  it("opens a card word's meaning from the story text and the word list, one at a time", async () => {
    const storyCards: CardData[] = [
      { id: "context", word: "context", translation: "bối cảnh", explanation: "", phonetic: "/ˈkɒntekst/", partOfSpeech: "noun", emoji: "", category: "General", audioUrl: null, imageUrl: null },
      { id: "adapt", word: "adapt", translation: "thích nghi", explanation: "", phonetic: "", emoji: "", category: "General", audioUrl: null, imageUrl: null },
    ];
    const onReviewCards = vi.fn();
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    type Node = typeof container;
    const all = (node: Node, match: (element: Node) => boolean): Node[] => [
      ...(match(node) ? [node] : []),
      ...node.childNodes.filter((child): child is Node => child.nodeType === 1).flatMap(child => all(child, match)),
    ];
    const dialogs = () => all(container, element => element.getAttribute("role") === "dialog");
    const words = () => all(container, element => element.getAttribute("data-story-word") !== null);

    try {
      await act(async () => {
        root.render(
          <StoryView
            story={{ story: "Learners adapt to context. Context helps.", translation: "Người học thích nghi với bối cảnh.", language: "en", translationLanguage: "vi", cards: storyCards }}
            loading={false}
            onGenerate={vi.fn()}
            onClose={vi.fn()}
            onReviewCards={onReviewCards}
          />,
        );
      });
      // The story text comes first, then one row per card in the word list.
      const [inTextAdapt, ...rest] = words();
      const inText = [inTextAdapt!, ...rest.slice(0, 2)];
      const rows = rest.slice(2);
      expect(inText.map(word => word.textContent)).toEqual(["adapt", "context", "Context"]);
      expect(rows.map(row => row.textContent)).toEqual(["contextbối cảnh", "adaptthích nghi"]);
      expect(inText.every(word => word.getAttribute("aria-expanded") === "false")).toBe(true);
      expect(dialogs()).toHaveLength(0);

      await act(async () => { inText[1]!.click(); });
      expect(inText[1]!.getAttribute("aria-expanded")).toBe("true");
      expect(dialogs()).toHaveLength(1);
      expect(dialogs()[0]!.getAttribute("aria-label")).toBe("context");
      expect(dialogs()[0]!.textContent).toContain("bối cảnh");
      expect(inText[1]!.getAttribute("aria-controls")).toBe(dialogs()[0]!.getAttribute("id"));

      await act(async () => { inText[2]!.click(); });
      expect(inText[1]!.getAttribute("aria-expanded")).toBe("false");
      expect(inText[2]!.getAttribute("aria-expanded")).toBe("true");
      expect(dialogs()).toHaveLength(1);

      await act(async () => { findButton(dialogs()[0]!, "Review now")!.click(); });
      expect(onReviewCards).toHaveBeenCalledWith([storyCards[0]]);

      await act(async () => { inText[2]!.click(); });
      expect(inText[2]!.getAttribute("aria-expanded")).toBe("false");
      expect(dialogs()).toHaveLength(0);

      await act(async () => { rows[1]!.click(); });
      expect(rows[1]!.getAttribute("aria-expanded")).toBe("true");
      expect(dialogs().map(dialog => dialog.getAttribute("aria-label"))).toEqual(["adapt"]);
      expect(dialogs()[0]!.textContent).toContain("thích nghi");
    } finally {
      await act(async () => { root.unmount(); });
      vi.unstubAllGlobals();
    }
  });

  it('checks comprehension and grammar answers locally with simple normalization', () => {
    expect(isComprehensionAnswerCorrect(0, 0)).toBe(true);
    expect(isComprehensionAnswerCorrect(1, 0)).toBe(false);
    expect(normalizeGrammarAnswer('  A   CHANCE appeared. ')).toBe('a chance appeared.');
    expect(isGrammarAnswerCorrect('  A   CHANCE appeared. ', 'A chance appeared.')).toBe(true);
    expect(isGrammarAnswerCorrect('A chance appears.', 'A chance appeared.')).toBe(false);
  });

  it("renders story failures as retryable errors rather than completed reading content", () => {
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
    expect(html).toContain(
      "Could not generate a story right now. Please try again.",
    );
    expect(html).toContain("Try again");
    expect(html).not.toContain("Reading in context");
    expect(html).not.toContain("Your story is ready.");
  });

  it("retries a failed story through the production practice hook", async () => {
    const cards: CardData[] = [1, 2, 3, 4].map(index => ({
      id: `card-${index}`,
      word: `word-${index}`,
      translation: `translation-${index}`,
      explanation: "",
      phonetic: "",
      emoji: "",
      category: "General",
      audioUrl: null,
      imageUrl: null,
      difficulty: "good",
    }));
    const lifecycle = createPracticeSessionLifecycle("owner-a");
    const onClose = vi.fn();
    const openView = vi.fn();
    const state: { current: ReturnType<typeof usePracticeGames> | null } = { current: null };
    const container = installMinimalReactDom();
    const root = createRoot(container as unknown as Element);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    function Harness() {
      const games = usePracticeGames({
        lifecycle,
        loadPracticePool: vi.fn(async () => cards),
        languageDrillCards: cards,
        languageDrillScopeKey: "owner-a:en:vi",
        storyLanguagePair: { targetLanguage: "en", translationLanguage: "vi" },
        openView,
        closeView: vi.fn(),
        reportError: vi.fn(),
      });
      state.current = games;
      return <StoryView story={games.story} loading={games.isGeneratingStory} error={games.storyError} onGenerate={games.generateStory} onClose={onClose} />;
    }

    try {
      await act(async () => { root.render(<Harness />); });
      gemini.generateStoryContext
        .mockRejectedValueOnce(new Error("Story service is temporarily unavailable."))
        .mockResolvedValueOnce({ story: "Recovered story.", translation: "Câu chuyện đã phục hồi." });

      await act(async () => { await state.current!.generateStory(); });
      expect(state.current).toMatchObject({
        story: null,
        isGeneratingStory: false,
        storyError: "Could not generate a story right now. Please try again.",
      });
      expect(findButton(container, "Try again")).toBeDefined();

      await act(async () => { findButton(container, "Try again")!.click(); });
      expect(gemini.generateStoryContext).toHaveBeenCalledTimes(2);
      expect(state.current).toMatchObject({
        story: { story: "Recovered story.", translation: "Câu chuyện đã phục hồi.", language: "en", translationLanguage: "vi" },
        isGeneratingStory: false,
        storyError: null,
      });
      expect(openView).toHaveBeenCalledWith("story");

      await act(async () => { findButton(container, "Close story")!.click(); });
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      await act(async () => { root.unmount(); });
      consoleError.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("announces review persistence while saving and leaves failed reviews retryable", () => {
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

    expect(savingHtml).toContain("Saving review");
    expect(savingHtml).toMatch(/<button[^>]*disabled=/);
    expect(savingHtml).not.toContain("Review saved");
    expect(failedHtml).toContain('role="alert"');
    expect(failedHtml).toContain("Choose a rating to try again");
    expect(failedHtml).not.toMatch(/<button[^>]*disabled=/);
  });

  it("advertises only modifier-based study character shortcuts", () => {
    const controlsHtml = renderToStaticMarkup(
      <ReviewControls revealed reviewed={false} onRate={vi.fn()} />,
    );
    const studyHtml = renderToStaticMarkup(
      <StudyView
        cards={[quizQuestion.card]}
        index={0}
        recallMode="target-to-native"
        revealed={false}
        reviewedCardId={null}
        customDecks={[]}
        onClose={vi.fn()}
        onRecallMode={vi.fn()}
        onReveal={vi.fn()}
        onBookmark={vi.fn()}
        onAssignDeck={vi.fn()}
        onUpdateCard={vi.fn()}
        onRate={vi.fn()}
        onIndex={vi.fn()}
      />,
    );

    expect(controlsHtml).toContain('aria-keyshortcuts="Alt+1"');
    expect(controlsHtml).toContain('aria-keyshortcuts="Alt+4"');
    expect(studyHtml).toContain("Alt+1…4");
    expect(studyHtml).toContain("Alt+S / Alt+P / Alt+R");
  });

  it("disables image recall and preserves the English-answer direction when image media is unavailable", () => {
    const cardWithoutUsableImage = {
      ...quizQuestion.card,
      imageUrl: "https://example.com/untrusted-image.jpg",
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
        onRate={vi.fn()}
        onIndex={vi.fn()}
      />,
    );

    expect(
      resolveStudyRecallMode(cardWithoutUsableImage, "image-to-word"),
    ).toBe("native-to-target");
    expect(studyHtml).toMatch(
      /<option value="image-to-word" disabled="">Image → Word<\/option>/,
    );
    expect(studyHtml).toMatch(/<option value="native-to-target" selected="">/);
    expect(studyHtml).not.toContain("No illustration available");
  });

  it("keeps image recall available for a supported image URL", () => {
    const cardWithSupportedImage = {
      ...quizQuestion.card,
      imageUrl: "https://images.pexels.com/photos/123/example.jpg",
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
        onRate={vi.fn()}
        onIndex={vi.fn()}
      />,
    );

    expect(studyHtml).toMatch(
      /<option value="image-to-word" selected="">Image → Word<\/option>/,
    );
    expect(studyHtml).not.toMatch(/<option value="image-to-word" disabled=/);
    expect(studyHtml).toContain("Name what you see");
  });

  it("falls back to the English-answer direction after a supported image fails at runtime", () => {
    const cardWithSupportedImage = {
      ...quizQuestion.card,
      imageUrl: "https://images.pexels.com/photos/123/missing.jpg",
    };

    expect(
      resolveStudyRecallMode(cardWithSupportedImage, "image-to-word", true),
    ).toBe("native-to-target");
  });

  it("exposes a missing recall illustration as a named image placeholder", () => {
    const html = renderToStaticMarkup(
      <ActiveRecallPrompt
        card={quizQuestion.card}
        mode="image-to-word"
        onReveal={vi.fn()}
      />,
    );

    expect(html).toMatch(
      /<div[^>]*role="img"[^>]*aria-label="No illustration available"/,
    );
  });
});
