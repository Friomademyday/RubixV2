import { WASocket, WAMessage, isJidGroup, jidNormalizedUser } from '@whiskeysockets/baileys';

export interface GroupContextInfo {
  isGroup: boolean;
  senderJid: string;
  senderName: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  groupSubject?: string;
  groupDescription?: string;
  totalMembers?: number;
  adminCount?: number;
  regularMemberCount?: number;
  creationTime?: string;
  ownerJid?: string;
  adminList?: string[];
}

const metadataCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60000;

export async function getChatContext(
  sock: WASocket,
  msg: WAMessage
): Promise<GroupContextInfo> {
  const jid = msg.key.remoteJid || '';
  const isGroup = isJidGroup(jid);

  const rawSender = msg.key.participant || msg.key.remoteJid || '';
  const senderJid = jidNormalizedUser(rawSender);
  
  const rawPushName = msg.pushName;
  const phoneNumber = senderJid.split('@')[0];
  const senderName = rawPushName && rawPushName.trim() !== '' ? rawPushName : `+${phoneNumber}`;

  if (!isGroup) {
    return {
      isGroup: false,
      senderJid,
      senderName,
      isAdmin: false,
      isSuperAdmin: false
    };
  }

  try {
    let metadata: any;
    const now = Date.now();
    const cached = metadataCache.get(jid);

    if (cached && now - cached.timestamp < CACHE_TTL) {
      metadata = cached.data;
    } else {
      metadata = await sock.groupMetadata(jid);
      metadataCache.set(jid, { data: metadata, timestamp: now });
    }

    const participants = metadata.participants || [];

    const participant = participants.find(
      (p: any) => jidNormalizedUser(p.id) === senderJid
    );

    const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
    const isSuperAdmin = participant?.admin === 'superadmin';

    const adminParticipants = participants.filter(
      (p: any) => p.admin === 'admin' || p.admin === 'superadmin'
    );

    const adminList = adminParticipants.map((p: any) => jidNormalizedUser(p.id));
    const adminCount = adminParticipants.length;
    const totalMembers = participants.length;
    const regularMemberCount = totalMembers - adminCount;

    const creationDate = metadata.creation
      ? new Date(metadata.creation * 1000).toISOString().split('T')[0]
      : 'Unknown';

    return {
      isGroup: true,
      senderJid,
      senderName,
      isAdmin,
      isSuperAdmin,
      groupSubject: metadata.subject,
      groupDescription: metadata.desc || 'No description',
      totalMembers,
      adminCount,
      regularMemberCount,
      creationTime: creationDate,
      ownerJid: metadata.owner ? jidNormalizedUser(metadata.owner) : 'Unknown',
      adminList
    };
  } catch (error) {
    console.error(`Failed to fetch group metadata for ${jid}:`, error);
    return {
      isGroup: true,
      senderJid,
      senderName,
      isAdmin: false,
      isSuperAdmin: false
    };
  }
}

export function formatContextForAI(context: GroupContextInfo): string {
  if (!context.isGroup) {
    return `[ENVIRONMENT: DIRECT CHAT (PM)]\nActive User Name: ${context.senderName}\nSender ID: ${context.senderJid}`;
  }

  const formattedAdmins = context.adminList && context.adminList.length > 0
    ? context.adminList.map((id) => `@${id.split('@')[0]}`).join(', ')
    : 'None listed';

  return `[ENVIRONMENT: GROUP CHAT]
Group Name: ${context.groupSubject}
Total Members: ${context.totalMembers}
Total Admins: ${context.adminCount}
Regular Members: ${context.regularMemberCount}
List of Admins: ${formattedAdmins}
Created On: ${context.creationTime}
Group Owner: ${context.ownerJid}
Active User Name: ${context.senderName}
Active Sender ID: ${context.senderJid}
Is Active User Admin: ${context.isAdmin ? 'YES' : 'NO'}`;
      }
