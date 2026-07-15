import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { logBotTimeout } from './auditLog.js';

const muteDurationMs = 5 * 60 * 1000;
const expectedMessagePattern = /^bom\s+dia\s+zeca\s+e\s+mimo[.!?]*$/;
const offensivePatterns = [
  /\bvai\s+se\s+fud(?:er|e|a)\b/,
  /\bfds\b/,
  /\bvai\s+toma(?:r)?\s+no\s+cu\b/,
  /\btoma(?:r)?\s+no\s+cu\b/,
  /\btnc\b/,
  /\bvtmnc\b/,
];

export async function moderateGoodMorningChannelMessage(message) {
  if (!message.guild || message.channelId !== config.goodMorningChannelId) {
    return false;
  }

  const violation = getGoodMorningModerationViolation(message.content);

  if (!violation) {
    return false;
  }

  await deleteViolationMessage(message);
  await timeoutAuthor(message, violation);
  return true;
}

export function getGoodMorningModerationViolation(content) {
  const normalized = normalizeMessage(content);

  if (!normalized) {
    return 'mensagem vazia/off-topic';
  }

  if (normalized === 'mal') {
    return 'mensagem "Mal"';
  }

  if (offensivePatterns.some((pattern) => pattern.test(normalized))) {
    return 'ofensa';
  }

  if (expectedMessagePattern.test(normalized)) {
    return null;
  }

  return 'off-topic';
}

async function deleteViolationMessage(message) {
  try {
    const botMember = message.guild.members.me ?? await message.guild.members.fetchMe({
      cache: false,
    });
    const channelPermissions = message.channel.permissionsFor(botMember);

    if (!channelPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      console.error(
        'Nao consegui apagar mensagem no canal de bom dia: falta permissao Manage Messages.',
      );
      return;
    }

    await message.delete();
  } catch (error) {
    console.error('Erro ao apagar mensagem automatica no canal de bom dia:', error);
  }
}

async function timeoutAuthor(message, violation) {
  try {
    const botMember = message.guild.members.me ?? await message.guild.members.fetchMe({
      cache: false,
    });

    if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      console.error(
        'Nao consegui mutar no canal de bom dia: falta permissao Moderate Members.',
      );
      return;
    }

    const member = message.member ?? await message.guild.members.fetch({
      user: message.author.id,
      cache: false,
    });

    if (!member.moderatable) {
      console.error(
        `Nao consegui mutar ${message.author.tag} no canal de bom dia: hierarquia/permissao insuficiente.`,
      );
      return;
    }

    await member.timeout(
      muteDurationMs,
      `Canal Bom dia Zeca e Mimo: ${violation}`,
    );

    await logBotTimeout({
      client: message.client,
      member,
      durationMs: muteDurationMs,
      reason: `Canal Bom dia Zeca e Mimo: ${violation}`,
    });

    console.log(
      `Mute de 5 minutos aplicado em ${message.author.tag} no canal de bom dia: ${violation}.`,
    );
  } catch (error) {
    console.error('Erro ao aplicar mute automatico no canal de bom dia:', error);
  }
}

function normalizeMessage(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
