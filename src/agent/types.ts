// src/agent/types.ts

export type TaskType =
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

export interface TaskParameters {
  countryPrefix?: string;
  amount?: number | 'ALL';
  value?: string;
  targetJids?: string[];
  seconds?: 0 | 86400 | 604800 | 7776000;
  options?: string[];
  state?: 0 | 1;
}

export interface AtomicTask {
  degree: number;
  taskType: TaskType;
  parameters?: TaskParameters;
  requiresAdminPermission: boolean;
}

export interface PolynomialDecompositionResult {
  totalTasks: number;
  polynomialDegreeNotation: string;
  tasks: AtomicTask[];
}
