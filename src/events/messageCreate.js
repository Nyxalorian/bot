import { AttachmentBuilder, Events, PermissionFlagsBits } from 'discord.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { moderateGoodMorningChannelMessage } from '../services/goodMorningModeration.js';
import {
  addMembersToMeetingRoom,
  createMeetingRoom,
  removeMembersFromMeetingRoom,
} from '../services/meetingRoom.js';
import {
  forwardAnonymousDmReply,
  registerAnonymousDmRoute,
} from '../services/anonymousDm.js';
import {
  lockMemberNickname,
  unlockMemberNickname,
} from '../services/nicknameLock.js';
import {
  consumeMessageCooldown,
  formatCooldownDuration,
  parseCooldownDuration,
  removeMessageCooldown,
  setMessageCooldown,
} from '../services/messageCooldown.js';
import {
  assertBotPermission,
  hasRole,
  isTextCommand,
  parseUserId,
} from '../utils/discord.js';
import {
  createEmbed,
  errorEmbed,
  infoEmbed,
  replyWithEmbed,
  successEmbed,
  warningEmbed,
} from '../utils/embeds.js';

export const name = Events.MessageCreate;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..', '..');
const rgCards = new Map([
  [
    '!rg zeca',
    {
      filePath: path.join(projectRoot, 'assets', 'rg-zeca.png'),
      fileName: 'rg-zeca.png',
      title: 'RG do Zeca',
    },
  ],
  [
    '!rg mimo',
    {
      filePath: path.join(projectRoot, 'assets', 'rg-mimo.png'),
      fileName: 'rg-mimo.png',
      title: 'RG do Mimo',
    },
  ],
]);

export async function execute(message) {
  if (message.author.bot) {
    return;
  }

  if (!message.guild) {
    if (isBlacklistedUser(message.author.id)) {
      return;
    }

    try {
      await forwardAnonymousDmReply(message);
    } catch (error) {
      console.error('Erro ao encaminhar resposta de DM anonima:', error);
      await replyError(message, 'Resposta anonima', 'Nao consegui encaminhar sua resposta.');
    }

    return;
  }

  const content = message.content.trim();
  const lowerContent = content.toLowerCase();

  if (await moderateGoodMorningChannelMessage(message)) {
    return;
  }

  if (await deleteIfMessageCooldownBlocked(message, lowerContent)) {
    return;
  }

  if (isBlacklistedUser(message.author.id) && isBotTextCommand(lowerContent)) {
    return;
  }

  const rgCard = rgCards.get(lowerContent);

  if (rgCard) {
    await sendRgCard(message, rgCard);
    return;
  }

  if (isTextCommand(lowerContent, '!dm')) {
    await handleDmCommand(message, content);
    return;
  }

  if (isTextCommand(lowerContent, '!reuniao')) {
    await handleMeetingCommand(message, content);
    return;
  }

  if (isTextCommand(lowerContent, '!addreuniao')) {
    await handleAddMeetingCommand(message, content);
    return;
  }

  if (isTextCommand(lowerContent, '!removereuniao')) {
    await handleRemoveMeetingCommand(message, content);
    return;
  }

  if (
    isTextCommand(lowerContent, '!add') ||
    isTextCommand(lowerContent, '!remove')
  ) {
    await handleSpecialRoleCommand(message, content);
    return;
  }

  if (
    isTextCommand(lowerContent, '!unname') ||
    isTextCommand(lowerContent, '!allowname')
  ) {
    await handleNicknameLockCommand(message, content);
    return;
  }

  if (
    isTextCommand(lowerContent, '!message') ||
    isTextCommand(lowerContent, '!unmessage')
  ) {
    await handleMessageCooldownCommand(message, content);
  }
}

async function sendRgCard(message, rgCard) {
  const attachment = new AttachmentBuilder(rgCard.filePath, {
    name: rgCard.fileName,
  });

  await message.channel.send({
    embeds: [
      createEmbed({
        title: rgCard.title,
        description: 'Documento solicitado.',
        image: `attachment://${rgCard.fileName}`,
        color: 'neutral',
      }),
    ],
    files: [attachment],
  });
}

