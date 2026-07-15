import { Events } from 'discord.js';
import { config } from '../config.js';
import { errorEmbed, warningEmbed } from '../utils/embeds.js';

export const name = Events.InteractionCreate;

export async function execute(interaction, client) {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (config.blacklistedUserIds.includes(interaction.user.id)) {
    await interaction.reply({
      embeds: [
        warningEmbed(
          'Acesso bloqueado',
          'Voce nao pode usar este bot.',
        ),
      ],
      ephemeral: true,
    });
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
