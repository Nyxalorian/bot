import { Events } from 'discord.js';
import {
  logMemberNameChange,
  logMemberRoleChange,
} from '../services/auditLog.js';
import { banMemberByHardBan, findHardBanMatch } from '../services/hardBan.js';
import {
  isGuardianUserId,
  removeGuardianChatMute,
  restoreGuardianRole,
} from '../services/guardianProtection.js';
import { enforceNicknameLock } from '../services/nicknameLock.js';

export const name = Events.GuildMemberUpdate;

export async function execute(oldMember, newMember) {
  logMemberNameChange(newMember.client, oldMember, newMember).catch((error) => {
    console.error('Falha ao registrar troca de nome:', error);
  });
  logMemberRoleChange(newMember.client, oldMember, newMember).catch((error) => {
    console.error('Falha ao registrar troca de cargo:', error);
  });

  await restoreGuardianMember(newMember);

  if (isGuardianUserId(newMember.id)) {
    return;
  }

  const pattern = await findHardBanMatch(newMember);

  if (pattern) {
    try {
      await banMemberByHardBan(newMember, pattern, 'Hardban por alteracao de nome');
      console.log(
        `Hardban por alteracao de nome aplicado em ${newMember.user.tag}: contem "${pattern.value}".`,
      );
    } catch (error) {
      console.error(`Falha ao aplicar hardban em ${newMember.user.tag}:`, error);
    }

    return;
  }

  await restoreLockedNickname(newMember);
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

async function restoreLockedNickname(member) {
  try {
    const reverted = await enforceNicknameLock(member);

    if (reverted) {
      console.log(`Apelido travado restaurado para ${member.user.tag}.`);
    }
  } catch (error) {
    console.error(`Falha ao restaurar apelido de ${member.user.tag}:`, error);
  }
}
