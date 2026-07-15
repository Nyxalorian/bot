import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import {
  allowGuardianVoiceDeafen,
  clearGuardianVoiceDeafenAllowance,
  isGuardianUserId,
} from './guardianProtection.js';

const emptyRoomGraceMs = 30_000;
const meetingRoomName = 'reuniao';
const meetingRooms = new Map();
const panelPrefix = 'meeting-panel';
const panelColor = 0x7c3aed;
const successColor = 0x22c55e;
const warningColor = 0xf59e0b;
const dangerColor = 0xef4444;

export async function createMeetingRoom(message, invitedMember) {
  if (!message.guild) {
    throw new Error('Esse comando so funciona dentro de um servidor.');
  }

  if (invitedMember.user.bot) {
    throw new Error('Nao da para chamar bot para reuniao.');
  }

  if (invitedMember.id === message.author.id) {
    throw new Error('Voce precisa marcar outra pessoa para a reuniao.');
  }

  assertCanManageChannels(message);

  const channel = await message.guild.channels.create({
    name: meetingRoomName,
    type: ChannelType.GuildVoice,
    parent: config.meetingCategoryId,
    permissionOverwrites: [
      {
        id: message.guild.id,
        deny: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
        ],
      },
      {
        id: message.author.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ],
      },
      {
        id: invitedMember.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ],
      },
      {
        id: message.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers,
          PermissionFlagsBits.MuteMembers,
          PermissionFlagsBits.DeafenMembers,
        ],
      },
    ],
    reason: `Reuniao criada por ${message.author.tag}`,
  });

  trackMeetingRoom(channel.id, message.guild.id, [message.author.id, invitedMember.id], {
    ownerId: message.author.id,
  });
  scheduleMeetingDeletion(channel, 'ninguem entrou na reuniao em 30 segundos');
  sendMeetingPanel(message.author, channel).catch((error) => {
    console.warn(`Nao consegui enviar painel de reuniao para ${message.author.tag}:`, error);
  });

  return channel;
}

export async function addMemberToMeetingRoom(message, invitedMember) {
  const result = await addMembersToMeetingRoom(message, [invitedMember]);

  return {
    channel: result.channel,
    added: result.addedMembers.includes(invitedMember),
    alreadyAllowed: result.alreadyAllowedMembers.includes(invitedMember),
    skipped: result.skippedMembers.find((skipped) => skipped.member.id === invitedMember.id) ?? null,
  };
}

export async function addMembersToMeetingRoom(message, invitedMembers) {
  if (!message.guild) {
    throw new Error('Esse comando so funciona dentro de um servidor.');
  }

  if (invitedMembers.length === 0) {
    throw new Error('Informe pelo menos uma pessoa para adicionar na reuniao.');
  }

  assertCanManageChannels(message);

  const { channel, state } = await findMeetingRoomForMessage(message);
  assertCanManageMeetingChannel(channel);

  const result = {
    channel,
    addedMembers: [],
    alreadyAllowedMembers: [],
    skippedMembers: [],
  };

  for (const invitedMember of invitedMembers) {
    if (invitedMember.user.bot) {
      result.skippedMembers.push({
        member: invitedMember,
        reason: 'bots nao podem ser adicionados',
      });
      continue;
    }

    if (invitedMember.id === message.author.id) {
      result.skippedMembers.push({
        member: invitedMember,
        reason: 'voce ja tem acesso',
      });
      continue;
    }

    if (state.allowedUserIds.has(invitedMember.id) || hasExplicitMemberAccess(channel, invitedMember.id)) {
      state.allowedUserIds.add(invitedMember.id);
      result.alreadyAllowedMembers.push(invitedMember);
      continue;
    }

    await channel.permissionOverwrites.edit(
      invitedMember.id,
      {
        ViewChannel: true,
        Connect: true,
        Speak: true,
      },
      {
        reason: `Adicionado a reuniao por ${message.author.tag}`,
      },
    );

    state.allowedUserIds.add(invitedMember.id);
    result.addedMembers.push(invitedMember);
  }

  if (result.addedMembers.length > 0 && !state.hasBeenOccupied && channel.members.size === 0) {
    scheduleMeetingDeletion(channel, 'ninguem entrou na reuniao em 30 segundos');
  }

  return result;
}

