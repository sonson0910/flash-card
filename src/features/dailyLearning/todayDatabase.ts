import type { Firestore } from 'firebase/firestore';
import { db } from '../../lib/firebase';

/** Firestore for the reads Today and its recap make themselves; `null` when Firebase is not configured. */
export type TodayDatabase = Firestore | null;

/** The app's configured client, read when Today mounts. */
export const configuredTodayDatabase = (): TodayDatabase => db;
