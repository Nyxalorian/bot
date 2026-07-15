import { SlashCommandBuilder } from 'discord.js';
import { infoEmbed, successEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Mostra se o Zeca e Mimo esta acordado.');

export async function execute(interaction) {
  const sent = await interaction.reply({
    embeds: [infoEmbed('Ping', 'Calculando latencia...')],
    fetchReply: true,
  });

  const latency = sent.createdTimestamp - interaction.createdTimestamp;
  await interaction.editReply({
    embeds: [successEmbed('Pong!', `Latencia: ${latency}ms.`)],
  });
}
