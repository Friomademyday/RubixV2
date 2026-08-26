import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys';
import { GoogleGenAI } from '@google/genai';
import pino from 'pino';
import dotenv from 'dotenv';
import { handleGroupMessage } from './handlers/messageHandler.js';

dotenv.config();

const phoneNumber = process.env.PHONE_NUMBER;
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('Error: GEMINI_API_KEY is not defined in environment variables.');
  process.exit(1);
}

if (!phoneNumber) {
  console.error('Error: PHONE_NUMBER is not defined in environment variables.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    const cleanNumber = phoneNumber!.replace(/[^0-9]/g, '');
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(cleanNumber);
        console.log(`\n========================================`);
        console.log(`PAIRING CODE FOR RUBIX: ${code}`);
        console.log(`========================================\n`);
      } catch (err) {
        console.error('Failed to request pairing code:', err);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === 'open') {
      console.log('Rubix is online and operational.');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;
    for (const msg of m.messages) {
      await handleGroupMessage(sock, msg, ai);
    }
  });
}

startBot();