export async function removeMembersFromMeetingRoom(message, removedMembers) {
  if (!message.guild) {
    throw new Error('Esse comando so funciona dentro de um servidor.');
  }

  if (removedMembers.length === 0) {
    throw new Error('Informe pelo menos uma pessoa para remover da reuniao.');
  }

  assertCanManageChannels(message);

  const { channel, state } = await findMeetingRoomForMessage(message);
  assertCanManageMeetingChannel(channel);

  if (removedMembers.some((member) => channel.members.has(member.id))) {
    assertCanMoveMembersInMeetingChannel(channel);
  }

  const result = {
    channel,
    removedMembers: [],
    disconnectedMembers: [],
    notAllowedMembers: [],
    skippedMembers: [],
  };

  for (const removedMember of removedMembers) {
    if (removedMember.id === message.client.user.id) {
      result.skippedMembers.push({
        member: removedMember,
        reason: 'nao posso remover a mim mesmo da reuniao',
      });
      continue;
    }

    const connectedMember = channel.members.get(removedMember.id);
    const hadExplicitAccess = hasExplicitMemberAccess(channel, removedMember.id);
    const wasAllowed = state.allowedUserIds.has(removedMember.id) || hadExplicitAccess;

    if (!wasAllowed && !connectedMember) {
      result.notAllowedMembers.push(removedMember);
      continue;
    }

    state.allowedUserIds.delete(removedMember.id);

    if (hadExplicitAccess) {
      await channel.permissionOverwrites.delete(
        removedMember.id,
        `Removido da reuniao por ${message.author.tag}`,
      );
    }

    if (connectedMember) {
      await connectedMember.voice.disconnect(`Removido da reuniao por ${message.author.tag}`);
      result.disconnectedMembers.push(removedMember);
    }

    result.removedMembers.push(removedMember);
  }

  return result;
}

export async function handleMeetingVoiceUpdate(oldState, newState) {
  await handlePossibleEmptyRoom(oldState.channel);

  const rejectedUnauthorizedJoin = await rejectUnauthorizedMeetingJoin(newState);

  if (rejectedUnauthorizedJoin) {
    return;
  }

  await handlePausedMeetingJoin(newState);
  await handlePossibleOccupiedRoom(newState.channel);
}

export function isMeetingPanelInteraction(interaction) {
  return (
    typeof interaction.customId === 'string' &&
    interaction.customId.startsWith(`${panelPrefix}:`)
  );
}

export async function handleMeetingPanelInteraction(interaction) {
  const parsed = parsePanelCustomId(interaction.customId);

  if (!parsed) {
    return false;
  }

  const { action, channelId, kind } = parsed;
  const room = await findMeetingRoomByChannelId(interaction.client, channelId);

  if (!room) {
    await replyToInteraction(
      interaction,
      'Essa reuniao nao esta mais ativa.',
      true,
    );
    return true;
  }

  const { channel, state } = room;

  if (!state.ownerId) {
    state.ownerId = interaction.user.id;
    state.allowedUserIds.add(interaction.user.id);
  }

  if (interaction.user.id !== state.ownerId) {
    await replyToInteraction(
      interaction,
      'Apenas quem criou a reuniao pode usar este painel.',
      true,
    );
    return true;
  }

  if (kind === 'modal') {
    await handleMeetingPanelModal(interaction, action, channel, state);
    return true;
  }

  if (action === 'add') {
    await interaction.showModal(createAddPeopleModal(channel.id));
    return true;
  }

  if (kind === 'select') {
    await interaction.deferUpdate();
    await handleMeetingPanelSelect(interaction, action, channel, state);
    return true;
  }

  await interaction.deferUpdate();
  await handleMeetingPanelButton(interaction, action, channel, state);
  return true;
}

export function getMeetingRoomStats() {
  let timers = 0;
  let allowedUsers = 0;

  for (const state of meetingRooms.values()) {
    if (state.deleteTimer) {
      timers += 1;
    }

    allowedUsers += state.allowedUserIds.size;
  }

  return {
    activeRooms: meetingRooms.size,
    deleteTimers: timers,
    allowedUsers,
  };
}

