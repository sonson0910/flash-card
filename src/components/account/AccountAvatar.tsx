import { Loader2, UserRound } from 'lucide-react';
import type { SyncIdentityViewModel } from '../shell/shellTypes';

/**
 * Initials of the signed-in account: the first letters of up to two name parts, or the first
 * letter of the email when the account has no name. Null while signed out or loading.
 */
export function getIdentityInitials(identity: SyncIdentityViewModel): string | null {
  if (identity.status !== 'authenticated') return null;
  const name = identity.displayName?.trim();
  if (name) return name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
  return identity.email?.trim().slice(0, 1).toUpperCase() || null;
}

interface AccountAvatarProps {
  readonly identity: SyncIdentityViewModel;
  /** The smaller icon size of the header trigger. */
  readonly compact?: boolean;
  /** Class of the profile photo; the frame around the avatar belongs to the caller. */
  readonly imageClassName?: string;
}

/**
 * The account's face, drawn the same wherever it appears: the Google photo, else the initials,
 * else a person icon. Decorative: the caller names the account next to it.
 */
export function AccountAvatar({ identity, compact = false, imageClassName }: AccountAvatarProps) {
  if (identity.status === 'authenticated' && identity.photoUrl) {
    return <img src={identity.photoUrl} alt="" referrerPolicy="no-referrer" className={imageClassName} />;
  }
  if (identity.status === 'loading' || (identity.status === 'signed-out' && identity.isSigningIn)) {
    return <Loader2 size={compact ? 18 : 19} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />;
  }
  const initials = getIdentityInitials(identity);
  if (initials) return <span aria-hidden="true">{initials}</span>;
  return <UserRound size={compact ? 18 : 19} aria-hidden="true" />;
}
