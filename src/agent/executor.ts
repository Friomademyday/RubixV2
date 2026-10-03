import { WASocket, WAMessage } from '@whiskeysockets/baileys';

export async function executePolynomialTasks(
  sock: WASocket,
  jid: string,
  senderJid: string,
  msg: WAMessage,
  pipeline: any[]
): Promise<string[]> {
  const logs: string[] = [];
  
  if (!pipeline || !Array.isArray(pipeline)) {
    return logs;
  }

  for (const task of pipeline) {
    try {
      if (typeof task.execute === 'function') {
        await task.execute(sock, jid, senderJid, msg);
        logs.push(`Executed task: ${task.name || 'task'}`);
      }
    } catch (error) {
      console.error('Task execution error:', error);
      logs.push(`Failed task: ${task.name || 'task'}`);
    }
  }

  return logs;
}