async function sendMeetingPanel(owner, channel) {
  const state = meetingRooms.get(channel.id);

  if (!state) {
    return;
  }

  const dmChannel = await owner.createDM();
  const message = await dmChannel.send(createMeetingPanelPayload(channel, state));

  state.panelChannelId = dmChannel.id;
  state.panelMessageId = message.id;
}

function createMeetingPanelPayload(channel, state, options = {}) {
  const ended = Boolean(options.ended);
  const color = ended ? dangerColor : state.paused ? warningColor : panelColor;
  const participants = getMeetingParticipants(channel);
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(ended ? 'Reuniao encerrada' : 'Painel de Reuniao')
    .setDescription(
      ended
        ? 'A reuniao foi encerrada e a call temporaria foi removida.'
        : 'Controle e gerenciamento da reuniao em andamento.',
    )
    .addFields(
      {
        name: 'Status',
        value: ended ? 'Encerrada' : state.paused ? 'Pausada' : 'Ativa',
        inline: true,
      },
      {
        name: 'Tempo de reuniao',
        value: formatElapsedTime(Date.now() - state.createdAt),
        inline: true,
      },
      {
        name: 'Canal',
        value: `${channel}`,
        inline: true,
      },
      {
        name: `Participantes (${participants.length})`,
        value: formatParticipantList(participants),
        inline: false,
      },
      {
        name: 'Administracao',
        value:
          'Voce e o administrador desta reuniao. Use os controles abaixo para gerenciar a call.',
        inline: false,
      },
    )
    .setFooter({ text: `Reuniao ${channel.id}` })
    .setTimestamp();

  if (ended) {
    return {
      embeds: [embed],
      components: [],
    };
  }

  return {
    embeds: [embed],
    components: createMeetingPanelComponents(channel, state, participants),
  };
}

function createMeetingPanelComponents(channel, state, participants) {
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(createPanelCustomId('button', 'refresh', channel.id))
      .setLabel('Atualizar painel')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(createPanelCustomId('button', state.paused ? 'resume' : 'pause', channel.id))
      .setLabel(state.paused ? 'Retomar reuniao' : 'Pausar reuniao')
      .setStyle(state.paused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(createPanelCustomId('button', 'add', channel.id))
      .setLabel('Adicionar pessoas')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(createPanelCustomId('button', 'end', channel.id))
      .setLabel('Encerrar reuniao')
      .setStyle(ButtonStyle.Danger),
  );

  return [
    controlRow,
    createMemberSelectRow(channel, state, 'mute', 'Mutar participante', participants),
    createMemberSelectRow(channel, state, 'unmute', 'Desmutar participante', participants),
    createMemberSelectRow(channel, state, 'remove', 'Remover da reuniao', participants),
  ];
}

function createMemberSelectRow(channel, state, action, placeholder, participants) {
  const options = createMemberSelectOptions(channel, state, action, participants);
  const hasOptions = options.length > 0;
  const select = new StringSelectMenuBuilder()
    .setCustomId(createPanelCustomId('select', action, channel.id))
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(Math.max(1, Math.min(options.length, 5)))
    .setDisabled(!hasOptions)
    .addOptions(
      hasOptions
        ? options
        : [
            {
              label: 'Nenhum participante disponivel',
              value: 'none',
              description: 'Atualize o painel quando alguem entrar.',
            },
          ],
    );

  return new ActionRowBuilder().addComponents(select);
}

function createMemberSelectOptions(channel, state, action, participants) {
  return participants
    .filter((member) => {
      if (member.id === channel.client.user.id || member.id === state.ownerId) {
        return false;
      }

      if (action === 'unmute') {
        return member.voice.serverMute;
      }

      return true;
    })
    .slice(0, 25)
    .map((member) => ({
      label: truncateOptionText(member.displayName || member.user.username, 100),
      value: member.id,
      description: truncateOptionText(member.user.tag ?? member.id, 100),
    }));
}

async function handleMeetingPanelButton(interaction, action, channel, state) {
  if (action === 'refresh') {
    await updatePanelInteraction(interaction, channel, state);
    return;
  }

  if (action === 'pause') {
    await pauseMeeting(channel, state, interaction.user.tag);
    await updatePanelInteraction(interaction, channel, state);
    return;
  }

  if (action === 'resume') {
    await resumeMeeting(channel, state, interaction.user.tag);
    await updatePanelInteraction(interaction, channel, state);
    return;
  }

  if (action === 'end') {
    await endMeetingFromPanel(interaction, channel, state);
    return;
  }

  await updatePanelInteraction(interaction, channel, state);
}

