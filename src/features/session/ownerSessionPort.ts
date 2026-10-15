import { onAuthStateChanged } from 'firebase/auth';
import { auth, protectedFunctionsCapability } from '../../lib/firebase';

export const currentOwnerId = (): string | null => auth?.currentUser?.uid ?? null;

export const protectedFunctionsAvailable = (): boolean => protectedFunctionsCapability.available;

export const observeOwner = (onOwner: (ownerId: string | null) => void): (() => void) | null => auth
  ? onAuthStateChanged(auth, user => onOwner(user?.uid ?? null))
  : null;
