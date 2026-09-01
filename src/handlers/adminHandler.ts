import { WASocket, WAMessage, jidNormalizedUser } from '@whiskeysockets/baileys';
import { setAntiLinkState } from '../config/groupState.js';
import {
  updateGroupSubject,
  updateGroupDescription,
  updateGroupPfp,
  setGroupMute,
  revokeGroupLink,
  getGroupInviteLink,
  executeTagAll,
  executeHideTag,
  promoteUsers,
  demoteUsers,
  handleJoinRequests,
  createGroupPoll,
  setDisappearingMessages,
  setGroupEditSetting,
  removeGroupUsers,
  getMembersByCountryCode
} from '../services/groupAdminService.js';
import { GroupChatContext } from '../services/groupContextService.js';

const COUNTRY_CODES: Record<string, string> = {
  nigeria: '234', nigerian: '234', nigerians: '234',
  pakistan: '92', pakistani: '92', pakistanis: '92', pakistands: '92',
  india: '91', indian: '91', indians: '91',
  usa: '1', american: '1', americans: '1', us: '1',
  uk: '44', british: '44', english: '44',
  indonesia: '62', indonesian: '62', indonesians: '62',
  brazil: '55', brazilian: '55', brazilians: '55',
  bangladesh: '880', bangladeshi: '880', bangladeshis: '880',
  philippines: '63', filipino: '63', filipinos: '63',
  kenya: '254', kenyan: '254', kenyans: '254',
  ghana: '233', ghanain: '233', ghanains: '233'
};

function resolveCountryPrefix(text: string): string | null {
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    const cleanWord = word.replace(/[^a-z]/g, '');
    if (COUNTRY_CODES[cleanWord]) {
      return COUNTRY_CODES[cleanWord];
    }
  }
  return null;
}

