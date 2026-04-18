// src/commands.js — обработка команд

const { EmbedBuilder } = require('discord.js');
const { admin, db, getUser, getOrCreateUser, updateUser, getConfig, writeLog } = require('./firebase');
const { getRankByElo, getLevelByXp, xpProgress } = require('./ranks');
const { claimDailyBonus } = require('./xp');
const { grantAchievement } = require('./achievements');

// ── Цвет эмбеда ──────────────────────────────────────────────
const COLOR = 0xdc3545; // --red

/**
 * Роутер команд
 * @param {import('discord.js').Message} message
 */
async function handleCommand(message) {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const args    = message.content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  switch (command) {
    case 'sync':      return cmdSync(message);
    case 'profile':
    case 'p':         return cmdProfile(message, args);
    case 'daily':     return cmdDaily(message);
    case 'top':
    case 'lb':        return cmdTop(message, args);
    case 'rank':      return cmdRank(message, args);
    case 'warn':      return cmdWarn(message, args);
    case 'unwarn':    return cmdUnwarn(message, args);
    case 'give':      return cmdGive(message, args);
    case 'achiev':    return cmdAchiev(message, args);
    case 'help':      return cmdHelp(message);
    default:          break;
  }
}

// ── !sync ─────────────────────────────────────────────────────
// Синхронизировать всех участников сервера с Firestore
async function cmdSync(message) {
  if (!isAdmin(message.member)) {
    return message.reply('❌ Только администраторы могут использовать !sync');
  }

  const reply = await message.reply('🔄 Синхронизация участников...');
  let created = 0, updated = 0;

  try {
    const members = await message.guild.members.fetch();

    for (const [, member] of members) {
      if (member.user.bot) continue;

      const existing = await getUser(member.id);
      const memberRoleId = process.env.MEMBER_ROLE_ID;

      if (!existing) {
        await getOrCreateUser(member);
        created++;
      } else {
        // Обновить аватар и ник
        const updates = {
          username:    member.user.username,
          displayName: member.displayName,
          avatarUrl:   member.user.displayAvatarURL({ size: 64, extension: 'png' }),
        };
        // Обновить роль по Discord-роли
        if (memberRoleId && member.roles.cache.has(memberRoleId)) {
          if (existing.role === 'user') updates.role = 'member';
        }
        await updateUser(member.id, updates);
        updated++;
      }
    }

    await reply.edit(`✅ Синхронизация завершена! Создано: **${created}**, обновлено: **${updated}**`);
    await writeLog('sync', 'ALL', `+${created} создано, ${updated} обновлено`, '!sync', message.author.username);

  } catch (e) {
    await reply.edit(`❌ Ошибка синхронизации: ${e.message}`);
    console.error('[!sync]', e);
  }
}

// ── !profile [@user] ─────────────────────────────────────────
async function cmdProfile(message, args) {
  let target = message.mentions.members.first() || message.member;
  const user = await getUser(target.id);

  if (!user) {
    return message.reply('❌ Профиль не найден. Напишите любое сообщение для создания.');
  }

  const rank    = getRankByElo(user.elo || 1000);
  const level   = user.level || 0;
  const { progress } = xpProgress(user.xp || 0);
  const warns   = (user.warnings || []).length;
  const achs    = (user.achievements || []).length;

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`${user.username}`)
    .setThumbnail(user.avatarUrl || null)
    .addFields(
      { name: '⚡ Уровень',  value: `**${level}** (${progress}% до ${level + 1})`, inline: true },
      { name: '🏆 ELO',      value: `**${user.elo || 1000}** — ${rank.name}`,      inline: true },
      { name: '💰 Монеты',   value: `**${(user.currency || 0).toLocaleString('ru')}**`, inline: true },
      { name: '🎮 Ивенты',   value: `**${user.eventsParticipated || 0}**`,          inline: true },
      { name: '🎙️ Войс',    value: `**${user.totalVoiceMinutes || 0}** мин`,        inline: true },
      { name: '🏅 Ачивки',   value: `**${achs}**`,                                  inline: true },
    )
    .setFooter({ text: `Роль: ${user.role}${warns > 0 ? ` | ⚠️ Варны: ${warns}` : ''}` })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

// ── !daily ────────────────────────────────────────────────────
async function cmdDaily(message) {
  const result = await claimDailyBonus(message.author.id);
  if (result.ok) {
    const embed = new EmbedBuilder()
      .setColor(0xffc107)
      .setTitle('🎁 Ежедневный бонус получен!')
      .setDescription(`+**${result.bonus}** монет начислено на ваш счёт!`)
      .setFooter({ text: 'Возвращайтесь завтра за новым бонусом' });
    await message.reply({ embeds: [embed] });
  } else {
    await message.reply(`⏳ ${result.reason}`);
  }
}

