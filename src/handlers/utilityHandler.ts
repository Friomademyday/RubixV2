import { WASocket, WAMessage, jidNormalizedUser } from '@whiskeysockets/baileys';
import { GoogleGenAI } from '@google/genai';
import { getFormattedGroupMemory, getRawGroupMemory } from '../agent/chatMemory.ts';
import { GroupChatContext } from '../services/groupContextService.js';

export async function processUtilityCommands(
  sock: WASocket,
  jid: string,
  msg: WAMessage,
  promptText: string,
  contextData: GroupChatContext,
  ai: GoogleGenAI
): Promise<boolean> {
  const lowerPrompt = promptText.toLowerCase();

  // 1. Natural Identity Query ("Who am I?")
  if (lowerPrompt.includes('who am i') || lowerPrompt.includes('my profile')) {
    const role = contextData.isAdmin ? 'Group Admin' : 'Member';
    await sock.sendMessage(
      jid,
      { text: `You are **${contextData.senderName}**, participating as a **${role}** in this chat.` },
      { quoted: msg }
    );
    return true;
  }

  // 2. Chat Summarization ("Summarize the chat / recent messages")
  if (
    lowerPrompt.includes('summarize') ||
    lowerPrompt.includes('summary of chat') ||
    lowerPrompt.includes('what did i miss') ||
    lowerPrompt.includes('catch me up')
  ) {
    const recentHistory = getFormattedGroupMemory(jid);

    try {
      const summaryResponse = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: [
          `Summarize the following recent group chat history clearly in 3 concise bullet points:\n\n${recentHistory}`
        ],
        config: { temperature: 0.3 }
      });

      await sock.sendMessage(
        jid,
        { text: `**Group Consciousness Summary:**\n\n${summaryResponse.text}` },
        { quoted: msg }
      );
    } catch (err) {
      console.error('Failed to generate summary:', err);
      await sock.sendMessage(jid, { text: 'Unable to process chat summary at the moment.' }, { quoted: msg });
    }
    return true;
  }

  // 3. Ghost Member Detection ("Check ghost members / inactive members")
  if (
    lowerPrompt.includes('ghost members') ||
    lowerPrompt.includes('inactive members') ||
    lowerPrompt.includes('ghosts')
  ) {
    if (!contextData.isAdmin) {
      await sock.sendMessage(jid, { text: 'Access denied. Ghost member checks require admin privileges.' }, { quoted: msg });
      return true;
    }

    const metadata = await sock.groupMetadata(jid);
    const activeSenders = new Set(getRawGroupMemory(jid).map((m) => m.senderJid));

    const ghosts = metadata.participants.filter((p) => {
      const cleanJid = jidNormalizedUser(p.id);
      return !activeSenders.has(cleanJid) && !p.admin;
    });

    await sock.sendMessage(
      jid,
      {
        text: `**Ghost Member Report:**\nFound **${ghosts.length}** inactive non-admin member(s) based on recent memory activity.`
      },
      { quoted: msg }
    );
    return true;
  }

  return false;
      }
