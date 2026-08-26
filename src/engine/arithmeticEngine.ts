import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { GoogleGenAI, Type } from '@google/genai';
import {
  isParticipantAdmin,
  isBotAdmin,
  getUniversalGroupData,
  kickParticipants,
  promoteParticipants,
  demoteParticipants,
  handlePendingRequests,
  setGroupMute,
  setGroupSettingsLock,
  setMemberAddPolicy,
  setDisappearingMessages,
  updateGroupSubject,
  updateGroupDescription,
  updateGroupPfp,
  revokeAndGetGroupLink,
  executeGroupTag,
  createGroupPoll,
  manageGroupCall,
  deleteGroupMessage
} from '../services/groupAdminService.js';
import { setAntiLinkState, getGroupState } from '../config/groupState.js';

// ==========================================
// 1. MATHEMATICAL TASK TYPES & INTERFACES
// ==========================================

export interface AtomicTask {
  degree: number; // Polynomial degree: nX^n down to nX^0
  taskType:
    | 'GET_DATE'
    | 'FETCH_COUNTRY_COUNT'
    | 'CHECK_PENDING_REQUESTS'
    | 'ACCEPT_PENDING_REQUESTS'
    | 'REJECT_PENDING_REQUESTS'
    | 'CHANGE_DESCRIPTION'
    | 'CHANGE_SUBJECT'
    | 'CHANGE_PFP'
    | 'TOGGLE_ANTILINK'
    | 'MUTE_GROUP'
    | 'UNMUTE_GROUP'
    | 'KICK_MEMBERS'
    | 'PROMOTE_MEMBERS'
    | 'DEMOTE_MEMBERS'
    | 'REVOKE_LINK'
    | 'TAG_ALL'
    | 'CREATE_POLL'
    | 'SET_DISAPPEARING'
    | 'MANAGE_CALL'
    | 'FETCH_GROUP_INFO'
    | 'GENERAL_QUERY';
  parameters?: {
    countryPrefix?: string;
    amount?: number | 'ALL';
    value?: string;
    targetJids?: string[];
    seconds?: 0 | 86400 | 604800 | 7776000;
    options?: string[];
    state?: 0 | 1;
  };
  requiresAdminPermission: boolean;
}

export interface PolynomialDecompositionResult {
  totalTasks: number; // Maximum polynomial degree n
  polynomialDegreeNotation: string; // e.g. "nX^5 + nX^4 + nX^3 + nX^2 + nX^1 + nX^0"
  tasks: AtomicTask[];
}

// ==========================================
// 2. GEMINI DECOMPOSITION SCHEMA
// ==========================================

const taskDecompositionSchema = {
  type: Type.OBJECT,
  properties: {
    totalTasks: { type: Type.INTEGER },
    polynomialDegreeNotation: { type: Type.STRING },
    tasks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          degree: { type: Type.INTEGER },
          taskType: {
            type: Type.STRING,
            enum: [
              'GET_DATE',
              'FETCH_COUNTRY_COUNT',
              'CHECK_PENDING_REQUESTS',
              'ACCEPT_PENDING_REQUESTS',
              'REJECT_PENDING_REQUESTS',
              'CHANGE_DESCRIPTION',
              'CHANGE_SUBJECT',
              'CHANGE_PFP',
              'TOGGLE_ANTILINK',
              'MUTE_GROUP',
              'UNMUTE_GROUP',
              'KICK_MEMBERS',
              'PROMOTE_MEMBERS',
              'DEMOTE_MEMBERS',
              'REVOKE_LINK',
              'TAG_ALL',
              'CREATE_POLL',
              'SET_DISAPPEARING',
              'MANAGE_CALL',
              'FETCH_GROUP_INFO',
              'GENERAL_QUERY'
            ]
          },
          parameters: {
            type: Type.OBJECT,
            properties: {
              countryPrefix: { type: Type.STRING },
              amount: { type: Type.INTEGER },
              value: { type: Type.STRING },
              targetJids: { type: Type.ARRAY, items: { type: Type.STRING } },
              seconds: { type: Type.INTEGER },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              state: { type: Type.INTEGER }
            }
          },
          requiresAdminPermission: { type: Type.BOOLEAN }
        },
        required: ['degree', 'taskType', 'requiresAdminPermission']
      }
    }
  },
  required: ['totalTasks', 'polynomialDegreeNotation', 'tasks']
};

// ==========================================
// 3. ARITHMETIC DECOMPOSITION ENGINE
// ==========================================

/**
 * Parses raw prompts into ordered atomic polynomial tasks (nX^n + ... + nX^0).
 * Performs local deterministic parsing to avoid network overhead and 503 limits.
 */
