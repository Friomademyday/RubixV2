import { WASocket, WAMessage, isJidGroup, jidNormalizedUser, downloadMediaMessage } from '@whiskeysockets/baileys';
import { GoogleGenAI } from '@google/genai';
import { loadPersona } from '../utils/persona.js';
import { getGroupState } from '../config/groupState.js';
import { getChatContext, formatContextForAI } from '../services/groupContextService.js';
import { deleteMessage } from '../services/groupAdminService.js';
import { processAdminCommands } from './adminHandler.js';

const personaText = loadPersona();

const WHATSAPP_LINK_REGEX = /(chat\.whatsapp\.com\/[A-Za-z0-9]{20,26}|whatsapp\.com\/channel\/[A-Za-z0-9]{20,26})/i;
const STATUS_SHARE_REGEX = /(whatsapp\.com\/status\/|status@broadcast)/i;

/**
 * Removes all markdown formatting symbols (*, _, ~, `, #, -, +, etc.)
 * leaving clean plain text.
 */
function cleanPlainText(text: string): string {
  return text
    // Remove bold/italic asterisks, underscores, tildes, and backticks
    .replace(/[*_~`]/g, '')
    // Remove bullet point markers at the start of lines (- , + , * )
    .replace(/^[\s]*[-+*]\s+/gm, '')
    // Remove header symbols (# Heading -> Heading)
    .replace(/^[\s]*#+\s+/gm, '')
    // Clean up multiple empty line breaks
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

  // Passive Anti-Link & Anti-Status check
  if (isGroup) {
    const groupState = getGroupState(jid);
    if (groupState.antiLink === 1) {
      if (WHATSAPP_LINK_REGEX.test(text) || STATUS_SHARE_REGEX.test(text)) {
        await deleteMessage(sock, jid, msg);
        return;
      }
    }
  }

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

  // Fetch Group & User Context
  const contextData = await getChatContext(sock, msg);

  // Pass to admin command router first
  if (isGroup) {
    const wasAdminCommandHandled = await processAdminCommands(
      sock,
      jid,
      msg,
      promptText,
      contextData,
      botJid
    );
    if (wasAdminCommandHandled) return;
  }

  // Gemini Fallback Processing
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

CRITICAL FORMATTING INSTRUCTIONS:
- You must output PLAIN TEXT ONLY.
- DO NOT use any markdown characters: no asterisks (*), no underscores (_), no tildes (~), no backticks (\`), no hash tags (#), no hyphens (-), and no plus signs (+) for lists.
- For list structures or clear formatting, use numbered lists (1., 2., 3.) or plain line breaks only.
- Never wrap words in formatting symbols.

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

    const rawReply = response.text || 'Process completed with no output.';
    
    // Clean all special symbols from the output before sending to WhatsApp
    const replyText = cleanPlainText(rawReply);

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
