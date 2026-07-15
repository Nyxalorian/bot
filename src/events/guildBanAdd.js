import { Events } from 'discord.js';
import {
  banGuardianBanExecutor,
  findGuardianBanAuditEntry,
  isGuardianUserId,
  unbanGuardian,
} from '../services/guardianProtection.js';

export const name = Events.GuildBanAdd;

export async function execute(ban) {
  if (!isGuardianUserId(ban.user.id)) {
    return;
  }

  try {
    await unbanGuardian(ban.guild, ban.user.id);
    console.log(`Banimento do guardiao ${ban.user.tag} removido automaticamente.`);
  } catch (error) {
    console.error(`Falha ao remover banimento do guardiao ${ban.user.tag}:`, error);
  }

  try {
    const entry = await findGuardianBanAuditEntry(ban.guild, ban.user.id);

    if (!entry?.executorId) {
      console.error(
        `Nao consegui identificar quem baniu o guardiao ${ban.user.tag} no audit log.`,
      );
      return;
    }

    const banned = await banGuardianBanExecutor(
      ban.guild,
      entry.executorId,
      ban.user.id,
    );

    if (banned) {
      console.log(
        `Executor ${entry.executor?.tag ?? entry.executorId} banido por banir o guardiao ${ban.user.tag}.`,
      );
    }
  } catch (error) {
    console.error(`Falha ao banir quem baniu o guardiao ${ban.user.tag}:`, error);
  }
}
