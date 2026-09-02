import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'edge-tts';

// UK English Female Neural Voices:
// 'en-GB-SoniaNeural' - Warm, expressive, clear UK tone
// 'en-GB-MaisieNeural' - Soft, reflective, atmospheric UK tone
const SELECTED_VOICE = 'en-GB-SoniaNeural';

/**
 * Generates natural neural UK audio and sends it as a native WhatsApp PTT Voice Note.
 */
export async function sendNaturalVoiceNote(
  sock: WASocket,
  jid: string,
  text: string,
  quotedMsg: WAMessage
): Promise<void> {
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(SELECTED_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

    // Synthesize audio into memory
    const { audioBuffer } = await tts.toBuffer(text);

    // Send as authentic WhatsApp Push-To-Talk voice note (green mic wave)
    await sock.sendMessage(
      jid,
      {
        audio: audioBuffer,
        mimetype: 'audio/mp4',
        ptt: true
      },
      { quoted: quotedMsg }
    );
  } catch (error) {
    console.error('Edge-TTS natural voice generation failed:', error);
    // Graceful fallback to text if synthesis encounters an error
    await sock.sendMessage(jid, { text }, { quoted: quotedMsg });
  }
      }
