import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import { config } from '../config.js';

const reconnectDelayMs = 2_000;
const healthCheckIntervalMs = 30_000;
const readyTimeoutMs = 30_000;
const transientDisconnectTimeoutMs = 8_000;
const handledConnections = new WeakSet();

const state = {
  client: null,
  healthTimer: null,
  reconnectTimer: null,
  joining: null,
  activeConnection: null,
  lastWarningByKey: new Map(),
};

export function startPersistentVoicePresence(client) {
  if (!config.alwaysOnVoiceChannelId) {
    return;
  }

  state.client = client;

  if (!state.healthTimer) {
    state.healthTimer = setInterval(() => {
      ensurePersistentVoiceConnection('checagem periodica').catch((error) => {
        warnEvery(
          'health-check',
          'Falha na checagem da call fixa:',
          error,
        );
      });
    }, healthCheckIntervalMs);
    state.healthTimer.unref?.();
  }

  ensurePersistentVoiceConnection('inicializacao').catch((error) => {
    warnEvery('startup', 'Falha ao entrar na call fixa ao iniciar:', error);
  });
}

export function handlePersistentVoicePresenceUpdate(oldState, newState) {
  if (
    !state.client ||
    !config.alwaysOnVoiceChannelId ||
    newState.id !== state.client.user?.id
  ) {
    return;
  }

  if (newState.channelId === config.alwaysOnVoiceChannelId) {
    return;
  }

  const previousChannelId = oldState.channelId ?? 'nenhuma call';
  const nextChannelId = newState.channelId ?? 'nenhuma call';

  scheduleReconnect(
    `bot saiu da call fixa (${previousChannelId} -> ${nextChannelId})`,
  );
}

async function ensurePersistentVoiceConnection(reason) {
  if (state.joining) {
    return state.joining;
  }

  state.joining = connectToPersistentVoiceChannel(reason).finally(() => {
    state.joining = null;
  });

  return state.joining;
}

async function connectToPersistentVoiceChannel(reason) {
  clearReconnectTimer();

  if (!state.client?.isReady()) {
    return;
  }

  const channel = await fetchConfiguredVoiceChannel(state.client);

  if (!channel) {
    warnEvery(
      'missing-channel',
      `Nao encontrei a call fixa ${config.alwaysOnVoiceChannelId}.`,
    );
    scheduleReconnect('call fixa nao encontrada');
    return;
  }

  const botMember =
    channel.guild.members.me ??
    await channel.guild.members.fetchMe().catch(() => null);
  const permissions = botMember ? channel.permissionsFor(botMember) : null;

  if (!permissions?.has(PermissionFlagsBits.Connect)) {
    warnEvery(
      'missing-connect-permission',
      `Nao consigo entrar na call fixa ${channel.name} (${channel.id}): falta permissao Connect.`,
    );
    scheduleReconnect('sem permissao de entrar na call fixa');
    return;
  }

  const currentConnection = getVoiceConnection(channel.guild.id);
  const currentBotVoiceChannelId =
    botMember?.voice.channelId ??
    channel.guild.voiceStates.cache.get(state.client.user.id)?.channelId ??
    null;

  if (
    currentConnection &&
    currentConnection.joinConfig.channelId === channel.id &&
    currentBotVoiceChannelId === channel.id &&
    currentConnection.state.status === VoiceConnectionStatus.Ready
  ) {
    attachConnectionHandlers(currentConnection);
    return;
  }

  if (
    currentConnection &&
    currentConnection.state.status !== VoiceConnectionStatus.Destroyed
  ) {
    currentConnection.destroy();
  }

  console.log(
    `Entrando na call fixa ${channel.name} (${channel.id}) por ${reason}.`,
  );

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  state.activeConnection = connection;
  attachConnectionHandlers(connection);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, readyTimeoutMs);
    clearReconnectTimer();
    console.log(`Zeca e Mimo conectado na call fixa ${channel.name} (${channel.id}).`);
  } catch (error) {
    destroyConnection(connection);
    scheduleReconnect('conexao nao ficou pronta');
    throw error;
  }
}

async function fetchConfiguredVoiceChannel(client) {
  const channel =
    client.channels.cache.get(config.alwaysOnVoiceChannelId) ??
    await client.channels.fetch(config.alwaysOnVoiceChannelId).catch(() => null);

  if (
    channel?.type === ChannelType.GuildVoice ||
    channel?.type === ChannelType.GuildStageVoice
  ) {
    return channel;
  }

  return null;
}

function attachConnectionHandlers(connection) {
  if (handledConnections.has(connection)) {
    return;
  }

  handledConnections.add(connection);

  connection.on(VoiceConnectionStatus.Ready, () => {
    if (connection === state.activeConnection) {
      clearReconnectTimer();
    }
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    if (connection !== state.activeConnection) {
      return;
    }

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Ready, transientDisconnectTimeoutMs),
        entersState(connection, VoiceConnectionStatus.Destroyed, transientDisconnectTimeoutMs),
      ]);

      if (connection.state.status !== VoiceConnectionStatus.Ready) {
        scheduleReconnect('conexao de voz encerrada durante a recuperacao');
      }
    } catch {
      destroyConnection(connection);
      scheduleReconnect('conexao de voz desconectada');
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    if (connection !== state.activeConnection) {
      return;
    }

    state.activeConnection = null;
    scheduleReconnect('conexao de voz encerrada');
  });

  connection.on('error', (error) => {
    warnEvery('voice-connection-error', 'Erro na conexao da call fixa:', error);
  });
}

function destroyConnection(connection) {
  if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
    connection.destroy();
  }
}
function scheduleReconnect(reason) {
  if (!state.client?.isReady() || state.reconnectTimer) {
    return;
  }

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    ensurePersistentVoiceConnection(reason).catch((error) => {
      warnEvery('reconnect', 'Falha ao reconectar na call fixa:', error);
    });
  }, reconnectDelayMs);
  state.reconnectTimer.unref?.();
}

function clearReconnectTimer() {
  if (!state.reconnectTimer) {
    return;
  }

  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
}

function warnEvery(key, message, error = null) {
  const now = Date.now();
  const lastWarningAt = state.lastWarningByKey.get(key) ?? 0;

  if (now - lastWarningAt < healthCheckIntervalMs) {
    return;
  }

  state.lastWarningByKey.set(key, now);

  if (error) {
    console.warn(message, error);
    return;
  }

  console.warn(message);
}