// ── !top [elo|level|coins|voice] ─────────────────────────────
async function cmdTop(message, args) {
  const sort  = args[0]?.toLowerCase() || 'elo';
  const field = sort === 'level' ? 'level' : sort === 'coins' ? 'currency' : sort === 'voice' ? 'totalVoiceMinutes' : 'elo';

  const snap = await db.collection('users').orderBy(field, 'desc').limit(10).get();
  if (snap.empty) return message.reply('Нет данных');

  const lines = snap.docs.map((doc, i) => {
    const u     = doc.data();
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const val   = field === 'totalVoiceMinutes' ? `${u[field] || 0} мин` : (u[field] || 0).toLocaleString('ru');
    return `${medal} **${u.username}** — ${val}`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🏆 Топ 10 — ${sort.toUpperCase()}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'gray-squad.gg | Лидерборд' });

  await message.reply({ embeds: [embed] });
}

// ── !rank ─────────────────────────────────────────────────────
async function cmdRank(message, args) {
  let target = message.mentions.members.first() || message.member;
  const user = await getUser(target.id);
  if (!user) return message.reply('❌ Профиль не найден');

  const rank  = getRankByElo(user.elo || 1000);
  const next  = require('./ranks').RANKS.find(r => r.id === rank.id + 1);
  const toNext = next ? `(до ${next.name}: +${next.min - (user.elo || 1000)} ELO)` : '(максимальный ранг!)';

  await message.reply(
    `${target.displayName}: **${rank.name}** — ${user.elo || 1000} ELO ${toNext}`
  );
}

// ── !warn @user [причина] ────────────────────────────────────
async function cmdWarn(message, args) {
  if (!isAdmin(message.member)) return message.reply('❌ Нет прав');

  const target = message.mentions.members.first();
  if (!target) return message.reply('❌ Укажите пользователя: !warn @user [причина]');

  const reason = args.slice(1).join(' ') || 'Не указана';
  const user   = await getOrCreateUser(target);
  const warns  = (user.warnings || []);
  const warnId = `warn_${Date.now()}`;

  const newWarn = {
    id:       warnId,
    reason,
    issuedBy: message.author.username,
    issuedAt: new Date().toISOString(),
    expiresAt: null,
  };

  warns.push(newWarn);
  await updateUser(target.id, { warnings: warns });

  // При 3 варнах — выдать роль «Наказанный»
  const punishedRoleId = process.env.PUNISHED_ROLE_ID;
  if (warns.length >= 3 && punishedRoleId) {
    try {
      await target.roles.add(punishedRoleId);
      await message.channel.send(`⛔ ${target} получил роль «Наказанный» за 3 варна.`);
    } catch {}
  }

  // Уведомление
  const { sendNotification } = require('./firebase');
  await sendNotification(target.id, {
    type:    'warn',
    title:   `⚠️ Получен варн #${warns.length}`,
    message: `Причина: ${reason}. Выдал: ${message.author.username}`,
  });

  try {
    await target.send(`⚠️ Вы получили **Варн #${warns.length}** на сервере Gray Squad.\nПричина: **${reason}**`);
  } catch {}

  await writeLog('warn', target.user.username, `+1 варн (всего ${warns.length})`, reason, message.author.username);
  await message.reply(`⚠️ Варн #${warns.length} выдан **${target.displayName}**. Причина: ${reason}`);
}

// ── !unwarn @user ─────────────────────────────────────────────
async function cmdUnwarn(message, args) {
  if (!isAdmin(message.member)) return message.reply('❌ Нет прав');

  const target = message.mentions.members.first();
  if (!target) return message.reply('❌ Укажите пользователя');

  const user   = await getUser(target.id);
  if (!user || !user.warnings?.length) return message.reply('У пользователя нет варнов.');

  const newWarns = user.warnings.slice(0, -1); // убрать последний
  await updateUser(target.id, { warnings: newWarns });

  // Снять роль наказанного если варнов < 3
  const punishedRoleId = process.env.PUNISHED_ROLE_ID;
  if (newWarns.length < 3 && punishedRoleId) {
    try { await target.roles.remove(punishedRoleId); } catch {}
  }

  await writeLog('warn_remove', target.user.username, `-1 варн (осталось ${newWarns.length})`, 'Снятие варна', message.author.username);
  await message.reply(`✅ Последний варн снят с **${target.displayName}**. Осталось: ${newWarns.length}`);
}

// ── !give @user [xp|coins|elo] [amount] ─────────────────────
async function cmdGive(message, args) {
  if (!isAdmin(message.member)) return message.reply('❌ Нет прав');

  const target = message.mentions.members.first();
  const type   = args[1]?.toLowerCase();
  const amount = parseInt(args[2]);

  if (!target || !type || isNaN(amount)) {
    return message.reply('❌ Использование: !give @user [xp|coins|elo] [число]');
  }

  const user = await getUser(target.id);
  if (!user) return message.reply('❌ Профиль не найден');

  let updates = {};
  let logType = '';

  if (type === 'xp') {
    const newXp = (user.xp || 0) + amount;
    const newLvl = getLevelByXp(newXp);
    updates = { xp: newXp, level: newLvl };
    logType = 'xp';
    await message.reply(`✅ ${target.displayName} +${amount} XP (уровень ${newLvl})`);
  } else if (type === 'coins' || type === 'currency') {
    updates = { currency: admin.firestore.FieldValue.increment(amount) };
    logType = 'coins';
    await message.reply(`✅ ${target.displayName} +${amount} монет`);
  } else if (type === 'elo') {
    const newElo  = Math.max(1, (user.elo || 1000) + amount);
    const newRank = getRankByElo(newElo);
    updates = { elo: newElo, rank: newRank.id, rankName: newRank.name, rankColor: newRank.color };
    logType = 'elo';
    await message.reply(`✅ ${target.displayName} ELO: ${user.elo} → ${newElo} (${newRank.name})`);
  } else {
    return message.reply('❌ Тип: xp | coins | elo');
  }

  await updateUser(target.id, updates);
  await writeLog(logType, target.user.username, `${amount > 0 ? '+' : ''}${amount}`, 'Ручная выдача', message.author.username);
}

