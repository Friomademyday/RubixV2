import { WAMessage, jidNormalizedUser } from '@whiskeysockets/baileys';

export interface SavedMessage {
  senderJid: string;
  senderName: string;
  text: string;
  timestamp: number;
}

const historyStore: Record<string, SavedMessage[]> = {};
const MAX_HISTORY = 6;

/**
 * Pushes incoming messages into the in-memory ring buffer for a given chat JID.
 */
export function recordMessage(msg: WAMessage): void {
  const jid = msg.key.remoteJid;
  if (!jid) return;

  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    '';

  if (!text.trim()) return;

  const rawSender = msg.key.participant || msg.key.remoteJid || '';
  const senderJid = jidNormalizedUser(rawSender);
  const senderName = msg.pushName || senderJid.split('@')[0] || 'Unknown User';

  if (!historyStore[jid]) {
    historyStore[jid] = [];
  }

  historyStore[jid].push({
    senderJid,
    senderName,
    text,
    timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : Date.now()
  });

  if (historyStore[jid].length > MAX_HISTORY) {
    historyStore[jid].shift();
  }
}

/**
 * Formats history into a clean string block for Gemini prompt context.
 */
export function getFormattedHistory(jid: string): string {
  const messages = historyStore[jid] || [];
  if (messages.length === 0) return 'No prior recent messages stored.';

  return messages
    .map((m) => `[${m.senderName} (${m.senderJid})]: ${m.text}`)
    .join('\n');
  }
