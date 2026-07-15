import { Events } from 'discord.js';
import {
  isGuardianUserId,
  removeGuardianChatMute,
  restoreGuardianRole,
} from '../services/guardianProtection.js';
import { banMemberByHardBan, findHardBanMatch } from '../services/hardBan.js';

export const name = Events.GuildMemberAdd;

export async function execute(member) {
  await restoreGuardianMember(member);

  if (isGuardianUserId(member.id)) {
    return;
  }

  const pattern = await findHardBanMatch(member);

  if (!pattern) {
    return;
  }

  try {
    await banMemberByHardBan(member, pattern, 'Hardban automatico');
    console.log(
      `Hardban automatico aplicado em ${member.user.tag}: nome contem "${pattern.value}".`,
    );
  } catch (error) {
    console.error(`Falha ao aplicar hardban em ${member.user.tag}:`, error);
  }
}

async function restoreGuardianMember(member) {
  try {
    const chatMuteRemoved = await removeGuardianChatMute(member);

    if (chatMuteRemoved) {
      console.log(`Mute de chat removido automaticamente do guardiao ${member.user.tag}.`);
    }
  } catch (error) {
    console.error(`Falha ao remover mute de chat do guardiao ${member.user.tag}:`, error);
  }

  try {
    const roleRestored = await restoreGuardianRole(member);

    if (roleRestored) {
      console.log(`Cargo guardiao restaurado para ${member.user.tag}.`);
    }
  } catch (error) {
    console.error(`Falha ao restaurar cargo guardiao de ${member.user.tag}:`, error);
  }
}
