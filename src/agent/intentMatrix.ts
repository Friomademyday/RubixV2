import { AtomicTask } from './types.js';

// 1. Defined Intent Definition Structure
interface IntentPattern {
  type: AtomicTask['taskType'];
  requiresAdmin: boolean;
  requiredTokens: string[][]; // Array of token groups (Logical AND between groups, OR within a group)
  extractParams?: (text: string, tokens: Set<string>) => AtomicTask['parameters'];
}

// 2. Intent Matrix Dictionary
const INTENT_MATRIX: IntentPattern[] = [
  {
    type: 'GET_DATE',
    requiresAdmin: false,
    requiredTokens: [['date', 'today', 'day']]
  },
  {
    type: 'FETCH_COUNTRY_COUNT',
    requiresAdmin: false,
    requiredTokens: [['nigerian', 'nigerians', '234', 'pakistan', 'pakistanis', '92', 'kenya', 'kenyans', '254']],
    extractParams: (text, tokens) => {
      if (tokens.has('nigerian') || tokens.has('nigerians') || tokens.has('234')) return { countryPrefix: '234' };
      if (tokens.has('pakistan') || tokens.has('pakistanis') || tokens.has('92')) return { countryPrefix: '92' };
      if (tokens.has('kenya') || tokens.has('kenyans') || tokens.has('254')) return { countryPrefix: '254' };
      return {};
    }
  },
  {
    type: 'TOGGLE_ANTILINK',
    requiresAdmin: true,
    requiredTokens: [['antilink', 'anti-link']],
    extractParams: (text, tokens) => ({
      state: tokens.has('off') || tokens.has('disable') || tokens.has('deactivate') ? 0 : 1
    })
  },
  {
    type: 'ACCEPT_PENDING_REQUESTS',
    requiresAdmin: true,
    requiredTokens: [['pending', 'request', 'requests'], ['accept', 'approve']],
    extractParams: (text) => {
      const match = text.match(/\d+/);
      return match ? { amount: parseInt(match[0], 10) } : undefined;
    }
  },
  {
    type: 'REJECT_PENDING_REQUESTS',
    requiresAdmin: true,
    requiredTokens: [['pending', 'request', 'requests'], ['decline', 'reject']],
    extractParams: (text) => {
      const match = text.match(/\d+/);
      return match ? { amount: parseInt(match[0], 10) } : undefined;
    }
  },
  {
    type: 'CHANGE_DESCRIPTION',
    requiresAdmin: true,
    requiredTokens: [['description', 'desc']],
    extractParams: (text) => {
      const match = text.match(/(?:to|as)\s+([^,.]+)/i);
      return { value: match ? match[1].trim() : 'Updated description' };
    }
  },
  {
    type: 'CHANGE_SUBJECT',
    requiresAdmin: true,
    requiredTokens: [['subject', 'rename', 'name'], ['group']],
    extractParams: (text) => {
      const match = text.match(/(?:to|as)\s+([^,.]+)/i);
      return { value: match ? match[1].trim() : 'Updated group name' };
    }
  },
  {
    type: 'MUTE_GROUP',
    requiresAdmin: true,
    requiredTokens: [['mute', 'close'], ['group']]
  },
  {
    type: 'UNMUTE_GROUP',
    requiresAdmin: true,
    requiredTokens: [['unmute', 'open'], ['group']]
  },
  {
    type: 'REVOKE_LINK',
    requiresAdmin: true,
    requiredTokens: [['revoke', 'reset'], ['link']]
  },
  {
    type: 'FETCH_GROUP_INFO',
    requiresAdmin: false,
    requiredTokens: [['info', 'members', 'details', 'about']]
  }
];

/**
 * Tokenizes the input string in a single pass into a lookup Set.
 */
function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9+\s]/g, ' ')
    .split(/\s+/);
  return new Set(words);
}

/**
 * Fast $O(1)$ Matrix Matcher: Matches tokens against the intent matrix.
 */
export function fastMatchIntents(promptText: string): AtomicTask[] {
  const tokenSet = tokenize(promptText);
  const detectedTasks: AtomicTask[] = [];

  for (const intent of INTENT_MATRIX) {
    // Check if EVERY required token group has at least ONE matching token in the prompt
    const matchesAllGroups = intent.requiredTokens.every((tokenGroup) =>
      tokenGroup.some((token) => tokenSet.has(token))
    );

    if (matchesAllGroups) {
      detectedTasks.push({
        degree: 0,
        taskType: intent.type,
        requiresAdminPermission: intent.requiresAdmin,
        parameters: intent.extractParams ? intent.extractParams(promptText, tokenSet) : undefined
      });
    }
  }

  // Fallback to GENERAL_QUERY if no explicit admin or action intents matched
  if (detectedTasks.length === 0) {
    detectedTasks.push({
      degree: 0,
      taskType: 'GENERAL_QUERY',
      requiresAdminPermission: false,
      parameters: { value: promptText }
    });
  }

  // Assign polynomial degrees dynamically based on total detected items
  const total = detectedTasks.length;
  return detectedTasks.map((task, index) => ({
    ...task,
    degree: total - 1 - index
  }));
        }