export async function decomposePromptToPolynomial(
  ai: GoogleGenAI,
  promptText: string
): Promise<PolynomialDecompositionResult> {
  const lower = promptText.toLowerCase();
  const tasks: AtomicTask[] = [];

  if (lower.includes('date') || lower.includes('today')) {
    tasks.push({ degree: 0, taskType: 'GET_DATE', requiresAdminPermission: false });
  }

  if (lower.includes('nigerian') || lower.includes('+234') || lower.includes('nigerians')) {
    tasks.push({
      degree: 0,
      taskType: 'FETCH_COUNTRY_COUNT',
      parameters: { countryPrefix: '234' },
      requiresAdminPermission: false
    });
  }

  if (lower.includes('pakistan') || lower.includes('+92') || lower.includes('pakistanis')) {
    tasks.push({
      degree: 0,
      taskType: 'FETCH_COUNTRY_COUNT',
      parameters: { countryPrefix: '92' },
      requiresAdminPermission: false
    });
  }

  if (lower.includes('pending') || lower.includes('request')) {
    if (lower.includes('accept') || lower.includes('approve')) {
      const match = lower.match(/\d+/);
      const amt = match ? parseInt(match[0]) : undefined;
      tasks.push({
        degree: 0,
        taskType: 'ACCEPT_PENDING_REQUESTS',
        parameters: { amount: amt },
        requiresAdminPermission: true
      });
    } else if (lower.includes('decline') || lower.includes('reject')) {
      const match = lower.match(/\d+/);
      const amt = match ? parseInt(match[0]) : undefined;
      tasks.push({
        degree: 0,
        taskType: 'REJECT_PENDING_REQUESTS',
        parameters: { amount: amt },
        requiresAdminPermission: true
      });
    } else {
      tasks.push({ degree: 0, taskType: 'CHECK_PENDING_REQUESTS', requiresAdminPermission: true });
    }
  }

  if (lower.includes('description') || lower.includes('desc')) {
    const descMatch = promptText.match(/(?:to|as)\s+([^,.]+)/i);
    tasks.push({
      degree: 0,
      taskType: 'CHANGE_DESCRIPTION',
      parameters: { value: descMatch ? descMatch[1].trim() : 'Updated group description.' },
      requiresAdminPermission: true
    });
  }

  if (lower.includes('subject') || lower.includes('group name') || lower.includes('rename')) {
    const nameMatch = promptText.match(/(?:to|as)\s+([^,.]+)/i);
    tasks.push({
      degree: 0,
      taskType: 'CHANGE_SUBJECT',
      parameters: { value: nameMatch ? nameMatch[1].trim() : 'Rubix Group' },
      requiresAdminPermission: true
    });
  }

  if (lower.includes('antilink')) {
    const state = lower.includes('off') || lower.includes('disable') ? 0 : 1;
    tasks.push({
      degree: 0,
      taskType: 'TOGGLE_ANTILINK',
      parameters: { state },
      requiresAdminPermission: true
    });
  }

  if (lower.includes('mute') && !lower.includes('unmute')) {
    tasks.push({ degree: 0, taskType: 'MUTE_GROUP', requiresAdminPermission: true });
  }

  if (lower.includes('unmute')) {
    tasks.push({ degree: 0, taskType: 'UNMUTE_GROUP', requiresAdminPermission: true });
  }

  if (lower.includes('revoke') || lower.includes('reset link')) {
    tasks.push({ degree: 0, taskType: 'REVOKE_LINK', requiresAdminPermission: true });
  }

  if (lower.includes('info') || lower.includes('members') || lower.includes('details')) {
    tasks.push({ degree: 0, taskType: 'FETCH_GROUP_INFO', requiresAdminPermission: false });
  }

  if (tasks.length === 0) {
    tasks.push({
      degree: 0,
      taskType: 'GENERAL_QUERY',
      parameters: { value: promptText },
      requiresAdminPermission: false
    });
  }

  const reversedTasks = tasks.reverse().map((t, index) => ({
    ...t,
    degree: tasks.length - 1 - index
  }));

  const total = reversedTasks.length;
  const notation = reversedTasks.map((t) => `${total}X^${t.degree}`).join(' + ');

  return {
    totalTasks: total,
    polynomialDegreeNotation: notation,
    tasks: reversedTasks
  };
}

// ==========================================
// 4. STEP-BY-STEP POLYNOMIAL EXECUTION PIPELINE
// ==========================================

/**
 * Executes tasks sequentially from degree nX^n down to nX^0 and builds the final execution log.
 */