function isBlacklistedUser(userId) {
  return config.blacklistedUserIds.includes(userId);
}

function isBotTextCommand(lowerContent) {
  return (
    rgCards.has(lowerContent) ||
    isTextCommand(lowerContent, '!dm') ||
    isTextCommand(lowerContent, '!reuniao') ||
    isTextCommand(lowerContent, '!addreuniao') ||
    isTextCommand(lowerContent, '!removereuniao') ||
    isTextCommand(lowerContent, '!add') ||
    isTextCommand(lowerContent, '!remove') ||
    isTextCommand(lowerContent, '!unname') ||
    isTextCommand(lowerContent, '!allowname') ||
    isTextCommand(lowerContent, '!message') ||
    isTextCommand(lowerContent, '!unmessage')
  );
}

async function handleMeetingCommand(message, content) {
  if (!message.guild) {
    await replyError(message, 'Reuniao', 'Esse comando so funciona dentro de um servidor.');
    return;
  }

  const [, target] = content.split(/\s+/);
  const mentionId = parseUserId(target);

  if (!mentionId) {
    await replyInfo(message, 'Como usar', 'Use `!reuniao @usuario` ou `!reuniao id`.');
    return;
  }

  try {
    const invitedMember = await fetchGuildMember(message, mentionId);
    const channel = await createMeetingRoom(message, invitedMember);

    await replySuccess(
      message,
      'Reuniao criada',
      `${channel} esta pronta. Se ninguem entrar em 30 segundos, ela sera apagada.`,
    );
  } catch (error) {
    console.error('Erro ao criar reuniao temporaria:', error);
    await replyError(message, 'Reuniao', `Nao consegui criar a reuniao: ${error.message}`);
  }
}

async function handleAddMeetingCommand(message, content) {
  if (!message.guild) {
    await replyError(message, 'Reuniao', 'Esse comando so funciona dentro de um servidor.');
    return;
  }

  const [, ...targets] = content.split(/\s+/);

  if (targets.length === 0) {
    await replyInfo(message, 'Como usar', 'Use `!addreuniao @usuario` ou `!addreuniao id`. Voce pode passar mais de uma pessoa.');
    return;
  }

  const { invalidTarget, userIds } = parseUserTargets(targets);

  if (invalidTarget) {
    await replyWarning(message, 'Usuario invalido', `Nao reconheci "${invalidTarget.raw}". Use mencoes ou IDs validos.`);
    return;
  }

  try {
    const invitedMembers = await fetchGuildMembers(message, userIds);
    const result = await addMembersToMeetingRoom(message, invitedMembers);

    await replyAddMeetingResult(message, result);
  } catch (error) {
    console.error('Erro ao adicionar pessoa na reuniao:', error);
    await replyError(message, 'Reuniao', `Nao consegui adicionar na reuniao: ${error.message}`);
  }
}

async function handleRemoveMeetingCommand(message, content) {
  if (!message.guild) {
    await replyError(message, 'Reuniao', 'Esse comando so funciona dentro de um servidor.');
    return;
  }

  const [, ...targets] = content.split(/\s+/);

  if (targets.length === 0) {
    await replyInfo(message, 'Como usar', 'Use `!removereuniao @usuario` ou `!removereuniao id`. Voce pode passar mais de uma pessoa.');
    return;
  }

  const { invalidTarget, userIds } = parseUserTargets(targets);

  if (invalidTarget) {
    await replyWarning(message, 'Usuario invalido', `Nao reconheci "${invalidTarget.raw}". Use mencoes ou IDs validos.`);
    return;
  }

  try {
    const removedMembers = await fetchGuildMembers(message, userIds);
    const result = await removeMembersFromMeetingRoom(message, removedMembers);

    await replyRemoveMeetingResult(message, result);
  } catch (error) {
    console.error('Erro ao remover pessoa da reuniao:', error);
    await replyError(message, 'Reuniao', `Nao consegui remover da reuniao: ${error.message}`);
  }
}

