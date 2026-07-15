import { SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('sobre')
  .setDescription('Apresenta o Zeca e Mimo.');

export async function execute(interaction) {
  await interaction.reply({
    embeds: [
      infoEmbed(
        'Zeca e Mimo',
        'Bot de Discord com utilidades, moderacao, reunioes temporarias, RGs e bom dia automatico.',
      ),
    ],
  });
}
