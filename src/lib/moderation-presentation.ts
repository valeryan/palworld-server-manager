export type ModerationAction = "kick" | "ban" | "unban";

const verbs: Record<ModerationAction, string> = { kick: "Kicked", ban: "Banned", unban: "Unbanned" };

export function moderationEventMessage(action: ModerationAction, userId: string, playerName?: string | null): string {
  const name = playerName?.trim();
  const target = name && name !== userId ? `${name} (${userId})` : userId;
  return `${verbs[action]} ${target}`;
}

export function legacyModerationEvent(message: string): { action: ModerationAction; userId: string } | null {
  const match = /^(Kick|Ban|Unban) completed for (.+)$/.exec(message);
  if (!match) return null;
  const rawAction = match[1]; const userId = match[2];
  if (!rawAction || !userId) return null;
  return { action: rawAction.toLocaleLowerCase() as ModerationAction, userId };
}
