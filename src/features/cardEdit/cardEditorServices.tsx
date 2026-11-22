import { createContext, useContext } from 'react';

/** Uploads a photo the learner picked and resolves with the URL to store on the card. */
export interface CardImageUploader {
  upload(file: File, onProgress: (fraction: number | null) => void): { readonly done: Promise<string>; cancel(): void };
}

/**
 * What the card editor needs from the signed-in app wherever it opens (a review card, the
 * vocabulary grid): the photo uploader and the learner's deck list. The app runtime provides
 * it once; a host can still pass the same props to `EditCardDialog` to override it.
 */
export interface CardEditorServices {
  readonly imageUpload?: CardImageUploader;
  readonly customDecks?: readonly string[];
}

const CardEditorServicesContext = createContext<CardEditorServices>({});

export const CardEditorServicesProvider = CardEditorServicesContext.Provider;

export const useCardEditorServices = (): CardEditorServices => useContext(CardEditorServicesContext);