function parseUserTargets(targets) {
  const parsedTargets = targets.map((target) => ({
    raw: target,
    userId: parseUserId(cleanCommandArg(target)),
  }));

  return {
    invalidTarget: parsedTargets.find((target) => !target.userId) ?? null,
    userIds: [...new Set(parsedTargets.map((target) => target.userId).filter(Boolean))],
  };
}

async function fetchGuildMembers(message, userIds) {
  return Promise.all(userIds.map(async (userId) => {
    try {
      return await fetchGuildMember(message, userId);
    } catch {
      throw new Error(`Nao encontrei o usuario ${userId} neste servidor.`);
    }
  }));
}

async function fetchGuildMember(message, userId) {
  const cachedMember =
    message.mentions.members?.get(userId) ??
    message.guild.members.cache.get(userId);

  if (cachedMember) {
    return cachedMember;
  }

  return message.guild.members.fetch({
    user: userId,
    cache: false,
  });
}

async function replyAddMeetingResult(message, result) {
  const fields = [];

  if (result.addedMembers.length > 0) {
    fields.push({
      name: 'Adicionados',
      value: formatMembers(result.addedMembers),
      inline: false,
    });
  }

  if (result.alreadyAllowedMembers.length > 0) {
    fields.push({
      name: 'Ja tinham acesso',
      value: formatMembers(result.alreadyAllowedMembers),
      inline: false,
    });
  }

  if (result.skippedMembers.length > 0) {
    fields.push({
      name: 'Ignorados',
      value: formatSkippedMembers(result.skippedMembers),
      inline: false,
    });
  }

  if (result.addedMembers.length === 0) {
    await replyInfo(
      message,
      'Reuniao sem alteracoes',
      `${result.channel} nao precisou de novas permissoes.`,
      fields,
    );
    return;
  }

  await replySuccess(
    message,
    'Pessoa adicionada',
    `Permissao liberada em ${result.channel}.`,
    fields,
  );
}

async function replyRemoveMeetingResult(message, result) {
  const fields = [];

  if (result.removedMembers.length > 0) {
    fields.push({
      name: 'Removidos',
      value: formatMembers(result.removedMembers),
      inline: false,
    });
  }

  if (result.disconnectedMembers.length > 0) {
    fields.push({
      name: 'Desconectados da call',
      value: formatMembers(result.disconnectedMembers),
      inline: false,
    });
  }

  if (result.notAllowedMembers.length > 0) {
    fields.push({
      name: 'Sem acesso nessa reuniao',
      value: formatMembers(result.notAllowedMembers),
      inline: false,
    });
  }

  if (result.skippedMembers.length > 0) {
    fields.push({
      name: 'Ignorados',
      value: formatSkippedMembers(result.skippedMembers),
      inline: false,
    });
  }

  if (result.removedMembers.length === 0) {
    await replyInfo(
      message,
      'Reuniao sem alteracoes',
      `${result.channel} nao precisou remover permissoes.`,
      fields,
    );
    return;
  }

  await replySuccess(
    message,
    'Pessoa removida',
    `Acesso removido em ${result.channel}.`,
    fields,
  );
}

function formatMembers(members) {
  return members.map((member) => `${member}`).join(', ');
}

function formatSkippedMembers(skippedMembers) {
  return skippedMembers
    .map((skipped) => `${skipped.member}: ${skipped.reason}`)
    .join('\n');
}

async function handleSpecialRoleCommand(message, content) {
  if (!message.guild) {
    await replyError(message, 'Cargo especial', 'Esse comando so funciona dentro de um servidor.');
    return;
  }

  if (message.author.id !== config.specialRoleManagerUserId) {
    await replyWarning(message, 'Sem permissao', 'Apenas o guardiao autorizado pode usar esse comando.');
    return;
  }

  const [command, ...args] = content.split(/\s+/);
  const lowerCommand = command.toLowerCase();
  const parsed = await parseSpecialRoleCommand(message, args);

  if (!parsed) {
    await replyInfo(
      message,
      'Como usar',
      'Use `!add @usuario roleId`, `!remove @usuario roleId`, ou responda uma mensagem com `!add roleId`/`!remove roleId`.',
    );
    return;
  }

  try {
    const { member, role } = await fetchSpecialRoleTargets(message, parsed);
    await assertSpecialRoleCanBeManaged(message, role);

    if (lowerCommand === '!remove') {
      await removeSpecialRole(message, member, role);
      return;
    }

    await addSpecialRole(message, member, role);
  } catch (error) {
    console.error('Erro no comando especial de cargo:', error);
    await replyError(message, 'Cargo especial', `Nao consegui executar: ${error.message}`);
  }
}