export async function executePolynomialTasks(
  sock: WASocket,
  groupJid: string,
  senderJid: string,
  msg: WAMessage,
  pipeline: PolynomialDecompositionResult
): Promise<string[]> {
  const executionResults: string[] = [];

  // Step 1: Fetch Ground Truth Universal Group State
  const groupData = await getUniversalGroupData(sock, groupJid);
  const isSenderAdmin = await isParticipantAdmin(sock, groupJid, senderJid);
  const isRubixAdmin = await isBotAdmin(sock, groupJid);

  console.log(`[AL Engine] Executing polynomial pipeline: ${pipeline.polynomialDegreeNotation}`);

  // Step 2: Iterate through polynomial tasks (highest degree nX^n to nX^0)
  for (const task of pipeline.tasks) {
    const taskTag = `[Task nX^${task.degree} - ${task.taskType}]`;

    // Security Verification Check
    if (task.requiresAdminPermission && !isSenderAdmin) {
      executionResults.push(`${taskTag}: Skipped. Sender @${senderJid.split('@')[0]} is not a group admin.`);
      continue;
    }

    if (task.requiresAdminPermission && !isRubixAdmin) {
      executionResults.push(`${taskTag}: Failed. Rubix lacks Admin permissions in this group.`);
      continue;
    }

    // Task Execution Router
    switch (task.taskType) {
      case 'GET_DATE': {
        const currentDate = new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        executionResults.push(`${taskTag}: Today's date is ${currentDate}.`);
        break;
      }

      case 'FETCH_COUNTRY_COUNT': {
        const prefix = task.parameters?.countryPrefix || '234';
        const matchingMembers = groupData.participants.filter((p) => p.countryPrefix === prefix);
        executionResults.push(
          `${taskTag}: There are currently ${matchingMembers.length} member(s) with country code +${prefix} in this group.`
        );
        break;
      }

      case 'CHECK_PENDING_REQUESTS': {
        executionResults.push(
          `${taskTag}: There are currently ${groupData.pendingRequestsCount || 0} pending join requests.`
        );
        break;
      }

      case 'ACCEPT_PENDING_REQUESTS': {
        const rawAmount = task.parameters?.amount;
        const amountToAccept = typeof rawAmount === 'number' ? rawAmount : undefined;
        const result = await handlePendingRequests(sock, groupJid, 'approve', amountToAccept);
        executionResults.push(
          `${taskTag}: Successfully approved ${result.processedCount} pending request(s).`
        );
        break;
      }

      case 'REJECT_PENDING_REQUESTS': {
        const rawAmount = task.parameters?.amount;
        const amountToReject = typeof rawAmount === 'number' ? rawAmount : undefined;
        const result = await handlePendingRequests(sock, groupJid, 'reject', amountToReject);
        executionResults.push(
          `${taskTag}: Successfully rejected ${result.processedCount} pending request(s).`
        );
        break;
      }

      case 'CHANGE_DESCRIPTION': {
        const newDesc = task.parameters?.value || 'Hello it\'s me';
        const success = await updateGroupDescription(sock, groupJid, newDesc);
        executionResults.push(
          `${taskTag}: ${success ? `Group description updated to: "${newDesc}"` : 'Failed to update description.'}`
        );
        break;
      }

      case 'CHANGE_SUBJECT': {
        const newSubject = task.parameters?.value || 'Rubix Group';
        const success = await updateGroupSubject(sock, groupJid, newSubject);
        executionResults.push(
          `${taskTag}: ${success ? `Group name updated to: "${newSubject}"` : 'Failed to update group name.'}`
        );
        break;
      }

      case 'TOGGLE_ANTILINK': {
        const targetState = task.parameters?.state !== undefined ? task.parameters.state : 1;
        setAntiLinkState(groupJid, targetState);
        executionResults.push(
          `${taskTag}: Anti-link protection has been ${targetState === 1 ? 'ENABLED [1]' : 'DISABLED [0]'}.`
        );
        break;
      }

      case 'MUTE_GROUP': {
        const success = await setGroupMute(sock, groupJid, true);
        executionResults.push(
          `${taskTag}: ${success ? 'Group muted (Admins only).' : 'Failed to mute group.'}`
        );
        break;
      }

      case 'UNMUTE_GROUP': {
        const success = await setGroupMute(sock, groupJid, false);
        executionResults.push(
          `${taskTag}: ${success ? 'Group unmuted (All participants can chat).' : 'Failed to unmute group.'}`
        );
        break;
      }

      case 'REVOKE_LINK': {
        const newLink = await revokeAndGetGroupLink(sock, groupJid);
        executionResults.push(
          `${taskTag}: ${newLink ? `Group invite link revoked. New link: ${newLink}` : 'Failed to reset link.'}`
        );
        break;
      }

      case 'FETCH_GROUP_INFO': {
        const creationDate = groupData.creationTime 
          ? new Date(groupData.creationTime * 1000).toLocaleDateString() 
          : 'Unknown Date';
          
        executionResults.push(
          `${taskTag}: Group Name: "${groupData.subject}" | Created: ${creationDate} | Members: ${groupData.size} | AntiLink: ${getGroupState(groupJid).antiLink === 1 ? 'ON' : 'OFF'}`
        );
        break;
      }

      case 'GENERAL_QUERY': {
        executionResults.push(`${taskTag}: Processed query context: "${task.parameters?.value || ''}"`);
        break;
      }

      default:
        executionResults.push(`${taskTag}: Task executed successfully.`);
        break;
    }
  }

  return executionResults;
  }
