import { WASocket, WAMessage, isJidGroup, jidNormalizedUser, downloadMediaMessage } from '@whiskeysockets/baileys';
import { GoogleGenAI } from '@google/genai';
import { loadPersona } from '../utils/persona.js';
import { getGroupState } from '../config/groupState.js';
import { deleteGroupMessage } from '../services/groupAdminService.js';
import { decomposePromptToPolynomial, executePolynomialTasks } from '../engine/arithmeticEngine.js';

const personaText = loadPersona();
const WHATSAPP_LINK_REGEX = /(chat\.whatsapp\.com\/[A-Za-z0-9]{20,26}|whatsapp\.com\/channel\/[A-Za-z0-9]{20,26})/i;

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

  if (isGroup) {
    const groupState = getGroupState(jid);
    if (groupState.antiLink === 1 && WHATSAPP_LINK_REGEX.test(text)) {
      await deleteGroupMessage(sock, jid, msg);
      return;
    }
  }

  const rawBotId = sock.user?.id || '';
  const botJid = jidNormalizedUser(rawBotId);
  const senderJid = jidNormalizedUser(msg.key.participant || msg.key.remoteJid || '');

  const contextInfo = msg.message.extendedTextMessage?.contextInfo;
  const mentionedJids = (contextInfo?.mentionedJid || []).map((id) => jidNormalizedUser(id));
  const quotedParticipant = contextInfo?.participant ? jidNormalizedUser(contextInfo.participant) : '';

  const isMentioned = botJid ? mentionedJids.includes(botJid) : false;
  const isQuoted = botJid ? quotedParticipant === botJid : false;
  const hasNameTag = text.toLowerCase().includes('rubix');

  if (!isMentioned && !isQuoted && !hasNameTag) return;

  const promptText = text.replace(/@\d+/g, '').replace(/rubix/gi, '').trim();

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

    const finalPrompt = promptText || (imageMsg ? 'Analyze this image.' : 'Hello!');
    
    const polynomialPipeline = await decomposePromptToPolynomial(ai, finalPrompt);

    const taskExecutionLogs = await executePolynomialTasks(
      sock,
      jid,
      senderJid,
      msg,
      polynomialPipeline
    );

    contents.push(
      `User Prompt: "${finalPrompt}"\n\n` +
      `Polynomial Sequence: ${polynomialPipeline.polynomialDegreeNotation}\n` +
      `Backend Execution Logs:\n${taskExecutionLogs.join('\n')}\n\n` +
      `Synthesize a complete response to the user reflecting the results above while adhering strictly to your persona.`
    );

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: contents,
      config: {
        systemInstruction: personaText,
        temperature: 0.7
      }
    });

    const replyText = response.text || 'Action pipeline executed successfully.';

    if (placeholderMsg && placeholderMsg.key) {
      await sock.sendMessage(jid, {
        text: replyText,
        edit: placeholderMsg.key
      });
    }
  } catch (error) {
    console.error('Error executing message handling pipeline:', error);
    if (placeholderMsg && placeholderMsg.key) {
      await sock.sendMessage(jid, {
        text: 'Core system disruption. Failed to execute task pipeline.',
        edit: placeholderMsg.key
      });
    }
  }
                                       }
