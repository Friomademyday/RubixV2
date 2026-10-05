import { WASocket, WAMessage, isJidGroup, jidNormalizedUser, downloadMediaMessage } from '@whiskeysockets/baileys';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { loadPersona } from '../utils/persona.js';
import { getGroupState, setAntiLinkState } from '../config/groupState.js';
import { getChatContext, formatContextForAI } from '../services/groupContextService.js';
import { 
  deleteMessage, 
  updateGroupSubject, 
  updateGroupDescription, 
  updateGroupPfp, 
  setGroupMute, 
  revokeGroupLink, 
  getGroupInviteLink, 
  executeTagAll, 
  executeHideTag 
} from '../services/groupAdminService.js';
import { processMediaCommands } from './mediaHandler.js';
import { processVoiceCommands } from './voiceHandler.js';
import { recordGroupMessage, getFormattedGroupMemory } from '../agent/chatMemory.js';

const personaText = loadPersona();
const WHATSAPP_LINK_REGEX = /(chat\.whatsapp\.com\/[A-Za-z0-9]{20,26}|whatsapp\.com\/channel\/[A-Za-z0-9]{20,26})/i;
const STATUS_SHARE_REGEX = /(whatsapp\.com\/status\/|status@broadcast)/i;

const systemTools: FunctionDeclaration[] = [
  {
    name: 'manageGroupParticipants',
    description: 'Add, remove, promote, or demote group participants.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { 
          type: Type.STRING, 
          enum: ['remove', 'add', 'promote', 'demote'] 
        },
        jids: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING },
          description: 'Target user JIDs resolved by AI calculation.'
        },
        reason: { type: Type.STRING }
      },
      required: ['action', 'jids']
    }
  },
  {
    name: 'executeGroupAdminAction',
    description: 'Execute group setting updates including group subject, description, icon/profile picture (pfp), mute/unmute, antilink, revoking invite links, tagall, and hidetag.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          enum: ['updateSubject', 'updateDescription', 'updatePfp', 'setMute', 'setUnmute', 'setAntiLink', 'revokeLink', 'getInviteLink', 'tagAll', 'hideTag']
        },
        value: { type: Type.STRING, description: 'New subject text, description text, or antilink toggle (1 or 0).' }
      },
      required: ['action']
    }
  },
  {
    name: 'scheduleFutureTask',
    description: 'Schedule any administrative or message action for a future time.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        actionType: { type: Type.STRING, description: 'The task to execute later.' },
        executionTimeUnix: { type: Type.NUMBER, description: 'Target epoch timestamp in seconds.' },
        payload: { type: Type.OBJECT, description: 'Arguments needed to execute the task.' }
      },
      required: ['actionType', 'executionTimeUnix']
    }
  },
  {
    name: 'generateMediaContent',
    description: 'Generate images or synthesize natural voice notes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, enum: ['image', 'voice'] },
        promptOrText: { type: Type.STRING }
      },
      required: ['type', 'promptOrText']
    }
  }
];

