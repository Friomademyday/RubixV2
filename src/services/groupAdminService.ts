import {
  WASocket,
  WAMessage,
  GroupMetadata,
  downloadMediaMessage,
  WA_DEFAULT_EPHEMERAL
} from '@whiskeysockets/baileys';

/**
 * Universal Group Data Response Interface
 */
export interface UniversalGroupData {
  id: string;
  subject: string;
  subjectOwner?: string;
  subjectTime?: number;
  creationTime: number;
  owner?: string;
  desc?: string;
  descId?: string;
  descOwner?: string;
  descTime?: number;
  restrict: boolean; // True if only admins can edit settings
  announce: boolean; // True if muted (only admins can send messages)
  memberAddMode: boolean; // True if all members can add people, false if admin only
  size: number;
  participants: {
    id: string;
    admin: 'admin' | 'superadmin' | null;
    countryPrefix: string;
  }[];
  ephemeralDuration?: number; // Disappearing messages duration in seconds
  inviteCode?: string;
  pendingRequestsCount?: number;
  pendingParticipants?: {
    jid: string;
    requestTime?: number;
    countryPrefix: string;
  }[];
}

// ==========================================
// 1. ADMIN PERMISSION & VERIFICATION CHECKS
// ==========================================

/**
 * Checks if a specific participant JID is an admin or superadmin in the group.
 */
export async function isParticipantAdmin(
  sock: WASocket,
  groupJid: string,
  participantJid: string
): Promise<boolean> {
  try {
    const metadata: GroupMetadata = await sock.groupMetadata(groupJid);
    const participant = metadata.participants.find((p) => p.id === participantJid);
    return participant?.admin === 'admin' || participant?.admin === 'superadmin';
  } catch (error) {
    console.error(`Error checking if ${participantJid} is admin:`, error);
    return false;
  }
}

/**
 * Checks if the bot itself is an admin in the specified group.
 */
export async function isBotAdmin(sock: WASocket, groupJid: string): Promise<boolean> {
  const botJid = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : '';
  if (!botJid) return false;
  return isParticipantAdmin(sock, groupJid, botJid);
}

// ==========================================
// 2. UNIVERSAL GROUP DATA FETCHING
// ==========================================

/**
 * Retrieves full universal metadata, member stats, pending requests, and invite codes.
 */

export async function getUniversalGroupData(
  sock: WASocket,
  groupJid: string
): Promise<UniversalGroupData> {
  const metadata: GroupMetadata = await sock.groupMetadata(groupJid);

  const processedParticipants = metadata.participants.map((p) => {
    const cleanNumber = p.id.split('@')[0];
    return {
      id: p.id,
      admin: p.admin || null,
      countryPrefix: extractCountryPrefix(cleanNumber)
    };
  });

  let pendingList: any[] = [];
  try {
    const pendingRequests = await sock.groupRequestParticipantsList(groupJid);
    pendingList = (pendingRequests || []).map((req: any) => {
      const cleanNumber = req.jid.split('@')[0];
      return {
        jid: req.jid,
        requestTime: req.request_time ? parseInt(req.request_time) : undefined,
        countryPrefix: extractCountryPrefix(cleanNumber)
      };
    });
  } catch (err) {
    pendingList = [];
  }

  let code: string | undefined = undefined;
  try {
    code = await sock.groupInviteCode(groupJid);
  } catch (err) {
    code = undefined;
  }

  return {
    id: metadata.id,
    subject: metadata.subject,
    subjectOwner: metadata.subjectOwner,
    subjectTime: metadata.subjectTime,
    creationTime: metadata.creation,
    owner: metadata.owner || metadata.subjectOwner,
    desc: metadata.desc,
    descId: metadata.descId,
    descOwner: metadata.descOwner,
    descTime: metadata.descTime,
    restrict: !!metadata.restrict,
    announce: !!metadata.announce,
    memberAddMode: (metadata as any).memberAddMode === 'all_member_add' || (metadata as any).memberAddMode === true,
    size: metadata.size || metadata.participants.length,
    participants: processedParticipants,
    ephemeralDuration: metadata.ephemeralDuration ?? 0,
    inviteCode: code ? `https://chat.whatsapp.com/${code}` : undefined,
    pendingRequestsCount: pendingList.length,
    pendingParticipants: pendingList
  };
}

// Helper utility to parse country phone prefix
function extractCountryPrefix(phoneNumber: string): string {
  // Known 1, 2, and 3 digit country code matching
  if (phoneNumber.startsWith('1')) return '1'; // USA/Canada
  if (phoneNumber.startsWith('234')) return '234'; // Nigeria
  if (phoneNumber.startsWith('92')) return '92'; // Pakistan
  if (phoneNumber.startsWith('44')) return '44'; // UK
  if (phoneNumber.startsWith('91')) return '91'; // India
  if (phoneNumber.startsWith('254')) return '254'; // Kenya
  if (phoneNumber.startsWith('27')) return '27'; // South Africa
  return phoneNumber.substring(0, 3); // Fallback to first 3 digits
}