async function parseSpecialRoleCommand(message, args) {
  const cleanedArgs = args.map(cleanCommandArg).filter(Boolean);

  if (cleanedArgs.length === 1) {
    const roleId = parseRoleId(cleanedArgs[0]);
    const targetUserId = await getReferencedUserId(message);

    return roleId && targetUserId ? { roleId, targetUserId } : null;
  }

  if (cleanedArgs.length < 2) {
    return null;
  }

  const firstUserId = parseUserId(cleanedArgs[0]);
  const secondRoleId = parseRoleId(cleanedArgs[1]);

  if (firstUserId && secondRoleId) {
    return { targetUserId: firstUserId, roleId: secondRoleId };
  }

  const firstRoleId = parseRoleId(cleanedArgs[0]);
  const secondUserId = parseUserId(cleanedArgs[1]);

  if (firstRoleId && secondUserId) {
    return { targetUserId: secondUserId, roleId: firstRoleId };
  }

  return null;
}

async function getReferencedUserId(message) {
  if (!message.reference?.messageId) {
    return null;
  }

  try {
    const referencedMessage = await message.fetchReference();
    return referencedMessage.author?.id || null;
  } catch {
    return null;
  }
}

async function fetchSpecialRoleTargets(message, parsed) {
  const [member, role] = await Promise.all([
    message.guild.members.fetch({
      user: parsed.targetUserId,
      cache: false,
    }),
    message.guild.roles.fetch(parsed.roleId),
  ]);

  if (!role) {
    throw new Error(`Nao encontrei o cargo ${parsed.roleId}.`);
  }

  return { member, role };
}

async function assertSpecialRoleCanBeManaged(message, role) {
  if (role.id === message.guild.id) {
    throw new Error('Nao posso adicionar ou remover o cargo @everyone.');
  }

  if (role.managed) {
    throw new Error(`O cargo ${role.name} e gerenciado por integracao.`);
  }

  const botMember = await assertBotCanManageRoles(message);
  const limitRole =
    message.guild.roles.cache.get(config.specialRoleLimitRoleId) ??
    await message.guild.roles.fetch(config.specialRoleLimitRoleId);

  if (!limitRole) {
    throw new Error(`Nao encontrei o cargo limite ${config.specialRoleLimitRoleId}.`);
  }

  if (role.comparePositionTo(limitRole) >= 0) {
    throw new Error(`O cargo ${role.name} e igual ou acima do cargo limite do bot.`);
  }

  if (botMember.roles.highest.comparePositionTo(role) <= 0) {
    throw new Error(`O cargo do bot precisa ficar acima de ${role.name}.`);
  }
}

async function addSpecialRole(message, member, role) {
  if (member.roles.cache.has(role.id)) {
    await replyInfo(message, 'Cargo sem alteracao', `${member} ja tem o cargo ${role}.`);
    return;
  }

  await member.roles.add(
    role,
    `Comando especial !add usado por ${message.author.tag}`,
  );
  await replySuccess(message, 'Cargo adicionado', `${role} foi adicionado em ${member}.`);
}

async function removeSpecialRole(message, member, role) {
  if (!member.roles.cache.has(role.id)) {
    await replyInfo(message, 'Cargo sem alteracao', `${member} nao tem o cargo ${role}.`);
    return;
  }

  await member.roles.remove(
    role,
    `Comando especial !remove usado por ${message.author.tag}`,
  );
  await replySuccess(message, 'Cargo removido', `${role} foi removido de ${member}.`);
}

function parseRoleId(value) {
  if (!value) {
    return null;
  }

  const mentionId = value.match(/^<@&(\d+)>$/)?.[1];

  if (mentionId) {
    return mentionId;
  }

  return value.match(/^\d{15,25}$/)?.[0] || null;
}