// ── !achiev @user [achievementId] ────────────────────────────
async function cmdAchiev(message, args) {
  if (!isAdmin(message.member)) return message.reply('❌ Нет прав');

  const target = message.mentions.members.first();
  const achId  = args[1];

  if (!target || !achId) {
    return message.reply('❌ Использование: !achiev @user [achievement_id]');
  }

  await grantAchievement(target.id, achId, {
    guild:   message.guild,
    byAdmin: message.author.username,
  });

  await message.reply(`✅ Ачивка **${achId}** выдана **${target.displayName}**`);
}

// ── !help ─────────────────────────────────────────────────────
async function cmdHelp(message) {
  const isA = isAdmin(message.member);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('⚙️ Gray Squad Bot — Команды')
    .addFields(
      { name: '👤 Профиль',  value: '`!profile [@user]` — показать профиль\n`!rank [@user]` — текущий ранг ELO' },
      { name: '🏆 Рейтинг',  value: '`!top [elo|level|coins|voice]` — топ 10' },
      { name: '🎁 Бонус',    value: '`!daily` — ежедневный бонус (+25 монет)' },
      ...(isA ? [
        { name: '⚙️ Админ', value: '`!sync` — синхронизация участников\n`!warn @user [причина]` — выдать варн\n`!unwarn @user` — снять варн\n`!give @user xp|coins|elo [число]` — выдать ресурс\n`!achiev @user [id]` — выдать ачивку' },
      ] : [])
    )
    .setFooter({ text: 'Gray Squad · gray-squad.gg' });

  await message.reply({ embeds: [embed] });
}

// ── Проверка прав ──────────────────────────────────────────────
function isAdmin(member) {
  // Проверяем права Discord или роль в базе
  return member.permissions.has('ManageGuild') || member.permissions.has('Administrator');
}

module.exports = { handleCommand };
<<<<<<< HEAD


// ── ОБРАБОТКА СЛЕШ-КОМАНД ─────────────────────────────────────
async function handleSlashCommand(interaction, commandName, options) {
  const user = options.getUser('user') || interaction.user;
  const member = await interaction.guild.members.fetch(user.id);

  switch (commandName) {
    case 'profile':
      await cmdProfileSlash(interaction, member);
      break;
    case 'rank':
      await cmdRankSlash(interaction, member);
      break;
    case 'top':
      await cmdTopSlash(interaction, options.getString('type') || 'elo');
      break;
    case 'daily':
      await cmdDailySlash(interaction);
      break;
    case 'sync':
      await cmdSyncSlash(interaction);
      break;
    case 'warn':
      await cmdWarnSlash(interaction, member, options.getString('reason') || 'Не указана');
      break;
    case 'unwarn':
      await cmdUnwarnSlash(interaction, member);
      break;
    case 'give':
      await cmdGiveSlash(interaction, member, options.getString('type'), options.getInteger('amount'));
      break;
    case 'achiev':
      await cmdAchievSlash(interaction, member, options.getString('id'));
      break;
    case 'help':
      await cmdHelpSlash(interaction);
      break;
    default:
      await interaction.reply('❌ Неизвестная команда');
  }
}

// Адаптеры для слеш-команд (обёртки над существующими функциями)
async function cmdProfileSlash(interaction, member) {
  const user = await getUser(member.id);
  if (!user) return interaction.reply('❌ Профиль не найден');
  
  const rank = getRankByElo(user.elo || 1000);
  const level = user.level || 0;
  const warns = (user.warnings || []).length;
  
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(user.username)
    .setThumbnail(user.avatarUrl || null)
    .addFields(
      { name: '⚡ Уровень', value: `**${level}**`, inline: true },
      { name: '🏆 ELO', value: `**${user.elo || 1000}** — ${rank.name}`, inline: true },
      { name: '💰 Монеты', value: `**${(user.currency || 0).toLocaleString('ru')}**`, inline: true },
    );
  
  await interaction.reply({ embeds: [embed] });
}

async function cmdDailySlash(interaction) {
  const result = await claimDailyBonus(interaction.user.id);
  if (result.ok) {
    await interaction.reply(`🎁 Ежедневный бонус получен! +**${result.bonus}** монет`);
  } else {
    await interaction.reply(`⏳ ${result.reason}`);
  }
}

// ... аналогично оберните остальные команды
=======
>>>>>>> 07c6300510ba7853aa11710d8724161d5320cf51
