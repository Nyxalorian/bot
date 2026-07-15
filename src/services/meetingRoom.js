import { ChannelType, OverwriteType, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';

const emptyRoomGraceMs = 30_000;
const meetingRoomName = 'reuniao';
const meetingRooms = new Map();

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
        ],
      },
    ],
    reason: `Reuniao criada por ${message.author.tag}`,
  });

  trackMeetingRoom(channel.id, message.guild.id, [message.author.id, invitedMember.id], {
    ownerId: message.author.id,
  });
  scheduleMeetingDeletion(channel, 'ninguem entrou na reuniao em 30 segundos');

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

  await handlePossibleOccupiedRoom(newState.channel);
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

function trackMeetingRoom(channelId, guildId, allowedUserIds, options = {}) {
  meetingRooms.set(channelId, {
    guildId,
    ownerId: options.ownerId ?? null,
    allowedUserIds: new Set(allowedUserIds),
    hasBeenOccupied: Boolean(options.hasBeenOccupied),
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
        meetingRooms.delete(channel.id);
        return;
      }

      if (freshChannel.members?.size > 0) {
        state.hasBeenOccupied = true;
        return;
      }

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