function cleanCommandArg(value) {
  return value.replace(/[,.]+$/g, '');
}

async function handleDmCommand(message, content) {
  if (!message.guild) {
    await replyError(message, 'DM anonima', 'Esse comando so funciona dentro de um servidor.');
    return;
  }

  if (!hasRole(message.member, config.dmManagerRoleId)) {
    await replyWarning(message, 'Sem permissao', 'Apenas o cargo autorizado pode usar esse comando.');
    return;
  }

  const match = content.match(/^!dm\s+(\S+)\s+(.+)$/i);

  if (!match) {
    await replyInfo(message, 'Como usar', 'Use `!dm @usuario texto` ou `!dm id texto`.');
    return;
  }

  const [, rawTarget, rawText] = match;
  const userId = parseUserId(rawTarget);

  if (!userId) {
    await replyWarning(message, 'Usuario invalido', 'Use uma mencao ou um ID valido.');
    return;
  }

  const parts = rawText.trim().split(/\s+/);

  if (/^\d+$/.test(parts[0])) {
    const requestedCount = Number(parts[0]);

    if (requestedCount > 1) {
      await replyWarning(
        message,
        'Limite de DM',
        'Nao posso enviar varias DMs repetidas. Use `!dm @usuario texto` ou `!dm id texto` para enviar uma unica mensagem.',
      );
      return;
    }

    parts.shift();
  }

  const dmText = parts.join(' ').trim();

  if (!dmText) {
    await replyInfo(message, 'Mensagem vazia', 'Escreva a mensagem depois do usuario ou ID.');
    return;
  }

  if (dmText.length > 1800) {
    await replyWarning(message, 'Mensagem grande demais', 'Use ate 1800 caracteres.');
    return;
  }

  try {
    const user = await message.client.users.fetch(userId);

    if (user.bot) {
      await replyWarning(message, 'DM cancelada', 'Nao vou enviar DM para outro bot.');
      return;
    }

    await user.send({
      embeds: [
        createEmbed({
          title: 'Mensagem anonima',
          description: `${dmText}\n\nResponda esta DM para enviar uma resposta pelo bot.`,
          color: 'neutral',
        }),
      ],
    });
    await registerAnonymousDmRoute({
      recipientId: user.id,
      senderId: message.author.id,
    });
    await replySuccess(message, 'DM enviada', 'A mensagem anonima foi entregue.');
  } catch (error) {
    console.error('Erro ao enviar DM:', error);
    await replyError(message, 'DM anonima', 'Nao consegui enviar a DM. A pessoa pode estar com DMs fechadas.');
  }
}

async function handleNicknameLockCommand(message, content) {
  if (!message.guild) {
    await replyError(message, 'Unname', 'Esse comando so funciona dentro de um servidor.');
    return;
  }

  if (!hasRole(message.member, config.unnameManagerRoleId)) {
    await replyWarning(message, 'Sem permissao', 'Apenas o cargo autorizado pode usar esse comando.');
    return;
  }

  const [command, target] = content.split(/\s+/);
  const userId = parseUserId(target);

  if (!userId) {
    await replyInfo(message, 'Como usar', 'Use `!unname @usuario` ou `!allowname @usuario`.');
    return;
  }

  try {
    if (command.toLowerCase() === '!allowname') {
      const removed = await unlockMemberNickname(message.guild.id, userId);

      if (removed) {
        await replySuccess(message, 'Apelido liberado', 'A pessoa agora pode trocar o proprio apelido novamente.');
        return;
      }

      await replyInfo(message, 'Nada para remover', 'Essa pessoa nao estava com apelido travado.');
      return;
    }

    await assertBotCanManageNicknames(message);
    const member = await message.guild.members.fetch({
      user: userId,
      cache: false,
    });

    if (!member.manageable) {
      await replyWarning(message, 'Hierarquia insuficiente', 'Nao consigo gerenciar o apelido dessa pessoa. Verifique a hierarquia dos cargos.');
      return;
    }

    const lock = await lockMemberNickname(member, message.author.id);
    await replySuccess(
      message,
      'Apelido travado',
      lock.nickname
        ? `Apelido travado como "${lock.nickname}".`
        : 'Apelido travado sem nickname. Se a pessoa colocar um apelido, eu removo.',
    );
  } catch (error) {
    console.error('Erro no comando de unname:', error);
    await replyError(message, 'Unname', `Nao consegui executar: ${error.message}`);
  }
}

