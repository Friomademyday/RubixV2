import { WASocket, WAMessage, isJidGroup, jidNormalizedUser, downloadMediaMessage } from '@whiskeysockets/baileys';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { loadPersona } from '../utils/persona.js';
import { getGroupState } from '../config/groupState.js';
import { getChatContext, formatContextForAI } from '../services/groupContextService.js';
import { deleteMessage } from '../services/groupAdminService.js';
import { processAdminCommands } from './adminHandler.js';
import { processMediaCommands } from './mediaHandler.js';
import { processUtilityCommands } from './utilityHandler.js';
import { processSearchCommands } from './searchHandler.js';
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
  const botJid = jidNormalizedUser(rawBotId);
  const contextInfo = msg.message.extendedTextMessage?.contextInfo;

  const mentionedJids = (contextInfo?.mentionedJid || []).map((id) => jidNormalizedUser(id));
  const quotedParticipant = contextInfo?.participant ? jidNormalizedUser(contextInfo.participant) : '';

  const isMentioned = botJid ? mentionedJids.includes(botJid) : false;
  const isQuoted = botJid ? quotedParticipant === botJid : false;
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
  const senderIsAdmin = participantsData.some((p) => p.jid === senderJid && p.admin !== null);

  let placeholderMsg: WAMessage | undefined;
  try {
    placeholderMsg = await sock.sendMessage(jid, { text: '_processing..._' }, { quoted: msg });
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
        } else if (call.name === 'generateMediaContent') {
          const { type, promptOrText } = call.args as { type: string; promptOrText: string };
          if (type === 'voice') {
            await processVoiceCommands(sock, jid, msg, promptOrText, ai);
          } else if (type === 'image') {
            await processMediaCommands(sock, jid, msg, promptOrText);
          }
        } else if (call.name === 'scheduleFutureTask') {
          const { actionType, executionTimeUnix, payload } = call.args as any;
          if (placeholderMsg?.key) {
            await sock.sendMessage(jid, { text: `Task scheduled for execution at timestamp ${executionTimeUnix}.`, edit: placeholderMsg.key });
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
