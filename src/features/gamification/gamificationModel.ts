export interface GamificationSnapshot {
  streak: number;
  xp: number;
  lastActive: string | null;
}

export function calculateLocalGamification(snapshot: GamificationSnapshot, now = new Date()): GamificationSnapshot {
  const today = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastActive = snapshot.lastActive ? new Date(snapshot.lastActive) : null;
  const streak = lastActive?.toDateString() === today
    ? Math.max(1, snapshot.streak)
    : lastActive?.toDateString() === yesterday.toDateString()
      ? Math.max(1, snapshot.streak + 1)
      : 1;
  return { streak, xp: Math.max(0, snapshot.xp), lastActive: today };
}

export function addXpToHistory(history: Record<string, number>, day: string, amount: number): Record<string, number> {
  return { ...history, [day]: Math.max(0, (history[day] || 0) + amount) };
}