async function handleMessageCooldownCommand(message, content) {
  if (!message.guild) {
    await replyError(message, 'Cooldown de mensagens', 'Esse comando so funciona dentro de um servidor.');
    return;
  }

  if (!hasRole(message.member, config.messageCooldownManagerRoleId)) {
    await replyWarning(message, 'Sem permissao', 'Apenas o cargo autorizado pode usar esse comando.');
    return;
  }

  const [command, target, duration] = content.split(/\s+/);
  const userId = parseUserId(target);
  const lowerCommand = command.toLowerCase();

  if (!userId) {
    await replyInfo(message, 'Como usar', 'Use `!message @usuario 30s` ou `!unmessage @usuario`.');
    return;
  }

  try {
    if (lowerCommand === '!unmessage') {
      const removed = await removeMessageCooldown(message.guild.id, userId);

      if (removed) {
        await replySuccess(message, 'Cooldown removido', 'A pessoa pode falar normalmente de novo.');
        return;
      }

      await replyInfo(message, 'Nada para remover', 'Essa pessoa nao tinha cooldown de mensagens.');
      return;
    }

    if (!duration) {
      await replyInfo(message, 'Como usar', 'Use `!message @usuario 30s`.');
      return;
    }

    await assertBotCanManageMessages(message);
    const cooldownMs = parseCooldownDuration(duration);
    await setMessageCooldown(
      message.guild.id,
      userId,
      cooldownMs,
      message.author.id,
    );
    await replySuccess(
      message,
      'Cooldown definido',
      `A pessoa agora pode mandar uma mensagem a cada ${formatCooldownDuration(cooldownMs)}.`,
    );
  } catch (error) {
    console.error('Erro no comando de cooldown de mensagem:', error);
    await replyError(message, 'Cooldown de mensagens', `Nao consegui executar: ${error.message}`);
  }
}

async function assertBotCanManageNicknames(message) {
  await assertBotPermission(
    message,
    PermissionFlagsBits.ManageNicknames,
    'Eu preciso da permissao de gerenciar apelidos para fazer isso.',
  );
}

async function assertBotCanManageMessages(message) {
  await assertBotPermission(
    message,
    PermissionFlagsBits.ManageMessages,
    'Eu preciso da permissao de gerenciar mensagens para fazer isso.',
  );
}

async function assertBotCanManageRoles(message) {
  await assertBotPermission(
    message,
    PermissionFlagsBits.ManageRoles,
    'Eu preciso da permissao de gerenciar cargos para fazer isso.',
  );

  return message.guild.members.me ?? message.guild.members.fetchMe({
    cache: false,
  });
}

async function deleteIfMessageCooldownBlocked(message, lowerContent) {
  const isCooldownManagerCommand =
    isTextCommand(lowerContent, '!message') ||
    isTextCommand(lowerContent, '!unmessage');

  if (isCooldownManagerCommand && hasRole(message.member, config.messageCooldownManagerRoleId)) {
    return false;
  }

  const result = await consumeMessageCooldown(message);

  if (!result.limited) {
    return false;
  }

  try {
    await message.delete();
  } catch (error) {
    console.error('Erro ao apagar mensagem em cooldown:', error);
  }

  return true;
}

async function replySuccess(message, title, description, fields = []) {
  return replyWithEmbed(message, successEmbed(title, description, fields));
}

async function replyError(message, title, description, fields = []) {
  return replyWithEmbed(message, errorEmbed(title, description, fields));
}

async function replyWarning(message, title, description, fields = []) {
  return replyWithEmbed(message, warningEmbed(title, description, fields));
}

async function replyInfo(message, title, description, fields = []) {
  return replyWithEmbed(message, infoEmbed(title, description, fields));
}
