declare module 'ws';

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import WebSocket from 'ws';
import { WASocket, WAMessage } from '@whiskeysockets/baileys';

export const OUTPUT_FORMAT = {
  AUDIO_24KHZ_96KBITRATE_MONO_MP3: 'audio-24khz-96kbitrate-mono-mp3'
};

export class MsEdgeTTS {
  private voice: string = 'en-US-AriaNeural';
  private outputFormat: string = 'audio-24khz-96kbitrate-mono-mp3';

  async setMetadata(voice: string, format: string): Promise<void> {
    this.voice = voice;
    this.outputFormat = format;
  }

  async toFile(outputPath: string, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomBytes(16).toString('hex');
      const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?trustedclientid=6A5AA1D4EAFF432FB3B0D2C6B95C361F`;
      
      const ws = new WebSocket(url, {
        headers: {
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
        }
      });

      const fileStream = fs.createWriteStream(outputPath);
      let audioStarted = false;

      ws.on('open', () => {
        const configMessage = `X-Timestamp:${Date.now()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"${this.outputFormat}"}}}}`;
        ws.send(configMessage);

        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${this.voice}'>${text}</voice></speak>`;
        const ssmlMessage = `X-RequestId:${requestId}\r\nX-Timestamp:${Date.now()}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
        ws.send(ssmlMessage);
      });

      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) {
          if (!audioStarted) {
            const headerIndex = Buffer.from(data as Buffer).indexOf(Buffer.from('Path:audio\r\n'));
            if (headerIndex !== -1) {
              audioStarted = true;
              const audioData = (data as Buffer).slice(headerIndex + 12);
              fileStream.write(audioData);
            }
          } else {
            fileStream.write(data as Buffer);
          }
        }
      });

      ws.on('close', () => {
        fileStream.end();
        resolve();
      });

      ws.on('error', (error: any) => {
        fileStream.destroy();
        reject(error);
      });
    });
  }
}

export async function sendNaturalVoiceNote(
  sock: WASocket,
  jid: string,
  text: string,
  quotedMsg?: WAMessage
): Promise<void> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata('en-US-AriaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const tempFilePath = path.join('/tmp', `tts_${Date.now()}.mp3`);
  
  try {
    await tts.toFile(tempFilePath, text);
    await sock.sendMessage(
      jid,
      {
        audio: { url: tempFilePath },
        mimetype: 'audio/mp4',
        ptt: true
      },
      { quoted: quotedMsg }
    );
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
                }
