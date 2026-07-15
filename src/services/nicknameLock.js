import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonStateStore } from '../utils/jsonState.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..', '..');
const stateFilePath = path.join(projectRoot, 'data', 'nickname-locks.json');
const stateStore = createJsonStateStore(stateFilePath, normalizeState);

export async function lockMemberNickname(member, lockedBy) {
  const state = await readState();
  const guildState = getGuildState(state, member.guild.id);

  guildState.locks[member.id] = {
    userId: member.id,
    nickname: member.nickname,
    lockedBy,
    lockedAt: new Date().toISOString(),
  };

  await writeState(state);
  return guildState.locks[member.id];
}

export async function unlockMemberNickname(guildId, userId) {
  const state = await readState();
  const guildState = getGuildState(state, guildId);
  const lock = guildState.locks[userId] || null;

  if (!lock) {
    return null;
  }

  delete guildState.locks[userId];
  await writeState(state);
  return lock;
}

export async function enforceNicknameLock(member) {
  const lock = await getNicknameLock(member.guild.id, member.id);

  if (!lock || member.nickname === lock.nickname) {
    return false;
  }

  if (!member.manageable) {
    throw new Error(`Nao consigo alterar o apelido de ${member.user.tag}.`);
  }

  await member.setNickname(lock.nickname, 'Unname: apelido travado');
  return true;
}

async function getNicknameLock(guildId, userId) {
  const state = await readState();
  return getGuildState(state, guildId).locks[userId] || null;
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
  state.guilds[guildId] ??= { locks: {} };
  state.guilds[guildId].locks ??= {};

  return state.guilds[guildId];
}
