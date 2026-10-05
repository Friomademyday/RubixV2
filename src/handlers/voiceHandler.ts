import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { GoogleGenAI } from '@google/genai';
import { sendNaturalVoiceNote } from '../services/voiceService.js';

/**
 * Handles explicit requests for voice notes and conversational spoken responses.
 */
export async function processVoiceCommands(
  sock: WASocket,
  jid: string,
  msg: WAMessage,
  textToSpeak: string,
  ai?: GoogleGenAI
): Promise<boolean> {
  try {
    const cleanSpeechText = textToSpeak
      .replace(/[*_~`]/g, '')
      .replace(/^[\s]*[-+*]\s+/gm, '')
      .trim();

    await sendNaturalVoiceNote(sock, jid, cleanSpeechText || 'I am right here with you.', msg);
    return true;
  } catch (err) {
    console.error('Voice command processor error:', err);
    return false;
  }
}
