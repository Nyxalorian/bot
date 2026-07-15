import { getGoodMorningScheduleStats } from './goodMorning.js';
import { getMeetingRoomStats } from './meetingRoom.js';
import { getMessiEveningScheduleStats } from './messiEvening.js';

const defaultIntervalMs = 60_000;
const minimumIntervalMs = 10_000;

let diagnosticsTimer = null;

export function startMemoryDiagnostics(client) {
  if (!isMemoryDebugEnabled() || diagnosticsTimer) {
    return;
  }

  const intervalMs = getDiagnosticsIntervalMs();

  logMemoryDiagnostics(client, 'startup');
  diagnosticsTimer = setInterval(() => {
    logMemoryDiagnostics(client, 'interval');
  }, intervalMs);
  diagnosticsTimer.unref?.();
}

export function getMemoryDiagnosticsStats() {
  return {
    enabled: isMemoryDebugEnabled(),
    timerActive: Boolean(diagnosticsTimer),
  };
}

function logMemoryDiagnostics(client, phase) {
  const memory = process.memoryUsage();

  console.log('[memory-debug]', JSON.stringify({
    phase,
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssMb: toMb(memory.rss),
      heapUsedMb: toMb(memory.heapUsed),
      heapTotalMb: toMb(memory.heapTotal),
      externalMb: toMb(memory.external),
      arrayBuffersMb: toMb(memory.arrayBuffers),
    },
    discord: getDiscordCacheStats(client),
    listeners: getListenerStats(client),
    customState: {
      commands: client.commands?.size ?? 0,
      collectors: 0,
      dbConnections: 0,
      goodMorning: getGoodMorningScheduleStats(),
      messiEvening: getMessiEveningScheduleStats(),
      meetingRooms: getMeetingRoomStats(),
      diagnostics: getMemoryDiagnosticsStats(),
    },
  }));
}

function getDiscordCacheStats(client) {
  let members = 0;
  let roles = 0;
  let emojis = 0;
  let stickers = 0;
  let voiceStates = 0;

  for (const guild of client.guilds.cache.values()) {
    members += guild.members.cache.size;
    roles += guild.roles.cache.size;
    emojis += guild.emojis.cache.size;
    stickers += guild.stickers.cache.size;
    voiceStates += guild.voiceStates.cache.size;
  }

  return {
    guilds: client.guilds.cache.size,
    users: client.users.cache.size,
    channels: client.channels.cache.size,
    messages: countMessageCache(client),
    members,
    roles,
    emojis,
    stickers,
    voiceStates,
  };
}

function countMessageCache(client) {
  let messages = 0;

  for (const channel of client.channels.cache.values()) {
    if (channel.messages?.cache) {
      messages += channel.messages.cache.size;
    }
  }

  return messages;
}

function getListenerStats(client) {
  return Object.fromEntries(
    client.eventNames().map((eventName) => [
      String(eventName),
      client.listenerCount(eventName),
    ]),
  );
}

function isMemoryDebugEnabled() {
  return process.env.MEMORY_DEBUG?.trim().toLowerCase() === 'true';
}

function getDiagnosticsIntervalMs() {
  const parsed = Number(process.env.MEMORY_DEBUG_INTERVAL_MS);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultIntervalMs;
  }

  return Math.max(minimumIntervalMs, parsed);
}

function toMb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}
