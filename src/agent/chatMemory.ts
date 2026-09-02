import { WAMessage, jidNormalizedUser } from '@whiskeysockets/baileys';

export interface MemoryMessage {
  senderJid: string;
  senderName: string;
  text: string;
  timestamp: number;
}

// In-memory circular buffer keyed by group JID
const GROUP_MEMORIES: Map<string, MemoryMessage[]> = new Map();
const MAX_MEMORY_SIZE = 25;

/**
 * Pushes a message into the group's RAM memory buffer.
 */
export function recordGroupMessage(
  groupJid: string,
  msg: WAMessage,
  senderName: string
): void {
  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    '';

  if (!text.trim()) return;

  const senderJid = jidNormalizedUser(msg.key.participant || msg.key.remoteJid || '');

  const history = GROUP_MEMORIES.get(groupJid) || [];
  history.push({
    senderJid,
    senderName: senderName || 'Group Member',
    text,
    timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now()
  });

  // Keep array within buffer capacity
  if (history.length > MAX_MEMORY_SIZE) {
    history.shift();
  }

  GROUP_MEMORIES.set(groupJid, history);
}

/**
 * Gets the active group history formatted cleanly for Gemini context.
 */
export function getFormattedGroupMemory(groupJid: string): string {
  const history = GROUP_MEMORIES.get(groupJid) || [];
  if (history.length === 0) return 'No recent chat history recorded.';

  return history
    .map((m) => `[${m.senderName}]: ${m.text}`)
    .join('\n');
}

/**
 * Retrieves raw array for analytics or chat summarization.
 */
export function getRawGroupMemory(groupJid: string): MemoryMessage[] {
  return GROUP_MEMORIES.get(groupJid) || [];
                     }
