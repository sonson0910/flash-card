/**
 * Failure texts raised by the audio and speech layers. The layers keep these English strings as the
 * stable error value; the screen that shows one passes it through `localizeSpeechMessage` (src/components/flashcard).
 */
export const SPEECH_RECOGNITION_UNSUPPORTED = 'This browser does not support speech recognition. Try Google Chrome.';
export const SPEECH_RECOGNITION_DENIED = 'Microphone access is blocked. Allow microphone access for this site, then try again.';
export const SPEECH_RECOGNITION_FAILED = 'Speech could not be recognised. Check microphone permission and try again.';
export const SPEECH_RECOGNITION_START_FAILED = 'The microphone could not start. Check permission and try again.';
export const AUDIO_PLAYBACK_FAILED = 'Audio could not be played. Check this site’s audio permission and try again.';
export const AUDIO_PLAYBACK_UNSUPPORTED = 'Audio playback is not supported by this browser.';