async function handleMeetingPanelSelect(interaction, action, channel, state) {
  const userIds = interaction.values.filter((value) => value !== 'none');

  if (userIds.length === 0) {
    await updatePanelInteraction(interaction, channel, state);
    return;
  }

  if (action === 'mute') {
    await setMeetingMembersMute(channel, userIds, true, interaction.user.tag);
  }

  if (action === 'unmute') {
    await setMeetingMembersMute(channel, userIds, false, interaction.user.tag);
  }

  if (action === 'remove') {
    await removeMeetingMembersFromPanel(channel, state, userIds, interaction.user.tag);
  }

  await updatePanelInteraction(interaction, channel, state);
}

async function handleMeetingPanelModal(interaction, action, channel, state) {
  if (action !== 'add') {
    await replyToInteraction(interaction, 'Acao de painel desconhecida.', true);
    return;
  }

  const rawTargets = interaction.fields.getTextInputValue('targets');
  const userIds = parseUserIds(rawTargets);

  if (userIds.length === 0) {
    await replyToInteraction(
      interaction,
      'Informe pelo menos uma mencao ou ID valido.',
      true,
    );
    return;
  }

  const result = await addMeetingMembersFromPanel(
    channel,
    state,
    userIds,
    interaction.user.tag,
  );

  await updateStoredPanelMessage(interaction.client, channel, state);
  await replyToInteraction(interaction, formatPanelAddResult(result), true);
}

async function addMeetingMembersFromPanel(channel, state, userIds, actorTag) {
  assertCanManageMeetingChannel(channel);
  const result = {
    added: [],
    alreadyAllowed: [],
    skipped: [],
  };

  for (const userId of userIds) {
    const member = await fetchGuildMemberById(channel.guild, userId).catch(() => null);

    if (!member) {
      result.skipped.push(`${userId}: nao esta no servidor`);
      continue;
    }

    if (member.user.bot) {
      result.skipped.push(`${member.user.tag}: bots nao podem ser adicionados`);
      continue;
    }

    if (state.allowedUserIds.has(member.id) || hasExplicitMemberAccess(channel, member.id)) {
      state.allowedUserIds.add(member.id);
      result.alreadyAllowed.push(member.user.tag);
      continue;
    }

    await channel.permissionOverwrites.edit(
      member.id,
      {
        ViewChannel: true,
        Connect: true,
        Speak: true,
      },
      {
        reason: `Adicionado pelo painel da reuniao por ${actorTag}`,
      },
    );

    state.allowedUserIds.add(member.id);
    result.added.push(member.user.tag);
  }

  return result;
}

async function removeMeetingMembersFromPanel(channel, state, userIds, actorTag) {
  assertCanManageMeetingChannel(channel);
  assertCanMoveMembersInMeetingChannel(channel);

  for (const userId of userIds) {
    if (userId === state.ownerId || userId === channel.client.user.id) {
      continue;
    }

    state.allowedUserIds.delete(userId);
    clearGuardianVoiceDeafenAllowance(channel.guild.id, userId);

    if (hasExplicitMemberAccess(channel, userId)) {
      await channel.permissionOverwrites.delete(
        userId,
        `Removido pelo painel da reuniao por ${actorTag}`,
      );
    }

    const member = channel.members.get(userId);

    if (member) {
      await member.voice.disconnect(`Removido pelo painel da reuniao por ${actorTag}`);
    }
  }
}

async function setMeetingMembersMute(channel, userIds, muted, actorTag) {
  assertCanMuteMembersInMeetingChannel(channel);

  for (const userId of userIds) {
    const member = channel.members.get(userId);

    if (!member || member.id === channel.client.user.id) {
      continue;
    }

    await member.voice.setMute(
      muted,
      `${muted ? 'Mutado' : 'Desmutado'} pelo painel da reuniao por ${actorTag}`,
    );
  }
}

