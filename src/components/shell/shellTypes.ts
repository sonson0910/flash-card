export type ShellViewMode = 'landing' | 'today' | 'library' | 'catalog' | 'progress' | 'settings' | 'web-words' | 'study' | 'quiz' | 'story' | 'spelling' | 'match' | 'shadowing';

/**
 * The shell tab a view highlights. Sub-views light up their parent tab:
 * web words lives under Vocabulary. A new view that belongs under an existing
 * tab maps to it here; a view with no tab maps to itself and lights none.
 */
export const shellNavigationView = (viewMode: ShellViewMode): ShellViewMode => (
  viewMode === 'web-words' ? 'library' : viewMode
);

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
  viewMode === 'quiz' || viewMode === 'spelling' || viewMode === 'story' || viewMode === 'match' || viewMode === 'shadowing';
