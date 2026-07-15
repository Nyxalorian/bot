import { Events } from 'discord.js';
import { config } from '../config.js';
import { logCommandUsage } from '../services/auditLog.js';
import {
  handleMeetingPanelInteraction,
  isMeetingPanelInteraction,
} from '../services/meetingRoom.js';
import { errorEmbed, warningEmbed } from '../utils/embeds.js';

export const name = Events.InteractionCreate;

export async function execute(interaction, client) {
  if (config.blacklistedUserIds.includes(interaction.user.id)) {
    await replyBlockedInteraction(interaction);
    return;
  }

  if (isMeetingPanelInteraction(interaction)) {
    await handleMeetingPanelInteraction(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    await interaction.reply({
      embeds: [
        warningEmbed(
          'Comando indisponivel',
          'Esse comando ainda nao esta disponivel por aqui.',
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  logCommandUsage({
    client,
    user: interaction.user,
    guild: interaction.guild,
    channel: interaction.channel,
    command: `/${interaction.commandName}`,
    details: formatSlashCommandDetails(interaction),
  }).catch((error) => {
    console.error('Falha ao registrar uso de slash command:', error);
  });

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Erro ao executar /${interaction.commandName}:`, error);

    const reply = {
      embeds: [
        errorEmbed(
          'Erro no comando',
          'Algo deu errado ao executar esse comando.',
        ),
      ],
      ephemeral: true,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply);
      return;
    }

    await interaction.reply(reply);
  }
}

function formatSlashCommandDetails(interaction) {
  const options = interaction.options.data
    .map((option) => `${option.name}: ${option.value ?? '[subcomando]'}`)
    .join(', ');

  return options ? `/${interaction.commandName} ${options}` : `/${interaction.commandName}`;
}

async function replyBlockedInteraction(interaction) {
  const reply = {
    embeds: [
      warningEmbed(
        'Acesso bloqueado',
        'Voce nao pode usar este bot.',
      ),
    ],
    ephemeral: Boolean(interaction.guildId),
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(reply);
    return;
  }

  if (typeof interaction.reply === 'function') {
    await interaction.reply({
      ...reply,
    });
  }
}
