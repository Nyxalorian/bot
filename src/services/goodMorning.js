import { AttachmentBuilder } from 'discord.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { createJsonStateStore } from '../utils/jsonState.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..', '..');
const stateFilePath = path.join(projectRoot, 'data', 'good-morning-state.json');
const imagePath = path.join(projectRoot, 'assets', 'zeca-e-mimo-bom-dia.png');
const sendHour = 6;
const msPerDay = 24 * 60 * 60 * 1000;
const goodMorningMessagePattern = /^Dia\s+(\d+)\s+dando Bom dia Zeca e Mimo$/i;
const stateStore = createJsonStateStore(stateFilePath, normalizeState);

let scheduleStarted = false;
let nextRunTimer = null;
let nextRunAt = null;
let sendingGoodMorning = false;

export function startGoodMorningSchedule(client) {
  if (scheduleStarted) {
    return;
  }

  scheduleStarted = true;
  repairTodaysGoodMorningMessage(client).catch((error) => {
    console.error('Falha ao corrigir mensagem de bom dia de hoje:', error);
  });
  scheduleNextRun(client);
}

export function getGoodMorningScheduleStats() {
  return {
    started: scheduleStarted,
    timerActive: Boolean(nextRunTimer),
    nextRunAt: nextRunAt?.toISOString() ?? null,
    startDate: config.goodMorningStartDate,
    sending: sendingGoodMorning,
  };
}

async function sendGoodMorning(client) {
  sendingGoodMorning = true;

  try {
    const today = getLocalDateKey(new Date(), config.goodMorningTimeZone);
    const state = await readState();

    if (state.lastSentDate === today) {
      console.log(`Bom dia de ${today} ja foi enviado.`);
      return;
    }

    const channel = await fetchGoodMorningChannel(client);
    const count = getNextGoodMorningCount(today, state);
    const attachment = new AttachmentBuilder(imagePath, {
      name: 'zeca-e-mimo-bom-dia.png',
    });

    await channel.send({
      content: getGoodMorningMessageContent(count),
      files: [attachment],
    });

    await writeState({
      count,
      lastSentDate: today,
    });

    console.log(`Bom dia enviado no canal ${config.goodMorningChannelId}: Dia ${count}.`);
  } finally {
    sendingGoodMorning = false;
  }
}

async function repairTodaysGoodMorningMessage(client) {
  const today = getLocalDateKey(new Date(), config.goodMorningTimeZone);
  const expectedCount = getGoodMorningCountForDate(today, config.goodMorningStartDate);

  if (!expectedCount) {
    return;
  }

  const channel = await fetchGoodMorningChannel(client);

  if (typeof channel.messages?.fetch !== 'function') {
    return;
  }

  const message = await findTodaysGoodMorningMessage(channel, client, today);
  const match = message?.content.match(goodMorningMessagePattern);
  const currentCount = Number(match?.[1]) || 0;

  if (!message || currentCount >= expectedCount) {
    return;
  }

  await message.edit({
    content: getGoodMorningMessageContent(expectedCount),
  });

  const state = await readState();
  await writeState({
    count: Math.max(Number(state.count) || 0, expectedCount),
    lastSentDate: today,
  });

  console.log(
    `Mensagem de bom dia ${message.id} corrigida para Dia ${expectedCount}.`,
  );
}

async function findTodaysGoodMorningMessage(channel, client, today) {
  let before = null;

  for (let page = 0; page < 5; page += 1) {
    const fetchOptions = before ? { limit: 100, before } : { limit: 100 };
    const messages = await channel.messages.fetch(fetchOptions);

    if (messages.size === 0) {
      return null;
    }

    const sortedMessages = [...messages.values()].sort((first, second) => {
      return second.createdTimestamp - first.createdTimestamp;
    });
    const message = sortedMessages.find((candidate) => {
      return (
        candidate.author.id === client.user?.id &&
        getLocalDateKey(candidate.createdAt, config.goodMorningTimeZone) === today &&
        goodMorningMessagePattern.test(candidate.content)
      );
    });

    if (message) {
      return message;
    }

    const oldestMessage = sortedMessages.at(-1);
    const oldestDate = getLocalDateKey(oldestMessage.createdAt, config.goodMorningTimeZone);

    if (oldestDate < today) {
      return null;
    }

    before = oldestMessage.id;
  }

  return null;
}

async function fetchGoodMorningChannel(client) {
  const channel = await client.channels.fetch(config.goodMorningChannelId);

  if (!channel?.isTextBased() || typeof channel.send !== 'function') {
    throw new Error(
      `Canal de bom dia invalido ou sem suporte para envio: ${config.goodMorningChannelId}`,
    );
  }

  return channel;
}

function getGoodMorningMessageContent(count) {
  return `Dia ${count} dando Bom dia Zeca e Mimo`;
}

function getNextGoodMorningCount(today, state) {
  const stateCount = Math.max(0, Number(state.count) || 0) + 1;
  const dateCount = getGoodMorningCountForDate(today, config.goodMorningStartDate) || 0;

  return Math.max(stateCount, dateCount);
}

function scheduleNextRun(client) {
  const now = new Date();
  const nextRun = getNextRunDate(now, config.goodMorningTimeZone);
  const waitMs = Math.max(1000, nextRun.getTime() - now.getTime());
  nextRunAt = nextRun;

  console.log(
    `Proximo bom dia agendado para ${formatLocalDateTime(
      nextRun,
      config.goodMorningTimeZone,
    )}.`,
  );

  nextRunTimer = setTimeout(async () => {
    nextRunTimer = null;

    try {
      await sendGoodMorning(client);
    } catch (error) {
      console.error('Falha ao enviar o bom dia automatico:', error);
    } finally {
      scheduleNextRun(client);
    }
  }, waitMs);
  nextRunTimer.unref?.();
}

async function readState() {
  return stateStore.read();
}

async function writeState(state) {
  await stateStore.write(state);
}

function normalizeState(state) {
  return {
    count: Number(state?.count) || 0,
    lastSentDate: state?.lastSentDate || null,
  };
}

function getGoodMorningCountForDate(dateKey, startDateKey) {
  const dateDay = dateKeyToUtcDay(dateKey);
  const startDay = dateKeyToUtcDay(startDateKey);

  if (dateDay === null || startDay === null || dateDay < startDay) {
    return null;
  }

  return dateDay - startDay + 1;
}

function dateKeyToUtcDay(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const date = new Date(utcMs);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return Math.floor(utcMs / msPerDay);
}

function getNextRunDate(now, timeZone) {
  const parts = getLocalDateParts(now, timeZone);
  const isAfterSendTime =
    parts.hour > sendHour ||
    (parts.hour === sendHour && (parts.minute > 0 || parts.second > 0));
  const dayOffset = isAfterSendTime ? 1 : 0;
  const targetDate = normalizeUtcDate({
    year: parts.year,
    month: parts.month,
    day: parts.day + dayOffset,
    hour: sendHour,
    minute: 0,
    second: 0,
  });

  return zonedDateTimeToUtc(targetDate, timeZone);
}

function normalizeUtcDate(parts) {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
  );

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function zonedDateTimeToUtc(parts, timeZone) {
  const targetUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let utcMs = targetUtcMs;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    utcMs = targetUtcMs - offsetMs;
  }

  return new Date(utcMs);
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getLocalDateParts(date, timeZone);
  const asUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtcMs - Math.floor(date.getTime() / 1000) * 1000;
}

function getLocalDateKey(date, timeZone) {
  const parts = getLocalDateParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function getLocalDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function formatLocalDateTime(date, timeZone) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}

function pad(value) {
  return String(value).padStart(2, '0');
}
