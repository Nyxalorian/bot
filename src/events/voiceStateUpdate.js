import { Events } from 'discord.js';
import { logVoiceChannelChange } from '../services/auditLog.js';
import {
  disconnectGuardianVoiceKickExecutor,
  findGuardianVoiceDisconnectAuditEntry,
  isGuardianUserId,
  removeGuardianVoiceDeafen,
  removeGuardianVoiceMute,
} from '../services/guardianProtection.js';
import { handleMeetingVoiceUpdate } from '../services/meetingRoom.js';
import { handlePersistentVoicePresenceUpdate } from '../services/persistentVoicePresence.js';

export const name = Events.VoiceStateUpdate;

export async function execute(oldState, newState) {
  handlePersistentVoicePresenceUpdate(oldState, newState);

  logVoiceChannelChange(oldState, newState).catch((error) => {
    console.error('Falha ao registrar mudanca em canal de voz:', error);
  });

  await restoreGuardianVoice(newState);
  await punishGuardianVoiceDisconnectExecutor(oldState, newState);
  await handleMeetingVoiceUpdate(oldState, newState);
}

async function restoreGuardianVoice(voiceState) {
  try {
    const muteRestored = await removeGuardianVoiceMute(voiceState);

    if (muteRestored) {
      console.log(`Mute de voz removido automaticamente do guardiao ${voiceState.id}.`);
    }
  } catch (error) {
    console.error(`Falha ao remover mute de voz do guardiao ${voiceState.id}:`, error);
  }

  try {
    const deafenRestored = await removeGuardianVoiceDeafen(voiceState);

    if (deafenRestored) {
      console.log(`Deafen de voz removido automaticamente do guardiao ${voiceState.id}.`);
    }
  } catch (error) {
    console.error(`Falha ao remover deafen de voz do guardiao ${voiceState.id}:`, error);
  }
}

async function punishGuardianVoiceDisconnectExecutor(oldState, newState) {
  if (
    !isGuardianUserId(oldState.id) ||
    !oldState.channelId ||
    newState.channelId
  ) {
    return;
  }

  const disconnectedAt = Date.now();

  try {
    const entry = await findGuardianVoiceDisconnectAuditEntry(
      oldState.guild,
      oldState.id,
      disconnectedAt,
    );

    if (!entry?.executorId) {
      console.warn(
        `Guardiao ${oldState.id} saiu da call ${oldState.channelId}, ` +
          'mas nao encontrei MemberDisconnect recente no audit log.',
      );
      return;
    }

    const disconnected = await disconnectGuardianVoiceKickExecutor(
      oldState.guild,
      entry.executorId,
      oldState.id,
    );

    if (disconnected) {
      console.log(
        `Executor ${entry.executor?.tag ?? entry.executorId} desconectado por ` +
          `kickar o guardiao ${oldState.id} da call.`,
      );
      return;
    }

    console.warn(
      `Executor ${entry.executor?.tag ?? entry.executorId} kickou o guardiao ` +
        `${oldState.id}, mas nao esta em uma call para eu desconectar.`,
    );
  } catch (error) {
    console.error(
      `Falha ao desconectar quem kickou o guardiao ${oldState.id} da call:`,
      error,
    );
  }
}
