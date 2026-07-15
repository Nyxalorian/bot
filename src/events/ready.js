import { ActivityType, Events } from 'discord.js';
import { startGoodMorningSchedule } from '../services/goodMorning.js';
import { startMessiEveningSchedule } from '../services/messiEvening.js';
import {
  fetchGuardianMembers,
  removeGuardianChatMute,
  removeGuardianVoiceDeafenInGuild,
  removeGuardianVoiceMuteInGuild,
  restoreGuardianRole,
} from '../services/guardianProtection.js';

export const name = Events.ClientReady;
export const once = true;

export function execute(client) {
  client.user.setPresence({
    activities: [{ name: 'Zeca e Mimo', type: ActivityType.Watching }],
    status: 'online',
  });

  console.log(`Zeca e Mimo online como ${client.user.tag}.`);
  startGoodMorningSchedule(client);
  startMessiEveningSchedule(client);
  restoreGuardianInGuilds(client).catch((error) => {
    console.error('Falha na checagem inicial do guardiao:', error);
  });
}

async function restoreGuardianInGuilds(client) {
  for (const guild of client.guilds.cache.values()) {
    const members = await fetchGuardianMembers(guild);

    for (const member of members) {
      try {
        const chatMuteRemoved = await removeGuardianChatMute(member);

        if (chatMuteRemoved) {
          console.log(`Mute de chat removido do guardiao ${member.user.tag} ao iniciar.`);
        }
      } catch (error) {
        console.error(`Falha ao remover mute de chat do guardiao ${member.user.tag}:`, error);
      }

      try {
        const roleRestored = await restoreGuardianRole(member);

        if (roleRestored) {
          console.log(`Cargo guardiao restaurado para ${member.user.tag} ao iniciar.`);
        }
      } catch (error) {
        console.error(`Falha ao restaurar cargo guardiao de ${member.user.tag}:`, error);
      }
    }

    try {
      const voiceMuteRemoved = await removeGuardianVoiceMuteInGuild(guild);

      if (voiceMuteRemoved) {
        console.log(`Mute de voz removido de guardiao no servidor ${guild.name} ao iniciar.`);
      }
    } catch (error) {
      console.error(`Falha ao remover mute de voz de guardiao em ${guild.name}:`, error);
    }

    try {
      const voiceDeafenRemoved = await removeGuardianVoiceDeafenInGuild(guild);

      if (voiceDeafenRemoved) {
        console.log(`Deafen de voz removido de guardiao no servidor ${guild.name} ao iniciar.`);
      }
    } catch (error) {
      console.error(`Falha ao remover deafen de voz de guardiao em ${guild.name}:`, error);
    }
  }
}
