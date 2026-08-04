export type ShellViewMode = 'today' | 'library' | 'catalog' | 'progress' | 'study' | 'quiz' | 'story' | 'spelling';

export type SyncIdentityViewModel =
  | { status: 'loading' }
  | {
      status: 'authenticated';
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }
  | {
      status: 'signed-out';
      isConfigured: boolean;
      isSigningIn: boolean;
    };

export const isPracticeView = (viewMode: ShellViewMode) =>
  viewMode === 'quiz' || viewMode === 'spelling' || viewMode === 'story';