async function pauseMeeting(channel, state, actorTag) {
  assertCanDeafenMembersInMeetingChannel(channel);
  state.paused = true;

  for (const member of channel.members.values()) {
    if (member.user.bot) {
      continue;
    }

    if (!member.voice.serverDeaf) {
      state.pausedDeafenedUserIds.add(member.id);
    }

    if (isGuardianUserId(member.id)) {
      allowGuardianVoiceDeafen(channel.guild.id, member.id, channel.id);
    }

    await member.voice.setDeaf(
      true,
      `Reuniao pausada pelo painel por ${actorTag}`,
    );
  }
}

async function resumeMeeting(channel, state, actorTag) {
  assertCanDeafenMembersInMeetingChannel(channel);
  state.paused = false;

  for (const userId of state.pausedDeafenedUserIds) {
    clearGuardianVoiceDeafenAllowance(channel.guild.id, userId);
    const member = channel.members.get(userId);

    if (!member) {
      continue;
    }

    await member.voice.setDeaf(
      false,
      `Reuniao retomada pelo painel por ${actorTag}`,
    );
  }

  state.pausedDeafenedUserIds.clear();
}

async function endMeetingFromPanel(interaction, channel, state) {
  clearMeetingTimer(state);
  state.paused = false;
  cleanupMeetingPauseState(channel.guild.id, state);
  await interaction.editReply(createMeetingPanelPayload(channel, state, { ended: true }));
  await channel.delete(`Reuniao encerrada pelo painel por ${interaction.user.tag}`);
  meetingRooms.delete(channel.id);
}

async function updatePanelInteraction(interaction, channel, state) {
  await interaction.editReply(createMeetingPanelPayload(channel, state));
}

async function updateStoredPanelMessage(client, channel, state) {
  if (!state.panelChannelId || !state.panelMessageId) {
    return;
  }

  const panelChannel = await client.channels.fetch(state.panelChannelId).catch(() => null);
  const panelMessage = await panelChannel?.messages.fetch(state.panelMessageId).catch(() => null);

  if (!panelMessage) {
    return;
  }

  await panelMessage.edit(createMeetingPanelPayload(channel, state));
}

async function findMeetingRoomByChannelId(client, channelId) {
  let channel = client.channels.cache.get(channelId) ?? null;

  if (!channel) {
    channel = await client.channels.fetch(channelId).catch(() => null);
  }

  if (!channel || !isRecoverableMeetingRoomChannel(channel)) {
    meetingRooms.delete(channelId);
    return null;
  }

  let state = meetingRooms.get(channel.id);

  if (!state) {
    state = recoverMeetingRoom(channel, null);
  }

  return { channel, state };
}

function parsePanelCustomId(customId) {
  const [prefix, kind, action, channelId] = customId.split(':');

  if (
    prefix !== panelPrefix ||
    !['button', 'select', 'modal'].includes(kind) ||
    !action ||
    !channelId
  ) {
    return null;
  }

  return { kind, action, channelId };
}

function createPanelCustomId(kind, action, channelId) {
  return `${panelPrefix}:${kind}:${action}:${channelId}`;
}

