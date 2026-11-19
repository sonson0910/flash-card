// The XP amounts the server grants for verified actions. The web client imports this file
// directly, so any XP figure shown to a learner comes from the same numbers the server uses.
// Keep it free of imports so both runtimes can load it.

/** First review of a card on a study day (later reviews of that card the same day earn nothing). */
export const REVIEW_CARD_XP = 2;
/** Creating a card. */
export const CREATE_CARD_XP = 10;
/** Each correct answer in a quiz or spelling session. */
export const PRACTICE_CORRECT_ANSWER_XP = 5;
/** Completing (winning) a Word Match session. */
export const MATCH_WIN_XP = 20;
