interface GroupSettings {
  antiLink: number; // 0 = OFF, 1 = ON
}

const groupStates: Record<string, GroupSettings> = {};

export function getGroupState(jid: string): GroupSettings {
  if (!groupStates[jid]) {
    groupStates[jid] = { antiLink: 0 };
  }
  return groupStates[jid];
}

export function setAntiLinkState(jid: string, state: number): void {
  const current = getGroupState(jid);
  current.antiLink = state;
}