function createAddPeopleModal(channelId) {
  const input = new TextInputBuilder()
    .setCustomId('targets')
    .setLabel('IDs ou mencoes para adicionar')
    .setPlaceholder('@usuario 123456789012345678')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  return new ModalBuilder()
    .setCustomId(createPanelCustomId('modal', 'add', channelId))
    .setTitle('Adicionar pessoas')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function getMeetingParticipants(channel) {
  return [...channel.members.values()]
    .filter((member) => !member.user.bot)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function formatParticipantList(participants) {
  if (participants.length === 0) {
    return 'Ninguem entrou na call ainda.';
  }

  const visibleParticipants = participants.slice(0, 12).map((member) => {
    const states = [];

    if (member.voice.serverMute) {
      states.push('mutado');
    }

    if (member.voice.serverDeaf) {
      states.push('deafen');
    }

    return `${member} ${states.length > 0 ? `(${states.join(', ')})` : ''}`;
  });

  if (participants.length > visibleParticipants.length) {
    visibleParticipants.push(`+ ${participants.length - visibleParticipants.length} outros`);
  }

  return visibleParticipants.join('\n');
}

function formatElapsedTime(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

function formatPanelAddResult(result) {
  const parts = [];

  if (result.added.length > 0) {
    parts.push(`Adicionados: ${result.added.join(', ')}`);
  }

  if (result.alreadyAllowed.length > 0) {
    parts.push(`Ja tinham acesso: ${result.alreadyAllowed.join(', ')}`);
  }

  if (result.skipped.length > 0) {
    parts.push(`Ignorados: ${result.skipped.join(', ')}`);
  }

  return parts.join('\n') || 'Nenhuma alteracao feita.';
}

function parseUserIds(value) {
  const ids = [];
  const matches = value.matchAll(/<@!?(\d{15,25})>|(\d{15,25})/g);

  for (const match of matches) {
    ids.push(match[1] ?? match[2]);
  }

  return [...new Set(ids)];
}

async function fetchGuildMemberById(guild, userId) {
  return (
    guild.members.cache.get(userId) ??
    await guild.members.fetch({ user: userId, cache: false })
  );
}

async function replyToInteraction(interaction, content, ephemeral = false) {
  const payload = {
    content,
    ephemeral: Boolean(ephemeral && interaction.guildId),
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}

function truncateOptionText(value, maxLength) {
  const text = String(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function trackMeetingRoom(channelId, guildId, allowedUserIds, options = {}) {
  meetingRooms.set(channelId, {
    guildId,
    ownerId: options.ownerId ?? null,
    allowedUserIds: new Set(allowedUserIds),
    createdAt: options.createdAt ?? Date.now(),
    hasBeenOccupied: Boolean(options.hasBeenOccupied),
    paused: false,
    pausedDeafenedUserIds: new Set(),
    panelChannelId: null,
    panelMessageId: null,
    deleteTimer: null,
  });
}

async function findMeetingRoomForMessage(message) {
  const voiceChannel = message.member.voice.channel;

  if (voiceChannel) {
    const voiceRoom = resolveMeetingRoomFromChannel(voiceChannel, message);

    if (voiceRoom) {
      return voiceRoom;
    }
  }

  const rooms = await findMeetingRoomsForMember(message);

  if (rooms.length === 0) {
    throw new Error('Voce precisa estar em uma reuniao temporaria ativa para adicionar alguem.');
  }

  if (rooms.length > 1) {
    throw new Error('Voce tem mais de uma reuniao ativa. Entre na call que quer editar e tente novamente.');
  }

  return rooms[0];
}

function resolveMeetingRoomFromChannel(channel, message) {
  if (meetingRooms.has(channel.id)) {
    const state = meetingRooms.get(channel.id);

    if (isMemberAllowedInMeeting(channel, state, message.author.id)) {
      return { channel, state };
    }
  }

  if (!isRecoverableMeetingRoomChannel(channel)) {
    return null;
  }

  if (!hasMeetingAccess(channel, message.member)) {
    return null;
  }

  const state = recoverMeetingRoom(channel, message.author.id);
  return { channel, state };
}

async function findMeetingRoomsForMember(message) {
  const trackedRooms = await findTrackedMeetingRoomsForMember(message);

  if (trackedRooms.length > 0) {
    return trackedRooms;
  }

  return findRecoverableMeetingRoomsForMember(message);
}

async function findTrackedMeetingRoomsForMember(message) {
  const rooms = [];

  for (const [channelId, state] of meetingRooms.entries()) {
    if (state.guildId !== message.guild.id || !state.allowedUserIds.has(message.author.id)) {
      continue;
    }

    const channel =
      getCachedChannel(message, channelId) ??
      await message.client.channels.fetch(channelId).catch(() => null);

    if (!channel) {
      clearMeetingTimer(state);
      meetingRooms.delete(channelId);
      continue;
    }

    rooms.push({ channel, state });
  }

  return rooms;
}

function findRecoverableMeetingRoomsForMember(message) {
  const rooms = [];

  for (const channel of message.guild.channels.cache.values()) {
    if (meetingRooms.has(channel.id) || !isRecoverableMeetingRoomChannel(channel)) {
      continue;
    }

    if (!hasMeetingAccess(channel, message.member)) {
      continue;
    }

    rooms.push({
      channel,
      state: recoverMeetingRoom(channel, message.author.id),
    });
  }

  return rooms;
}

function getCachedChannel(message, channelId) {
  return (
    message.guild.channels.cache.get(channelId) ??
    message.client.channels.cache.get(channelId) ??
    null
  );
}

function recoverMeetingRoom(channel, fallbackOwnerId) {
  const allowedUserIds = collectAllowedUserIds(channel);

  if (fallbackOwnerId) {
    allowedUserIds.add(fallbackOwnerId);
  }

  trackMeetingRoom(channel.id, channel.guild.id, allowedUserIds, {
    ownerId: fallbackOwnerId,
    hasBeenOccupied: channel.members.size > 0,
  });

  return meetingRooms.get(channel.id);
}

async function handlePossibleOccupiedRoom(channel) {
  if (!channel || !meetingRooms.has(channel.id)) {
    return;
  }

  const state = meetingRooms.get(channel.id);

  if (channel.members.size === 0) {
    return;
  }

  state.hasBeenOccupied = true;
  clearMeetingTimer(state);
}

async function handlePausedMeetingJoin(voiceState) {
  const channel = voiceState.channel;

  if (!channel || !meetingRooms.has(channel.id)) {
    return;
  }

  const state = meetingRooms.get(channel.id);

  if (!state.paused || voiceState.member?.user.bot || voiceState.serverDeaf) {
    return;
  }

  try {
    assertCanDeafenMembersInMeetingChannel(channel);

    if (isGuardianUserId(voiceState.id)) {
      allowGuardianVoiceDeafen(channel.guild.id, voiceState.id, channel.id);
    }

    state.pausedDeafenedUserIds.add(voiceState.id);
    await voiceState.setDeaf(true, 'Entrou em reuniao pausada');
  } catch (error) {
    console.error(`Falha ao aplicar deafen em ${voiceState.id} na reuniao pausada:`, error);
  }
}

async function rejectUnauthorizedMeetingJoin(voiceState) {
  const channel = voiceState.channel;

  if (!channel || voiceState.id === channel.client.user.id) {
    return false;
  }

  const state = getOrRecoverMeetingRoom(channel);

  if (!state || isMemberAllowedInMeeting(channel, state, voiceState.id)) {
    return false;
  }

  const member = voiceState.member;

  if (!member) {
    return false;
  }

  const botMember = channel.guild.members.me;
  const permissions = botMember ? channel.permissionsFor(botMember) : null;

  if (!permissions?.has(PermissionFlagsBits.MoveMembers)) {
    console.warn(
      `Nao consegui remover ${member.user.tag} da reuniao ${channel.id}: falta permissao Move Members.`,
    );
    return true;
  }

  try {
    await voiceState.disconnect('Entrou em reuniao temporaria sem convite');
    console.log(
      `Membro ${member.user.tag} removido da reuniao ${channel.id}: sem convite pelo !addreuniao.`,
    );
  } catch (error) {
    console.error(`Falha ao remover ${member.user.tag} da reuniao ${channel.id}:`, error);
  }

  return true;
}

async function handlePossibleEmptyRoom(channel) {
  if (!channel || !meetingRooms.has(channel.id)) {
    return;
  }

  const state = meetingRooms.get(channel.id);

  if (!state.hasBeenOccupied || channel.members.size > 0) {
    return;
  }

  scheduleMeetingDeletion(channel, 'a reuniao ficou vazia por 30 segundos');
}

function scheduleMeetingDeletion(channel, reason) {
  const state = meetingRooms.get(channel.id);

  if (!state) {
    return;
  }

  clearMeetingTimer(state);
  state.deleteTimer = setTimeout(async () => {
    try {
      state.deleteTimer = null;
      const freshChannel =
        channel.guild.channels.cache.get(channel.id) ??
        channel.client.channels.cache.get(channel.id) ??
        await channel.client.channels.fetch(channel.id).catch(() => null);

      if (!freshChannel) {
        cleanupMeetingPauseState(channel.guild.id, state);
        meetingRooms.delete(channel.id);
        return;
      }

      if (freshChannel.members?.size > 0) {
        state.hasBeenOccupied = true;
        return;
      }

      cleanupMeetingPauseState(channel.guild.id, state);
      await freshChannel.delete(reason);
      meetingRooms.delete(channel.id);
      console.log(`Call temporaria ${channel.id} deletada: ${reason}.`);
    } catch (error) {
      console.error(`Falha ao deletar call temporaria ${channel.id}:`, error);
    }
  }, emptyRoomGraceMs);
}

function clearMeetingTimer(state) {
  if (state.deleteTimer) {
    clearTimeout(state.deleteTimer);
    state.deleteTimer = null;
  }
}

function cleanupMeetingPauseState(guildId, state) {
  for (const userId of state.pausedDeafenedUserIds) {
    clearGuardianVoiceDeafenAllowance(guildId, userId);
  }

  state.pausedDeafenedUserIds.clear();
}

function assertCanManageChannels(message) {
  const botMember = message.guild.members.me;

  if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('Eu preciso da permissao de gerenciar canais para criar a reuniao.');
  }
}

function assertCanManageMeetingChannel(channel) {
  const botMember = channel.guild.members.me;
  const permissions = botMember ? channel.permissionsFor(botMember) : null;

  if (!permissions?.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('Eu preciso conseguir gerenciar essa call para adicionar pessoas.');
  }
}

function assertCanMoveMembersInMeetingChannel(channel) {
  const botMember = channel.guild.members.me;
  const permissions = botMember ? channel.permissionsFor(botMember) : null;

  if (!permissions?.has(PermissionFlagsBits.MoveMembers)) {
    throw new Error('Eu preciso conseguir mover membros nessa call para remover quem esta dentro.');
  }
}

function assertCanMuteMembersInMeetingChannel(channel) {
  const botMember = channel.guild.members.me;
  const permissions = botMember ? channel.permissionsFor(botMember) : null;

  if (!permissions?.has(PermissionFlagsBits.MuteMembers)) {
    throw new Error('Eu preciso conseguir mutar membros nessa call.');
  }
}

function assertCanDeafenMembersInMeetingChannel(channel) {
  const botMember = channel.guild.members.me;
  const permissions = botMember ? channel.permissionsFor(botMember) : null;

  if (!permissions?.has(PermissionFlagsBits.DeafenMembers)) {
    throw new Error('Eu preciso conseguir aplicar deafen nessa call.');
  }
}

function isRecoverableMeetingRoomChannel(channel) {
  if (
    !channel ||
    channel.type !== ChannelType.GuildVoice ||
    channel.parentId !== config.meetingCategoryId ||
    channel.name.toLowerCase() !== meetingRoomName
  ) {
    return false;
  }

  const everyoneOverwrite = channel.permissionOverwrites.cache.get(channel.guild.id);

  return Boolean(
    everyoneOverwrite?.deny.has(PermissionFlagsBits.ViewChannel) &&
    everyoneOverwrite.deny.has(PermissionFlagsBits.Connect),
  );
}

function hasMeetingAccess(channel, member) {
  return hasExplicitMemberAccess(channel, member.id);
}

function getOrRecoverMeetingRoom(channel) {
  if (meetingRooms.has(channel.id)) {
    return meetingRooms.get(channel.id);
  }

  if (!isRecoverableMeetingRoomChannel(channel)) {
    return null;
  }

  return recoverMeetingRoom(channel, null);
}

function isMemberAllowedInMeeting(channel, state, memberId) {
  if (state.allowedUserIds.has(memberId) || hasExplicitMemberAccess(channel, memberId)) {
    state.allowedUserIds.add(memberId);
    return true;
  }

  return false;
}

function hasExplicitMemberAccess(channel, memberId) {
  const overwrite = channel.permissionOverwrites.cache.get(memberId);

  return Boolean(
    overwrite?.type === OverwriteType.Member &&
    overwrite.allow.has(PermissionFlagsBits.ViewChannel) &&
    overwrite.allow.has(PermissionFlagsBits.Connect),
  );
}

function collectAllowedUserIds(channel) {
  const userIds = new Set();

  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (
      overwrite.type === OverwriteType.Member &&
      overwrite.id !== channel.client.user.id &&
      overwrite.allow.has(PermissionFlagsBits.ViewChannel) &&
      overwrite.allow.has(PermissionFlagsBits.Connect)
    ) {
      userIds.add(overwrite.id);
    }
  }

  return userIds;
}