// ==========================================
// 3. MEMBER & PARTICIPANT ACTIONS
// ==========================================

/**
 * Removes (kicks) a array of target participant JIDs from the group.
 */
export async function kickParticipants(
  sock: WASocket,
  groupJid: string,
  targetJids: string[]
): Promise<boolean> {
  try {
    await sock.groupParticipantsUpdate(groupJid, targetJids, 'remove');
    return true;
  } catch (error) {
    console.error(`Failed to kick participants from ${groupJid}:`, error);
    return false;
  }
}

/**
 * Promotes participants to Group Admin status.
 */
export async function promoteParticipants(
  sock: WASocket,
  groupJid: string,
  targetJids: string[]
): Promise<boolean> {
  try {
    await sock.groupParticipantsUpdate(groupJid, targetJids, 'promote');
    return true;
  } catch (error) {
    console.error(`Failed to promote participants in ${groupJid}:`, error);
    return false;
  }
}

/**
 * Demotes group admins back to standard participants.
 */
export async function demoteParticipants(
  sock: WASocket,
  groupJid: string,
  targetJids: string[]
): Promise<boolean> {
  try {
    await sock.groupParticipantsUpdate(groupJid, targetJids, 'demote');
    return true;
  } catch (error) {
    console.error(`Failed to demote participants in ${groupJid}:`, error);
    return false;
  }
}

// ==========================================
// 4. PENDING JOIN REQUESTS (APPROVE/DECLINE)
// ==========================================

/**
 * Approves or rejects pending group join requests universally or filtered by amount.
 */
export async function handlePendingRequests(
  sock: WASocket,
  groupJid: string,
  action: 'approve' | 'reject',
  amount?: number
): Promise<{ success: boolean; processedCount: number }> {
  try {
    const pending = await sock.groupRequestParticipantsList(groupJid);
    if (!pending || pending.length === 0) {
      return { success: true, processedCount: 0 };
    }

    const targets = amount ? pending.slice(0, amount) : pending;
    const targetJids = targets.map((p: any) => p.jid);

    await sock.groupRequestParticipantsUpdate(groupJid, targetJids, action);
    return { success: true, processedCount: targetJids.length };
  } catch (error) {
    console.error(`Failed to ${action} pending requests in ${groupJid}:`, error);
    return { success: false, processedCount: 0 };
  }
}

// ==========================================
// 5. GROUP MUTE, PERMISSIONS & SETTINGS
// ==========================================

/**
 * Mutes (announcement mode) or Unmutes the group.
 */
export async function setGroupMute(
  sock: WASocket,
  groupJid: string,
  mute: boolean
): Promise<boolean> {
  try {
    const mode = mute ? 'announcement' : 'not_announcement';
    await sock.groupSettingUpdate(groupJid, mode);
    return true;
  } catch (error) {
    console.error(`Failed to update mute state for ${groupJid}:`, error);
    return false;
  }
}

/**
 * Locks or unlocks group settings modifications (Admins Only vs All Members).
 */
export async function setGroupSettingsLock(
  sock: WASocket,
  groupJid: string,
  lockForAdminsOnly: boolean
): Promise<boolean> {
  try {
    const mode = lockForAdminsOnly ? 'locked' : 'unlocked';
    await sock.groupSettingUpdate(groupJid, mode);
    return true;
  } catch (error) {
    console.error(`Failed to lock/unlock settings for ${groupJid}:`, error);
    return false;
  }
}

/**
 * Toggles whether all participants are allowed to add members to the group.
 */
export async function setMemberAddPolicy(
  sock: WASocket,
  groupJid: string,
  allowAllMembersToAdd: boolean
): Promise<boolean> {
  try {
    const mode = allowAllMembersToAdd ? 'all_member_add' : 'admin_add';
    await sock.groupMemberAddMode(groupJid, mode);
    return true;
  } catch (error) {
    console.error(`Failed to update member add policy for ${groupJid}:`, error);
    return false;
  }
}

// ==========================================
// 6. DISAPPEARING MESSAGES & CHAT PRIVACY
// ==========================================

/**
 * Updates Ephemeral / Disappearing message timers (Off, 24h, 7d, 90d).
 * Values in seconds: 0 = Off, 86400 = 24h, 604800 = 7d, 7776000 = 90d.
 */
export async function setDisappearingMessages(
  sock: WASocket,
  groupJid: string,
  seconds: 0 | 86400 | 604800 | 7776000
): Promise<boolean> {
  try {
    await sock.groupToggleEphemeral(groupJid, seconds);
    return true;
  } catch (error) {
    console.error(`Failed to set disappearing messages for ${groupJid}:`, error);
    return false;
  }
}

// ==========================================
// 7. GROUP SUBJECT, DESC, PFP & LINK MANAGEMENT
// ==========================================

/**
 * Updates group title/subject.
 */
export async function updateGroupSubject(
  sock: WASocket,
  groupJid: string,
  subject: string
): Promise<boolean> {
  try {
    await sock.groupUpdateSubject(groupJid, subject);
    return true;
  } catch (error) {
    console.error(`Failed to update group subject for ${groupJid}:`, error);
    return false;
  }
}

