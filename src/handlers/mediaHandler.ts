import { WASocket, WAMessage, downloadMediaMessage } from '@whiskeysockets/baileys';

const STICKER_PACK_NAME = 'RUBiX';
const STICKER_AUTHOR = 'by Frio';

/**
 * Checks for natural sticker creation requests and executes sticker/audio processing.
 */
export async function processMediaCommands(
  sock: WASocket,
  jid: string,
  msg: WAMessage,
  promptText: string
): Promise<boolean> {
  const lowerPrompt = promptText.toLowerCase();

  // Natural sticker detection triggers
  const isStickerRequest =
    lowerPrompt.includes('sticker') ||
    lowerPrompt.includes('make this a sticker') ||
    lowerPrompt.includes('turn this into a sticker') ||
    lowerPrompt.includes('convert to sticker');

  // Natural audio extraction triggers
  const isAudioRequest =
    lowerPrompt.includes('to audio') ||
    lowerPrompt.includes('extract audio') ||
    lowerPrompt.includes('turn this to audio') ||
    lowerPrompt.includes('convert to audio') ||
    lowerPrompt.includes('get audio');

  if (!isStickerRequest && !isAudioRequest) {
    return false;
  }

  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const targetMsg = contextInfo?.quotedMessage ? { message: contextInfo.quotedMessage } as WAMessage : msg;

  const imageMsg = targetMsg.message?.imageMessage;
  const videoMsg = targetMsg.message?.videoMessage;

  // --- STICKER CONVERSION ---
  if (isStickerRequest) {
    if (!imageMsg && !videoMsg) {
      await sock.sendMessage(
        jid,
        { text: 'Please attach or reply to an image or short video to convert it into a sticker.' },
        { quoted: msg }
      );
      return true;
    }

    try {
      const mediaBuffer = await downloadMediaMessage(targetMsg, 'buffer', {});

      await sock.sendMessage(
        jid,
        {
          sticker: mediaBuffer,
          packname: STICKER_PACK_NAME,
          author: STICKER_AUTHOR
        },
        { quoted: msg }
      );
    } catch (err) {
      console.error('Failed to generate sticker:', err);
      await sock.sendMessage(jid, { text: 'Failed to generate sticker.' }, { quoted: msg });
    }
    return true;
  }

  // --- AUDIO EXTRACTION ---
  if (isAudioRequest) {
    if (!videoMsg) {
      await sock.sendMessage(
        jid,
        { text: 'Please attach or reply to a video message to extract audio.' },
        { quoted: msg }
      );
      return true;
    }

    try {
      const videoBuffer = await downloadMediaMessage(targetMsg, 'buffer', {});

      await sock.sendMessage(
        jid,
        {
          audio: videoBuffer,
          mimetype: 'audio/mp4',
          ptt: false
        },
        { quoted: msg }
      );
    } catch (err) {
      console.error('Failed to extract audio:', err);
      await sock.sendMessage(jid, { text: 'Failed to extract audio.' }, { quoted: msg });
    }
    return true;
  }

  return false;
         }
