import { Events } from 'discord.js';
import { logUserNameChange } from '../services/auditLog.js';

export const name = Events.UserUpdate;

export async function execute(oldUser, newUser, client) {
  try {
    await logUserNameChange(client, oldUser, newUser);
  } catch (error) {
    console.error('Falha ao registrar troca de nome global:', error);
  }
}