/**
 * Updates group description.
 */
export async function updateGroupDescription(
  sock: WASocket,
  groupJid: string,
  description: string
): Promise<boolean> {
  try {
    await sock.groupUpdateDescription(groupJid, description);
    return true;
  } catch (error) {
    console.error(`Failed to update group description for ${groupJid}:`, error);
    return false;
  }
}

/**
 * Updates group profile picture from an incoming image message buffer.
 */
export async function updateGroupPfp(
  sock: WASocket,
  groupJid: string,
  msg: WAMessage
): Promise<boolean> {
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {});
    await sock.updateProfilePicture(groupJid, buffer);
    return true;
  } catch (error) {
    console.error(`Failed to update group PFP for ${groupJid}:`, error);
    return false;
  }
}

/**
 * Resets/revokes current invite link and generates a brand new link.
 */
export async function revokeAndGetGroupLink(
  sock: WASocket,
  groupJid: string
): Promise<string | null> {
  try {
    const code = await sock.groupRevokeInvite(groupJid);
    return `https://chat.whatsapp.com/${code}`;
  } catch (error) {
    console.error(`Failed to revoke group link for ${groupJid}:`, error);
    return null;
  }
}

// ==========================================
// 8. BROADCASTING: TAGALL & HIDETAG
// ==========================================

/**
 * Universal tagall or hidetag execution.
 * Mentions all participants while preserving message format.
 */
export async function executeGroupTag(
  sock: WASocket,
  groupJid: string,
  messageText: string,
  hideMentions: boolean = false,
  quotedMsg?: WAMessage
): Promise<boolean> {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const mentions = metadata.participants.map((p) => p.id);

    if (hideMentions) {
      // Hidetag: sends text naturally without listing visible @mentions
      await sock.sendMessage(
        groupJid,
        { text: messageText, mentions: mentions },
        { quoted: quotedMsg }
      );
    } else {
      // Visible TagAll: builds explicit list of mentions
      let tagText = `${messageText}\n\n`;
      for (const jid of mentions) {
        tagText += `@${jid.split('@')[0]} `;
      }
      await sock.sendMessage(
        groupJid,
        { text: tagText.trim(), mentions: mentions },
        { quoted: quotedMsg }
      );
    }
    return true;
  } catch (error) {
    console.error(`Failed to execute group tag in ${groupJid}:`, error);
    return false;
  }
}

// ==========================================
// 9. POLL CREATION & UTILITY
// ==========================================

/**
 * Creates a native WhatsApp poll in the group.
 */
export async function createGroupPoll(
  sock: WASocket,
  groupJid: string,
  title: string,
  options: string[],
  selectableCount: number = 1
): Promise<boolean> {
  try {
    await sock.sendMessage(groupJid, {
      poll: {
        name: title,
        values: options,
        selectableCount: selectableCount
      }
    });
    return true;
  } catch (error) {
    console.error(`Failed to create poll in ${groupJid}:`, error);
    return false;
  }
}

// ==========================================
// 10. CALL SIGNALING & TIMED CALLS
// ==========================================

/**
 * Triggers group call offer signaling.
 * Handles auto-ending timed calls using native timeout schedules.
 */
export async function manageGroupCall(
  sock: WASocket,
  groupJid: string,
  durationMinutes?: number
): Promise<boolean> {
  try {
    // Generate call node offer
    const callId = `call_${Date.now()}`;
    await sock.query({
      tag: 'call',
      attrs: {
        to: groupJid,
        id: callId
      },
      content: [
        {
          tag: 'offer',
          attrs: {
            'call-creator': sock.user?.id || '',
            'call-id': callId
          },
          content: []
        }
      ]
    });

    // Schedule auto-termination if duration parameter was passed
    if (durationMinutes && durationMinutes > 0) {
      setTimeout(async () => {
        try {
          await sock.query({
            tag: 'call',
            attrs: {
              to: groupJid,
              id: callId
            },
            content: [
              {
                tag: 'terminate',
                attrs: {
                  'call-id': callId,
                  reason: 'hangup'
                },
                content: []
              }
            ]
          });
          console.log(`Timed call automatically ended after ${durationMinutes} minute(s).`);
        } catch (err) {
          console.error('Failed to terminate timed group call:', err);
        }
      }, durationMinutes * 60 * 1000);
    }

    return true;
  } catch (error) {
    console.error(`Failed to manage group call in ${groupJid}:`, error);
    return false;
  }
}

// ==========================================
// 11. MESSAGE DELETION
// ==========================================

/**
 * Deletes any targeted message from the group.
 */
export async function deleteGroupMessage(
  sock: WASocket,
  groupJid: string,
  msg: WAMessage
): Promise<boolean> {
  try {
    await sock.sendMessage(groupJid, { delete: msg.key });
    return true;
  } catch (error) {
    console.error(`Failed to delete message in ${groupJid}:`, error);
    return false;
  }
    }