export async function processAdminCommands(
  sock: WASocket,
  jid: string,
  msg: WAMessage,
  promptText: string,
  contextData: GroupChatContext,
  botJid: string
): Promise<boolean> {
  const lowerPrompt = promptText.toLowerCase();
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const mentionedJids = (contextInfo?.mentionedJid || []).map((id) => jidNormalizedUser(id));
  const quotedParticipant = contextInfo?.participant ? jidNormalizedUser(contextInfo.participant) : '';

  const checkAdmin = async (): Promise<boolean> => {
    if (!contextData.isAdmin) {
      await sock.sendMessage(
        jid,
        { text: `Access denied, ${contextData.senderName}. This command requires group admin privileges.` },
        { quoted: msg }
      );
      return false;
    }
    return true;
  };

  if (lowerPrompt.includes('activate antilink') || lowerPrompt.includes('enable antilink')) {
    if (!(await checkAdmin())) return true;
    setAntiLinkState(jid, 1);
    await sock.sendMessage(jid, { text: 'Anti-link & anti-status protection enabled [1].' }, { quoted: msg });
    return true;
  }

  if (lowerPrompt.includes('deactivate antilink') || lowerPrompt.includes('disable antilink')) {
    if (!(await checkAdmin())) return true;
    setAntiLinkState(jid, 0);
    await sock.sendMessage(jid, { text: 'Anti-link & anti-status protection disabled [0].' }, { quoted: msg });
    return true;
  }

  if (lowerPrompt.includes('create a poll') || lowerPrompt.includes('make a poll') || lowerPrompt.startsWith('poll')) {
    if (!(await checkAdmin())) return true;
    const optionMatches = [...promptText.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
    let question = promptText.split(/option|['"]/i)[0].replace(/^(create|make)?\s*(a)?\s*poll\s*:?/i, '').trim();
    if (!question) question = 'Group Poll';
    const options = optionMatches.length >= 2 ? optionMatches : ['Yes', 'No'];
    const success = await createGroupPoll(sock, jid, question, options);
    if (!success) {
      await sock.sendMessage(jid, { text: 'Failed to create poll.' }, { quoted: msg });
    }
    return true;
  }

  if (lowerPrompt.includes('disappearing messages') || lowerPrompt.includes('disappearing message')) {
    if (!(await checkAdmin())) return true;
    let seconds = 0;
    if (lowerPrompt.includes('24') || lowerPrompt.includes('1 day') || lowerPrompt.includes('24h')) seconds = 86400;
    else if (lowerPrompt.includes('7') || lowerPrompt.includes('7 days') || lowerPrompt.includes('7d')) seconds = 604800;
    else if (lowerPrompt.includes('90') || lowerPrompt.includes('90 days')) seconds = 7776000;
    else if (lowerPrompt.includes('off') || lowerPrompt.includes('disable')) seconds = 0;

    const success = await setDisappearingMessages(sock, jid, seconds);
    await sock.sendMessage(
      jid,
      { text: success ? 'Disappearing messages timer updated.' : 'Failed to set disappearing messages.' },
      { quoted: msg }
    );
    return true;
  }

  if (lowerPrompt.includes('only admins can edit') || lowerPrompt.includes('lock group info')) {
    if (!(await checkAdmin())) return true;
    const success = await setGroupEditSetting(sock, jid, true);
    await sock.sendMessage(jid, { text: success ? 'Group info editing restricted to admins.' : 'Failed to update setting.' }, { quoted: msg });
    return true;
  }

  if (lowerPrompt.includes('all members can edit') || lowerPrompt.includes('unlock group info')) {
    if (!(await checkAdmin())) return true;
    const success = await setGroupEditSetting(sock, jid, false);
    await sock.sendMessage(jid, { text: success ? 'All members can now edit group info.' : 'Failed to update setting.' }, { quoted: msg });
    return true;
  }

  if (lowerPrompt.includes('how many')) {
    const countryCode = resolveCountryPrefix(promptText);
    if (countryCode) {
      const matches = await getMembersByCountryCode(sock, jid, countryCode);
      await sock.sendMessage(
        jid,
        { text: `Found ${matches.length} member(s) registered with prefix +${countryCode}.` },
        { quoted: msg }
      );
      return true;
    }
  }

  const targetJids = mentionedJids.filter((id) => id !== botJid);
  if (quotedParticipant && quotedParticipant !== botJid) {
    targetJids.push(quotedParticipant);
  }

  if (lowerPrompt.includes('remove') || lowerPrompt.includes('kick')) {
    if (!(await checkAdmin())) return true;

    const countryCode = resolveCountryPrefix(promptText);
    if (countryCode && (lowerPrompt.includes('all') || lowerPrompt.includes('users') || lowerPrompt.includes('members'))) {
      const countryMembers = await getMembersByCountryCode(sock, jid, countryCode);
      if (countryMembers.length === 0) {
        await sock.sendMessage(jid, { text: `No members found matching prefix +${countryCode}.` }, { quoted: msg });
        return true;
      }
      const success = await removeGroupUsers(sock, jid, countryMembers);
      await sock.sendMessage(
        jid,
        { text: success ? `Purged ${countryMembers.length} member(s) with prefix +${countryCode}.` : 'Failed to execute purge.' },
        { quoted: msg }
      );
      return true;
    }

    const numberMatch = promptText.match(/(?:remove|kick)\s+(\d+)\s+(?:users|members|people)/i);
    if (numberMatch && numberMatch[1]) {
      const count = parseInt(numberMatch[1], 10);
      const metadata = await sock.groupMetadata(jid);
      const nonAdminMembers = metadata.participants
        .filter((p) => !p.admin && jidNormalizedUser(p.id) !== botJid)
        .map((p) => jidNormalizedUser(p.id))
        .slice(0, count);

      if (nonAdminMembers.length === 0) {
        await sock.sendMessage(jid, { text: 'No non-admin members available to purge.' }, { quoted: msg });
        return true;
      }

      const success = await removeGroupUsers(sock, jid, nonAdminMembers);
      await sock.sendMessage(
        jid,
        { text: success ? `Purged ${nonAdminMembers.length} member(s).` : 'Failed to execute numerical purge.' },
        { quoted: msg }
      );
      return true;
    }

    if (targetJids.length > 0) {
      const success = await removeGroupUsers(sock, jid, targetJids);
      await sock.sendMessage(
        jid,
        { text: success ? 'User(s) removed successfully.' : 'Failed to remove user(s).' },
        { quoted: msg }
      );
      return true;
    }
  }

  if (lowerPrompt.includes('mute group') || lowerPrompt.includes('close group')) {
    if (!(await checkAdmin())) return true;
    const success = await setGroupMute(sock, jid, true);
    await sock.sendMessage(jid, { text: success ? 'Group muted.' : 'Failed to mute.' }, { quoted: msg });
    return true;
  }

  if (lowerPrompt.includes('unmute group') || lowerPrompt.includes('open group')) {
    if (!(await checkAdmin())) return true;
    const success = await setGroupMute(sock, jid, false);
    await sock.sendMessage(jid, { text: success ? 'Group unmuted.' : 'Failed to unmute.' }, { quoted: msg });
    return true;
  }

  if (lowerPrompt.startsWith('tagall') || lowerPrompt.startsWith('everyone')) {
    if (!(await checkAdmin())) return true;
    const announcement = promptText.replace(/^(tagall|everyone)\s*/i, '');
    await executeTagAll(sock, jid, announcement);
    return true;
  }

  if (lowerPrompt.startsWith('hidetag')) {
    if (!(await checkAdmin())) return true;
    const announcement = promptText.replace(/^hidetag\s*/i, '') || 'Attention everyone!';
    await executeHideTag(sock, jid, announcement);
    return true;
  }

  if (lowerPrompt.includes('get link') || lowerPrompt.includes('group link')) {
    const link = await getGroupInviteLink(sock, jid);
    await sock.sendMessage(jid, { text: link ? `Group Invite Link:\n${link}` : 'Failed to fetch link.' }, { quoted: msg });
    return true;
  }

  if (lowerPrompt.includes('reset link') || lowerPrompt.includes('revoke link')) {
    if (!(await checkAdmin())) return true;
    const newLink = await revokeGroupLink(sock, jid);
    await sock.sendMessage(jid, { text: newLink ? `Link reset. New link:\n${newLink}` : 'Failed to reset link.' }, { quoted: msg });
    return true;
  }

  if (lowerPrompt.includes('accept all requests') || lowerPrompt.includes('approve all requests')) {
    if (!(await checkAdmin())) return true;
    const result = await handleJoinRequests(sock, jid, 'approve');
    await sock.sendMessage(jid, { text: result }, { quoted: msg });
    return true;
  }

  if (lowerPrompt.includes('decline all requests') || lowerPrompt.includes('reject all requests')) {
    if (!(await checkAdmin())) return true;
    const result = await handleJoinRequests(sock, jid, 'reject');
    await sock.sendMessage(jid, { text: result }, { quoted: msg });
    return true;
  }

  if (lowerPrompt.includes('promote')) {
    if (!(await checkAdmin())) return true;
    if (targetJids.length === 0) {
      await sock.sendMessage(jid, { text: 'Mention or quote a user to promote.' }, { quoted: msg });
      return true;
    }
    const success = await promoteUsers(sock, jid, targetJids);
    await sock.sendMessage(jid, { text: success ? 'User(s) promoted to admin.' : 'Failed to promote.' }, { quoted: msg });
    return true;
  }

  if (lowerPrompt.includes('demote')) {
    if (!(await checkAdmin())) return true;
    if (targetJids.length === 0) {
      await sock.sendMessage(jid, { text: 'Mention or quote an admin to demote.' }, { quoted: msg });
      return true;
    }
    const success = await demoteUsers(sock, jid, targetJids);
    await sock.sendMessage(jid, { text: success ? 'User(s) demoted.' : 'Failed to demote.' }, { quoted: msg });
    return true;
  }

  const nameMatch = promptText.match(/(?:change|set|rename)\s+(?:the\s+)?group\s+name\s+(?:to\s+)?(.+)/i);
  if (nameMatch && nameMatch[1]) {
    if (!(await checkAdmin())) return true;
    const newName = nameMatch[1].trim();
    const success = await updateGroupSubject(sock, jid, newName);
    await sock.sendMessage(jid, { text: success ? `Group name updated to: "${newName}"` : 'Failed to update name.' }, { quoted: msg });
    return true;
  }

  const descMatch = promptText.match(/(?:change|set)\s+(?:the\s+)?group\s+description\s+to\s+(.+)/i);
  if (descMatch && descMatch[1]) {
    if (!(await checkAdmin())) return true;
    const newDesc = descMatch[1].trim();
    const success = await updateGroupDescription(sock, jid, newDesc);
    await sock.sendMessage(jid, { text: success ? 'Group description updated successfully.' : 'Failed to update description.' }, { quoted: msg });
    return true;
  }

  const imageMsg = msg.message?.imageMessage;
  const isPfpRequest =
    lowerPrompt.includes('pfp') ||
    lowerPrompt.includes('icon') ||
    lowerPrompt.includes('photo') ||
    lowerPrompt.includes('picture') ||
    lowerPrompt.includes('avatar');

  if (imageMsg && isPfpRequest) {
    if (!(await checkAdmin())) return true;
    const success = await updateGroupPfp(sock, jid, msg);
    await sock.sendMessage(jid, { text: success ? 'Group profile picture updated.' : 'Failed to update profile picture.' }, { quoted: msg });
    return true;
  }

  return false;
}
