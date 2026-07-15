import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonStateStore } from '../utils/jsonState.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..', '..');
const stateFilePath = path.join(projectRoot, 'data', 'hard-bans.json');
const minimumPatternLength = 3;
const stateStore = createJsonStateStore(stateFilePath, normalizeState);

export async function addHardBanPattern(guildId, value, addedBy, sourceUserId = null) {
  const pattern = createPattern(value, addedBy, sourceUserId);
  const state = await readState();
  const guildState = getGuildState(state, guildId);
  const existing = guildState.patterns.find(
    (item) => item.normalized === pattern.normalized,
  );

  if (existing) {
    return { pattern: existing, created: false };
  }

  guildState.patterns.push(pattern);
  await writeState(state);

  return { pattern, created: true };
}

export async function addHardBanPatternsForMember(guildId, member, addedBy) {
  const names = getMemberNames(member);
  const results = [];

  for (const name of names) {
    results.push(
      await addHardBanPattern(guildId, name, addedBy, member.user.id),
    );
  }

  return results;
}

export async function removeHardBanPattern(guildId, value) {
  const normalized = normalizeName(value);
  const state = await readState();
  const guildState = getGuildState(state, guildId);
  const originalLength = guildState.patterns.length;

  guildState.patterns = guildState.patterns.filter(
    (pattern) => pattern.normalized !== normalized,
  );

  if (guildState.patterns.length === originalLength) {
    return false;
  }

  await writeState(state);
  return true;
}

export async function removeHardBanPatternsBySourceUserId(guildId, sourceUserId) {
  const state = await readState();
  const guildState = getGuildState(state, guildId);
  const removedPatterns = guildState.patterns.filter(
    (pattern) => pattern.sourceUserId === sourceUserId,
  );

  if (removedPatterns.length === 0) {
    return [];
  }

  guildState.patterns = guildState.patterns.filter(
    (pattern) => pattern.sourceUserId !== sourceUserId,
  );

  await writeState(state);
  return removedPatterns;
}

export async function listHardBanPatterns(guildId) {
  const state = await readState();
  return getGuildState(state, guildId).patterns;
}

export async function findHardBanMatch(member) {
  const patterns = await listHardBanPatterns(member.guild.id);
  return findMatchingPattern(member, patterns);
}

export async function banMemberByHardBan(member, pattern, reasonPrefix = 'Hardban') {
  if (!member.bannable) {
    throw new Error(`Nao consigo banir ${member.user.tag}. Verifique cargos e permissoes.`);
  }

  await member.ban({
    reason: `${reasonPrefix}: nome contem "${pattern.value}"`,
  });
}

export async function banMatchingMembers(guild, pattern, executorId) {
  const members = await guild.members.fetch();
  const normalizedPattern = normalizeName(pattern.value);
  const banned = [];
  const skipped = [];

  try {
    for (const member of members.values()) {
      if (member.user.bot || member.user.id === executorId) {
        continue;
      }

      if (!memberMatchesPattern(member, normalizedPattern)) {
        continue;
      }

      if (!member.bannable) {
        skipped.push(member.user.tag);
        continue;
      }

      await banMemberByHardBan(member, pattern, 'Hardban manual');
      banned.push(member.user.tag);
    }
  } finally {
    members.clear();
  }

  return { banned, skipped };
}

export function normalizeName(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function createPattern(value, addedBy, sourceUserId) {
  const normalized = normalizeName(value);

  if (normalized.length < minimumPatternLength) {
    throw new Error(`O padrao precisa ter pelo menos ${minimumPatternLength} caracteres.`);
  }

  return {
    value: value.trim(),
    normalized,
    addedBy,
    sourceUserId,
    addedAt: new Date().toISOString(),
  };
}

function findMatchingPattern(member, patterns) {
  return patterns.find((pattern) =>
    pattern.sourceUserId === member.user.id ||
    memberMatchesPattern(member, pattern.normalized),
  );
}

function memberMatchesPattern(member, normalizedPattern) {
  return getMemberNames(member).some((name) =>
    normalizeName(name).includes(normalizedPattern),
  );
}

function getMemberNames(member) {
  return [
    member.user.username,
    member.user.globalName,
    member.nickname,
    member.displayName,
  ]
    .filter(Boolean)
    .map((name) => String(name).trim())
    .filter(Boolean)
    .filter((name, index, names) => names.indexOf(name) === index);
}

async function readState() {
  return stateStore.read();
}

async function writeState(state) {
  await stateStore.write(state);
}

function normalizeState(state) {
  return {
    guilds: state?.guilds && typeof state.guilds === 'object' ? state.guilds : {},
  };
}

function getGuildState(state, guildId) {
  state.guilds[guildId] ??= { patterns: [] };
  state.guilds[guildId].patterns ??= [];

  return state.guilds[guildId];
}
