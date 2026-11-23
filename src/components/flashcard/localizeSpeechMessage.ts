import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import {
  AUDIO_PLAYBACK_FAILED,
  AUDIO_PLAYBACK_UNSUPPORTED,
  SPEECH_RECOGNITION_DENIED,
  SPEECH_RECOGNITION_FAILED,
  SPEECH_RECOGNITION_START_FAILED,
  SPEECH_RECOGNITION_UNSUPPORTED,
} from '../../lib/speechMessages';

const descriptors: Readonly<Record<string, MessageDescriptor>> = {
  [SPEECH_RECOGNITION_UNSUPPORTED]: msg({ context: 'flashcard.speech.unsupported', message: 'This browser does not support speech recognition. Try Google Chrome.' }),
  [SPEECH_RECOGNITION_DENIED]: msg({ context: 'flashcard.speech.denied', message: 'Microphone access is blocked. Allow microphone access for this site, then try again.' }),
  [SPEECH_RECOGNITION_FAILED]: msg({ context: 'flashcard.speech.failed', message: 'Speech could not be recognised. Check microphone permission and try again.' }),
  [SPEECH_RECOGNITION_START_FAILED]: msg({ context: 'flashcard.speech.start-failed', message: 'The microphone could not start. Check permission and try again.' }),
  [AUDIO_PLAYBACK_FAILED]: msg({ context: 'flashcard.audio.play-failed', message: 'Audio could not be played. Check this site’s audio permission and try again.' }),
  [AUDIO_PLAYBACK_UNSUPPORTED]: msg({ context: 'flashcard.audio.unsupported', message: 'Audio playback is not supported by this browser.' }),
};

/** The text in the learner's language; an error this module does not know is shown as it came. */
export const localizeSpeechMessage = (error: string, translate: (descriptor: MessageDescriptor) => string): string => {
  const descriptor = descriptors[error];
  return descriptor ? translate(descriptor) : error;
};
