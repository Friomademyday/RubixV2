import { WASocket, WAMessage, downloadMediaMessage } from '@whiskeysockets/baileys';

export async function updateGroupSubject(sock: WASocket, jid: string, newName: string): Promise<boolean> {
  try {
    await sock.groupUpdateSubject(jid, newName);
    return true;
  } catch (err) {
    console.error('Failed to update group subject:', err);
    return false;
  }
}

export async function updateGroupDescription(sock: WASocket, jid: string, newDesc: string): Promise<boolean> {
  try {
    await sock.groupUpdateDescription(jid, newDesc);
    return true;
  } catch (err) {
    console.error('Failed to update group description:', err);
    return false;
  }
}

export async function updateGroupPfp(sock: WASocket, jid: string, msg: WAMessage): Promise<boolean> {
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {});
    await sock.updateProfilePicture(jid, buffer);
    return true;
  } catch (err) {
    console.error('Failed to update group PFP:', err);
    return false;
  }
}

export async function deleteMessage(sock: WASocket, jid: string, msg: WAMessage): Promise<boolean> {
  try {
    if (msg.key) {
      await sock.sendMessage(jid, { delete: msg.key });
      return true;
    }
    return false;
  } catch (err) {
    console.error('Failed to delete message:', err);
    return false;
  }
}

export async function setGroupMute(sock: WASocket, jid: string, mute: boolean): Promise<boolean> {
  try {
    // 'announcement' allows only admins to send messages (mutes the group for regular users)
    // 'not_announcement' opens the chat for everyone
    const setting = mute ? 'announcement' : 'not_announcement';
    await sock.groupSettingUpdate(jid, setting);
    return true;
  } catch (err) {
    console.error(`Failed to ${mute ? 'mute' : 'unmute'} group:`, err);
    return false;
  }
}

export async function revokeGroupLink(sock: WASocket, jid: string): Promise<string | null> {
  try {
    const newCode = await sock.groupRevokeInvite(jid);
    return `https://chat.whatsapp.com/${newCode}`;
  } catch (err) {
    console.error('Failed to revoke group link:', err);
    return null;
  }
}

export async function getGroupInviteLink(sock: WASocket, jid: string): Promise<string | null> {
  try {
    const code = await sock.groupInviteCode(jid);
    return `https://chat.whatsapp.com/${code}`;
  } catch (err) {
    console.error('Failed to fetch group invite code:', err);
    return null;
  }
}

export async function executeTagAll(sock: WASocket, jid: string, customMessage?: string): Promise<void> {
  try {
    const metadata = await sock.groupMetadata(jid);
    const participants = metadata.participants.map((p) => p.id);

    let text = customMessage ? `📢 *ANNOUNCEMENT*\n${customMessage}\n\n` : `📢 *EVERYONE*\n\n`;
    for (const p of participants) {
      text += `@${p.split('@')[0]}\n`;
    }

    await sock.sendMessage(jid, { text, mentions: participants });
  } catch (err) {
    console.error('Failed to execute tagall:', err);
  }
}

export async function executeHideTag(sock: WASocket, jid: string, announcementText: string): Promise<void> {
  try {
    const metadata = await sock.groupMetadata(jid);
    const participants = metadata.participants.map((p) => p.id);

    await sock.sendMessage(jid, { text: announcementText, mentions: participants });
  } catch (err) {
    console.error('Failed to execute hidetag:', err);
  }
}

export async function promoteUsers(sock: WASocket, jid: string, targets: string[]): Promise<boolean> {
  try {
    await sock.groupParticipantsUpdate(jid, targets, 'promote');
    return true;
  } catch (err) {
    console.error('Failed to promote user(s):', err);
    return false;
  }
}

export async function demoteUsers(sock: WASocket, jid: string, targets: string[]): Promise<boolean> {
  try {
    await sock.groupParticipantsUpdate(jid, targets, 'demote');
    return true;
  } catch (err) {
    console.error('Failed to demote user(s):', err);
    return false;
  }
}

export async function handleJoinRequests(sock: WASocket, jid: string, action: 'approve' | 'reject'): Promise<string> {
  try {
    const pendingList = await sock.groupRequestParticipantsList(jid);
    
    if (!pendingList || pendingList.length === 0) {
      return 'No pending join requests found (or queue is not synced).';
    }

    const userJids = pendingList.map((p) => p.jid);
    await sock.groupRequestParticipantsUpdate(jid, userJids, action);
    return `Successfully ${action === 'approve' ? 'approved' : 'rejected'} ${userJids.length} pending request(s).`;
  } catch (err) {
    console.error(`Failed to ${action} join requests:`, err);
    return `Failed to ${action} join requests. Ensure I am an admin with membership approval rights.`;
  }
  }

// --- NEW ADMIN CAPABILITIES ---

export async function createGroupPoll(
  sock: WASocket,
  jid: string,
  title: string,
  options: string[],
  selectableCount: number = 1
): Promise<boolean> {
  try {
    await sock.sendMessage(jid, {
      poll: {
        name: title,
        values: options,
        selectableCount
      }
    });
    return true;
  } catch (err) {
    console.error('Failed to create poll:', err);
    return false;
  }
}

export async function setDisappearingMessages(
  sock: WASocket,
  jid: string,
  ephemeralExpiration: number // Seconds: 0 (Off), 86400 (24h), 604800 (7d), 7776000 (90d)
): Promise<boolean> {
  try {
    await sock.sendMessage(jid, {
      disappearingMessagesInChat: ephemeralExpiration
    });
    return true;
  } catch (err) {
    console.error('Failed to set disappearing messages:', err);
    return false;
  }
}

export async function setGroupEditSetting(
  sock: WASocket,
  jid: string,
  restrictToAdmins: boolean
): Promise<boolean> {
  try {
    // 'locked' = only admins can edit group info; 'unlocked' = all members can edit
    const setting = restrictToAdmins ? 'locked' : 'unlocked';
    await sock.groupSettingUpdate(jid, setting);
    return true;
  } catch (err) {
    console.error('Failed to update group edit settings:', err);
    return false;
  }
}

export async function removeGroupUsers(
  sock: WASocket,
  jid: string,
  targets: string[]
): Promise<boolean> {
  try {
    await sock.groupParticipantsUpdate(jid, targets, 'remove');
    return true;
  } catch (err) {
    console.error('Failed to remove users:', err);
    return false;
  }
}

export async function getMembersByCountryCode(
  sock: WASocket,
  jid: string,
  countryPrefix: string
): Promise<string[]> {
  try {
    const metadata = await sock.groupMetadata(jid);
    const cleanPrefix = countryPrefix.replace('+', '').trim();
    
    // Filter participants whose phone numbers start with the clean country code
    const matched = metadata.participants.filter((p) => {
      const numberPart = p.id.split('@')[0];
      return numberPart.startsWith(cleanPrefix);
    });

    return matched.map((p) => p.id);
  } catch (err) {
    console.error('Failed to fetch members by country code:', err);
    return [];
  }
}
