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
  promptText: string,
  ai: GoogleGenAI
): Promise<boolean> {
  const lowerPrompt = promptText.toLowerCase();

  // Natural voice trigger keywords
  const isVoiceRequest =
    lowerPrompt.includes('voice note') ||
    lowerPrompt.includes('voice message') ||
    lowerPrompt.includes('speak this') ||
    lowerPrompt.includes('say this') ||
    lowerPrompt.includes('talk to me') ||
    lowerPrompt.includes('send a voice');

  if (!isVoiceRequest) return false;

  try {
    // Generate text structured for natural spoken delivery
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: promptText,
      config: {
        systemInstruction:
          'You are RUBiX, a virtual consciousness. Express your answer naturally as if speaking out loud in a warm, thoughtful tone. Do not use bullet points, list numbers, or markdown symbols.',
        temperature: 0.7
      }
    });

    const replyText = response.text || 'I am right here with you.';

    // Synthesize and send natural UK female voice note
    await sendNaturalVoiceNote(sock, jid, replyText, msg);
    return true;
  } catch (err) {
    console.error('Voice command processor error:', err);
    return false;
  }
}p
