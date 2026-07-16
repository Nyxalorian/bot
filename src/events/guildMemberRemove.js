import { Events } from 'discord.js';
import { logMemberLeave } from '../services/auditLog.js';

export const name = Events.GuildMemberRemove;

export async function execute(member) {
  try {
    await logMemberLeave(member);
  } catch (error) {
    console.error('Falha ao registrar saida do servidor:', error);
  }
}
