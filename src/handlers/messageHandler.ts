import { WASocket, WAMessage, isJidGroup, jidNormalizedUser, downloadMediaMessage } from '@whiskeysockets/baileys';
import { GoogleGenAI } from '@google/genai';
import { loadPersona } from '../utils/persona.js';
import { getGroupState, setAntiLinkState } from '../config/groupState.js';
import { getChatContext, formatContextForAI } from '../services/groupContextService.js';
import {
  updateGroupSubject,
  updateGroupDescription,
  updateGroupPfp,
  deleteMessage,
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

const personaText = loadPersona();

// Anti-link & Anti-status detection regexes
const WHATSAPP_LINK_REGEX = /(chat\.whatsapp\.com\/[A-Za-z0-9]{20,26}|whatsapp\.com\/channel\/[A-Za-z0-9]{20,26})/i;
const STATUS_SHARE_REGEX = /(whatsapp\.com\/status\/|status@broadcast)/i;

// Mapping of country names to dial prefixes for AI matching
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

export async function handleGroupMessage(
  sock: WASocket,
  msg: WAMessage,
  ai: GoogleGenAI
): Promise<void> {
  if (!msg.message || msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  if (!jid) return;

  const isGroup = isJidGroup(jid);

  const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    '';

  // --- PASSIVE ANTI-LINK & ANTI-STATUS CHECK ---
  if (isGroup) {
    const groupState = getGroupState(jid);
    if (groupState.antiLink === 1) {
      if (WHATSAPP_LINK_REGEX.test(text) || STATUS_SHARE_REGEX.test(text)) {
        await deleteMessage(sock, jid, msg);
        return;
      }
    }
  }

  // Target matching checks
  const rawBotId = sock.user?.id || '';
  const botJid = jidNormalizedUser(rawBotId);
  const contextInfo = msg.message.extendedTextMessage?.contextInfo;
  
  const mentionedJids = (contextInfo?.mentionedJid || []).map((id) => jidNormalizedUser(id));
  const quotedParticipant = contextInfo?.participant ? jidNormalizedUser(contextInfo.participant) : '';

  const isMentioned = botJid ? mentionedJids.includes(botJid) : false;
  const isQuoted = botJid ? quotedParticipant === botJid : false;
  const hasNameTag = text.toLowerCase().includes('rubix');

  if (!isMentioned && !isQuoted && !hasNameTag) return;

  const promptText = text.replace(/@\d+/g, '').replace(/rubix/gi, '').trim();
  const lowerPrompt = promptText.toLowerCase();

  // FETCH GROUP & USER CONTEXT
  const contextData = await getChatContext(sock, msg);

  // --- DIRECT ADMIN ACTIONS ---
  if (isGroup) {
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

    // 1. Anti-Link Controls
    if (lowerPrompt.includes('activate antilink') || lowerPrompt.includes('enable antilink')) {
      if (!(await checkAdmin())) return;
      setAntiLinkState(jid, 1);
      await sock.sendMessage(jid, { text: 'Anti-link & anti-status protection enabled [1].' }, { quoted: msg });
      return;
    }

    if (lowerPrompt.includes('deactivate antilink') || lowerPrompt.includes('disable antilink')) {
      if (!(await checkAdmin())) return;
      setAntiLinkState(jid, 0);
      await sock.sendMessage(jid, { text: 'Anti-link & anti-status protection disabled [0].' }, { quoted: msg });
      return;
    }

    // 2. Poll Creation
    if (lowerPrompt.includes('create a poll') || lowerPrompt.includes('make a poll') || lowerPrompt.startsWith('poll')) {
      if (!(await checkAdmin())) return;
      
      const optionMatches = [...promptText.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
      let question = promptText.split(/option|['"]/i)[0].replace(/^(create|make)?\s*(a)?\s*poll\s*:?/i, '').trim();
      
      if (!question) question = 'Group Poll';
      
      const options = optionMatches.length >= 2 ? optionMatches : ['Yes', 'No'];
      const success = await createGroupPoll(sock, jid, question, options);
      
      if (!success) {
        await sock.sendMessage(jid, { text: 'Failed to create poll.' }, { quoted: msg });
      }
      return;
    }

    // 3. Disappearing Messages
    if (lowerPrompt.includes('disappearing messages') || lowerPrompt.includes('disappearing message')) {
      if (!(await checkAdmin())) return;
      let seconds = 0;
      if (lowerPrompt.includes('24') || lowerPrompt.includes('1 day') || lowerPrompt.includes('24h')) seconds = 86400;
      else if (lowerPrompt.includes('7') || lowerPrompt.includes('7 days') || lowerPrompt.includes('7d')) seconds = 604800;
      else if (lowerPrompt.includes('90') || lowerPrompt.includes('90 days')) seconds = 7776000;
      else if (lowerPrompt.includes('off') || lowerPrompt.includes('disable')) seconds = 0;

      const success = await setDisappearingMessages(sock, jid, seconds);
      await sock.sendMessage(
        jid,
        { text: success ? `Disappearing messages timer updated.` : 'Failed to set disappearing messages.' },
        { quoted: msg }
      );
      return;
    }

    // 4. Group Info Edit Settings
    if (lowerPrompt.includes('only admins can edit') || lowerPrompt.includes('lock group info')) {
      if (!(await checkAdmin())) return;
      const success = await setGroupEditSetting(sock, jid, true);
      await sock.sendMessage(jid, { text: success ? 'Group info editing restricted to admins.' : 'Failed to update setting.' }, { quoted: msg });
      return;
    }

    if (lowerPrompt.includes('all members can edit') || lowerPrompt.includes('unlock group info')) {
      if (!(await checkAdmin())) return;
      const success = await setGroupEditSetting(sock, jid, false);
      await sock.sendMessage(jid, { text: success ? 'All members can now edit group info.' : 'Failed to update setting.' }, { quoted: msg });
      return;
    }

    // 5. Country Demographics Check
    if (lowerPrompt.includes('how many')) {
      const countryCode = resolveCountryPrefix(promptText);
      if (countryCode) {
        const matches = await getMembersByCountryCode(sock, jid, countryCode);
        await sock.sendMessage(
          jid,
          { text: `Found ${matches.length} member(s) registered with prefix +${countryCode}.` },
          { quoted: msg }
        );
        return;
      }
    }

    // 6. Direct User Removal & Purging
    const targetJids = mentionedJids.filter((id) => id !== botJid);
    if (quotedParticipant && quotedParticipant !== botJid) {
      targetJids.push(quotedParticipant);
    }

    if (lowerPrompt.includes('remove') || lowerPrompt.includes('kick')) {
      if (!(await checkAdmin())) return;

      const countryCode = resolveCountryPrefix(promptText);
      if (countryCode && (lowerPrompt.includes('all') || lowerPrompt.includes('users') || lowerPrompt.includes('members'))) {
        const countryMembers = await getMembersByCountryCode(sock, jid, countryCode);
        if (countryMembers.length === 0) {
          await sock.sendMessage(jid, { text: `No members found matching prefix +${countryCode}.` }, { quoted: msg });
          return;
        }
        const success = await removeGroupUsers(sock, jid, countryMembers);
        await sock.sendMessage(
          jid,
          { text: success ? `Purged ${countryMembers.length} member(s) with prefix +${countryCode}.` : 'Failed to execute purge.' },
          { quoted: msg }
        );
        return;
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
          return;
        }

        const success = await removeGroupUsers(sock, jid, nonAdminMembers);
        await sock.sendMessage(
          jid,
          { text: success ? `Purged ${nonAdminMembers.length} member(s).` : 'Failed to execute numerical purge.' },
          { quoted: msg }
        );
        return;
      }

      if (targetJids.length > 0) {
        const success = await removeGroupUsers(sock, jid, targetJids);
        await sock.sendMessage(
          jid,
          { text: success ? 'User(s) removed successfully.' : 'Failed to remove user(s).' },
          { quoted: msg }
        );
        return;
      }
    }

    // Basic admin commands preserved
    if (lowerPrompt.includes('mute group') || lowerPrompt.includes('close group')) {
      if (!(await checkAdmin())) return;
      const success = await setGroupMute(sock, jid, true);
      await sock.sendMessage(jid, { text: success ? 'Group muted.' : 'Failed to mute.' }, { quoted: msg });
      return;
    }

    if (lowerPrompt.includes('unmute group') || lowerPrompt.includes('open group')) {
      if (!(await checkAdmin())) return;
      const success = await setGroupMute(sock, jid, false);
      await sock.sendMessage(jid, { text: success ? 'Group unmuted.' : 'Failed to unmute.' }, { quoted: msg });
      return;
    }

    if (lowerPrompt.startsWith('tagall') || lowerPrompt.startsWith('everyone')) {
      if (!(await checkAdmin())) return;
      const announcement = promptText.replace(/^(tagall|everyone)\s*/i, '');
      await executeTagAll(sock, jid, announcement);
      return;
    }

    if (lowerPrompt.startsWith('hidetag')) {
      if (!(await checkAdmin())) return;
      const announcement = promptText.replace(/^hidetag\s*/i, '') || 'Attention everyone!';
      await executeHideTag(sock, jid, announcement);
      return;
    }

    if (lowerPrompt.includes('get link') || lowerPrompt.includes('group link')) {
      const link = await getGroupInviteLink(sock, jid);
      await sock.sendMessage(jid, { text: link ? `Group Invite Link:\n${link}` : 'Failed to fetch link.' }, { quoted: msg });
      return;
    }

    if (lowerPrompt.includes('reset link') || lowerPrompt.includes('revoke link')) {
      if (!(await checkAdmin())) return;
      const newLink = await revokeGroupLink(sock, jid);
      await sock.sendMessage(jid, { text: newLink ? `Link reset. New link:\n${newLink}` : 'Failed to reset link.' }, { quoted: msg });
      return;
    }

    if (lowerPrompt.includes('accept all requests') || lowerPrompt.includes('approve all requests')) {
      if (!(await checkAdmin())) return;
      const result = await handleJoinRequests(sock, jid, 'approve');
      await sock.sendMessage(jid, { text: result }, { quoted: msg });
      return;
    }

    if (lowerPrompt.includes('decline all requests') || lowerPrompt.includes('reject all requests')) {
      if (!(await checkAdmin())) return;
      const result = await handleJoinRequests(sock, jid, 'reject');
      await sock.sendMessage(jid, { text: result }, { quoted: msg });
      return;
    }

    if (lowerPrompt.includes('promote')) {
      if (!(await checkAdmin())) return;
      if (targetJids.length === 0) {
        await sock.sendMessage(jid, { text: 'Mention or quote a user to promote.' }, { quoted: msg });
        return;
      }
      const success = await promoteUsers(sock, jid, targetJids);
      await sock.sendMessage(jid, { text: success ? 'User(s) promoted to admin.' : 'Failed to promote.' }, { quoted: msg });
      return;
    }

    if (lowerPrompt.includes('demote')) {
      if (!(await checkAdmin())) return;
      if (targetJids.length === 0) {
        await sock.sendMessage(jid, { text: 'Mention or quote an admin to demote.' }, { quoted: msg });
        return;
      }
      const success = await demoteUsers(sock, jid, targetJids);
      await sock.sendMessage(jid, { text: success ? 'User(s) demoted.' : 'Failed to demote.' }, { quoted: msg });
      return;
    }

    const nameMatch = promptText.match(/(?:change|set|rename)\s+(?:the\s+)?group\s+name\s+(?:to\s+)?(.+)/i);
    if (nameMatch && nameMatch[1]) {
      if (!(await checkAdmin())) return;
      const newName = nameMatch[1].trim();
      const success = await updateGroupSubject(sock, jid, newName);
      await sock.sendMessage(jid, { text: success ? `Group name updated to: "${newName}"` : 'Failed to update name.' }, { quoted: msg });
      return;
    }

    const descMatch = promptText.match(/(?:change|set)\s+(?:the\s+)?group\s+description\s+to\s+(.+)/i);
    if (descMatch && descMatch[1]) {
      if (!(await checkAdmin())) return;
      const newDesc = descMatch[1].trim();
      const success = await updateGroupDescription(sock, jid, newDesc);
      await sock.sendMessage(jid, { text: success ? 'Group description updated successfully.' : 'Failed to update description.' }, { quoted: msg });
      return;
    }

    const imageMsg = msg.message.imageMessage;
    const isPfpRequest =
      lowerPrompt.includes('pfp') ||
      lowerPrompt.includes('icon') ||
      lowerPrompt.includes('photo') ||
      lowerPrompt.includes('picture') ||
      lowerPrompt.includes('avatar');

    if (imageMsg && isPfpRequest) {
      if (!(await checkAdmin())) return;
      const success = await updateGroupPfp(sock, jid, msg);
      await sock.sendMessage(jid, { text: success ? 'Group profile picture updated.' : 'Failed to update profile picture.' }, { quoted: msg });
      return;
    }
  }

  // --- AI PROCESSING ---
  let placeholderMsg;
  try {
    placeholderMsg = await sock.sendMessage(
      jid,
      { text: '_rubixing..._' },
      { quoted: msg }
    );
  } catch (err) {
    console.error('Failed to send placeholder message:', err);
    return;
  }

  try {
    const imageMsg = msg.message.imageMessage;
    const contents: any[] = [];

    if (imageMsg) {
      const imageBuffer = await downloadMediaMessage(msg, 'buffer', {});
      contents.push({
        inlineData: {
          mimeType: imageMsg.mimetype || 'image/jpeg',
          data: imageBuffer.toString('base64')
        }
      });
    }

    let quotedMessageText = '';
    if (contextInfo?.quotedMessage) {
      quotedMessageText =
        contextInfo.quotedMessage.conversation ||
        contextInfo.quotedMessage.extendedTextMessage?.text ||
        contextInfo.quotedMessage.imageMessage?.caption ||
        contextInfo.quotedMessage.videoMessage?.caption ||
        '';
    }

    const environmentBlock = formatContextForAI(contextData);

    const fullSystemInstruction = `${personaText}

=== ENVIRONMENT DATA ===
${environmentBlock}

Answer the active user using your persona while maintaining awareness of the chat environment context.`;

    let finalPrompt = promptText || (imageMsg ? 'Describe what is in this image.' : 'Hello!');

    if (quotedMessageText) {
      finalPrompt = `[HIGHLIGHTED/QUOTED MESSAGE BEING REPLIED TO]: "${quotedMessageText}"\n\n[USER QUESTION/COMMAND]: ${finalPrompt}`;
    }

    contents.push(finalPrompt);

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents,
      config: {
        systemInstruction: fullSystemInstruction,
        temperature: 0.7,
        maxOutputTokens: 300
      }
    });

    const replyText = response.text || 'Process completed with no output.';

    if (placeholderMsg && placeholderMsg.key) {
      await sock.sendMessage(jid, {
        text: replyText,
        edit: placeholderMsg.key
      });
    }
  } catch (error) {
    console.error('Error generating content from Gemini:', error);
    if (placeholderMsg && placeholderMsg.key) {
      await sock.sendMessage(jid, {
        text: 'System core error. Try again.',
        edit: placeholderMsg.key
      });
    }
  }
  }
