import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { GoogleGenAI } from '@google/genai';
import { GroupChatContext } from '../services/groupContextService.js';

export async function processSearchCommands(
  sock: WASocket,
  jid: string,
  msg: WAMessage,
  promptText: string,
  contextData: GroupChatContext,
  ai: GoogleGenAI
): Promise<boolean> {
  const lowerPrompt = promptText.toLowerCase();

  // Natural language query triggers for live info search
  const isSearchRequest =
    lowerPrompt.includes('search') ||
    lowerPrompt.includes('look up') ||
    lowerPrompt.includes('google') ||
    lowerPrompt.includes('what is the latest') ||
    lowerPrompt.includes('weather in') ||
    lowerPrompt.includes('news about');

  if (!isSearchRequest) return false;

  let placeholderMsg;
  try {
    placeholderMsg = await sock.sendMessage(
      jid,
      { text: '_accessing web consciousness..._' },
      { quoted: msg }
    );

    // Call Gemini with Google Search grounding enabled
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: promptText,
      config: {
        tools: [{ googleSearch: {} }], // Live search capability
        temperature: 0.4
      }
    });

    const answer = response.text || 'Unable to retrieve live search information.';

    if (placeholderMsg && placeholderMsg.key) {
      await sock.sendMessage(jid, {
        text: answer,
        edit: placeholderMsg.key
      });
    }
    return true;
  } catch (err) {
    console.error('Search handler error:', err);
    if (placeholderMsg && placeholderMsg.key) {
      await sock.sendMessage(jid, {
        text: 'Failed to complete web query.',
        edit: placeholderMsg.key
      });
    }
    return true;
  }
  }