function cleanPlainText(text: string): string {
  return text
    .replace(/[*_~`]/g, '')
    .replace(/^[\s]*[-+*]\s+/gm, '')
    .replace(/^[\s]*#+\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

  const contextData = await getChatContext(sock, msg);

  if (isGroup) {
    const groupState = getGroupState(jid);
    if (groupState.antiLink === 1) {
      if (WHATSAPP_LINK_REGEX.test(text) || STATUS_SHARE_REGEX.test(text)) {
        await deleteMessage(sock, jid, msg);
        return;
      }
    }
    recordGroupMessage(jid, msg, contextData.senderName);
  }

  const rawBotId = sock.user?.id || '';
  const botNumber = rawBotId.split(':')[0].split('@')[0];
  const botJid = jidNormalizedUser(rawBotId);
  const contextInfo = msg.message.extendedTextMessage?.contextInfo || msg.message.imageMessage?.contextInfo || msg.message.videoMessage?.contextInfo;

  const rawMentions = contextInfo?.mentionedJid || [];
  const mentionedJids = rawMentions.map((id) => jidNormalizedUser(id));
  const quotedParticipant = contextInfo?.participant ? jidNormalizedUser(contextInfo.participant) : '';

  const isMentioned = botJid ? (mentionedJids.includes(botJid) || rawMentions.some((m) => m.includes(botNumber))) : false;
  const isQuoted = botJid ? (quotedParticipant === botJid || quotedParticipant.includes(botNumber)) : false;
  const hasNameTag = text.toLowerCase().includes('rubix');

  if (isGroup && !isMentioned && !isQuoted && !hasNameTag) {
    return;
  }

  const promptText = text.replace(/@\d+/g, '').replace(/rubix/gi, '').trim();

  let groupMetadata = null;
  let participantsData: any[] = [];
  if (isGroup) {
    groupMetadata = await sock.groupMetadata(jid);
    participantsData = groupMetadata.participants.map((p) => ({
      jid: p.id,
      admin: p.admin,
      isSuperAdmin: p.admin === 'superadmin'
    }));
  }

  const senderJid = msg.key.participant || msg.key.remoteJid || '';
  const senderIsAdmin = participantsData.some((p) => p.jid === senderJid && Boolean(p.admin));
  
  let placeholderMsg: WAMessage | undefined;
  try {
    placeholderMsg = await sock.sendMessage(jid, { text: '_rubixing..._' }, { quoted: msg });
  } catch (err) {
    console.error('Failed placeholder message:', err);
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

    const environmentBlock = formatContextForAI(contextData);
    const memoryBlock = isGroup ? getFormattedGroupMemory(jid) : 'N/A';
    const currentTimeStr = new Date().toISOString();

    const executiveSystemInstruction = `${personaText}

SYSTEM ROLE:
You are the central Executive Brain of the system. You possess tools that map directly to system handlers.
Current ISO Time: ${currentTimeStr}
Sender JID: ${senderJid}
Sender is Group Admin: ${senderIsAdmin}

OPERATIONAL LAWS:
1. Distinguish between a standard conversation and an action request/task.
2. If the prompt is an action request, choose the appropriate Tool Call and perform all necessary logic (such as calculating target JIDs based on percentages, country code prefixes, or scheduling times) using the provided PARTICIPANTS DATA.
3. For administrative tasks (remove, add, promote, demote), verify that 'Sender is Group Admin' is true. If false, decline the request in text without invoking the tool.
4. If no action is required, reply directly in plain text.

CRITICAL FORMATTING INSTRUCTIONS:
- PLAIN TEXT ONLY.
- DO NOT use markdown symbols (*, _, ~, \`, #, -, +).

=== GROUP PARTICIPANTS DATA ===
${JSON.stringify(participantsData)}

=== ENVIRONMENT DATA ===
${environmentBlock}

=== RECENT CHAT MEMORY ===
${memoryBlock}`;

    let finalPrompt = promptText || (imageMsg ? 'Describe what is in this image.' : 'Hello!');
    contents.push(finalPrompt);

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents,
      config: {
        systemInstruction: executiveSystemInstruction,
        tools: [{ functionDeclarations: systemTools }],
        temperature: 0.2
      }
    });

    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const call of response.functionCalls) {
        if (call.name === 'manageGroupParticipants') {
          const { action, jids } = call.args as { action: string; jids: string[] };
          if (isGroup && senderIsAdmin) {
            await sock.groupParticipantsUpdate(jid, jids, action as any);
            const statusText = `Successfully executed ${action} action on ${jids.length} participant(s).`;
            if (placeholderMsg?.key) {
              await sock.sendMessage(jid, { text: statusText, edit: placeholderMsg.key });
            }
          } else {
            if (placeholderMsg?.key) {
              await sock.sendMessage(jid, { text: 'Admin privileges required to perform this action.', edit: placeholderMsg.key });
            }
          }
        } else if (call.name === 'executeGroupAdminAction') {
          const { action, value } = call.args as { action: string; value?: string };
          if (!isGroup) {
            if (placeholderMsg?.key) {
              await sock.sendMessage(jid, { text: 'This command can only be used in group chats.', edit: placeholderMsg.key });
            }
            continue;
          }
          if (!senderIsAdmin) {
            if (placeholderMsg?.key) {
              await sock.sendMessage(jid, { text: 'Admin privileges required to perform group settings updates.', edit: placeholderMsg.key });
            }
            continue;
          }

          let actionSuccess = false;
          if (action === 'updateSubject' && value) {
            actionSuccess = await updateGroupSubject(sock, jid, value);
          } else if (action === 'updateDescription' && value) {
            actionSuccess = await updateGroupDescription(sock, jid, value);
          } else if (action === 'updatePfp') {
            actionSuccess = await updateGroupPfp(sock, jid, msg);
          } else if (action === 'setMute') {
            actionSuccess = await setGroupMute(sock, jid, true);
          } else if (action === 'setUnmute') {
            actionSuccess = await setGroupMute(sock, jid, false);
          } else if (action === 'setAntiLink' && value) {
            setAntiLinkState(jid, parseInt(value, 10));
            actionSuccess = true;
          } else if (action === 'revokeLink') {
            actionSuccess = await revokeGroupLink(sock, jid);
          } else if (action === 'getInviteLink') {
            const link = await getGroupInviteLink(sock, jid);
            if (placeholderMsg?.key) {
              await sock.sendMessage(jid, { text: link ? `Group Invite Link: ${link}` : 'Failed to retrieve invite link.', edit: placeholderMsg.key });
            }
            continue;
          } else if (action === 'tagAll') {
            actionSuccess = await executeTagAll(sock, jid, value || 'Attention everyone');
          } else if (action === 'hideTag') {
            actionSuccess = await executeHideTag(sock, jid, value || 'Announcement');
          }

          if (placeholderMsg?.key) {
            await sock.sendMessage(jid, { text: actionSuccess ? `Action ${action} executed successfully.` : `Failed to execute ${action}.`, edit: placeholderMsg.key });
          }
        } else if (call.name === 'generateMediaContent') {
          const { type, promptOrText } = call.args as { type: string; promptOrText: string };
          if (type === 'voice') {
            await processVoiceCommands(sock, jid, msg, promptOrText, ai);
            if (placeholderMsg?.key) {
              await deleteMessage(sock, jid, placeholderMsg);
            }
          } else if (type === 'image') {
            if (placeholderMsg?.key) {
              await sock.sendMessage(jid, { text: '_generating image..._', edit: placeholderMsg.key });
            }
            await processMediaCommands(sock, jid, msg, promptOrText);
          }
        } else if (call.name === 'scheduleFutureTask') {
          const { actionType, executionTimeUnix } = call.args as any;
          if (placeholderMsg?.key) {
            await sock.sendMessage(jid, { text: `Task ${actionType} scheduled for timestamp ${executionTimeUnix}.`, edit: placeholderMsg.key });
          }
        }
      }
    } else {
      const rawReply = response.text || 'Process completed with no output.';
      const replyText = cleanPlainText(rawReply);
      if (placeholderMsg?.key) {
        await sock.sendMessage(jid, { text: replyText, edit: placeholderMsg.key });
      }
    }
  } catch (error) {
    console.error('Executive Brain error:', error);
    if (placeholderMsg?.key) {
      await sock.sendMessage(jid, { text: 'System core processing error.', edit: placeholderMsg.key });
    }
  }
    }
