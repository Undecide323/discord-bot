// src/commands.js — обработка команд (улучшенный стиль)

const { EmbedBuilder } = require('discord.js');
const { admin, db, getUser, getOrCreateUser, updateUser, getConfig, writeLog, sendNotification } = require('./firebase');
const { getLevelByXp, xpProgress, RANKS } = require('./ranks');
const { claimDailyBonus } = require('./xp');
const { grantAchievement } = require('./achievements');

// ── Вспомогательная функция форматирования чисел ─────────────
function fmtNum(num) {
  return (num || 0).toLocaleString('ru-RU');
}

// ═══════════════════════════════════════════════════════════════
//  ЛОГИКА КОМПОЗИТНОГО ELO (как на сайте и в лидерборде)
//  Если эти функции уже есть в ./ranks, можно импортировать оттуда.
//  Здесь продублированы для автономности бота.
// ═══════════════════════════════════════════════════════════════

const ELO_RANK_TIERS = [
  { id: 0,  name: 'Неактивен',    color: '#6c757d', icon: '💤', min: 0,    max: 499 },
  { id: 1,  name: 'Железо',       color: '#8B8B8B', icon: '⚙️', min: 500,  max: 899 },
  { id: 2,  name: 'Бронза',       color: '#CD7F32', icon: '🥉', min: 900,  max: 1499 },
  { id: 3,  name: 'Серебро',      color: '#C0C0C0', icon: '🥈', min: 1500, max: 2299 },
  { id: 4,  name: 'Золото',       color: '#FFD700', icon: '🥇', min: 2300, max: 3299 },
  { id: 5,  name: 'Платина',      color: '#E5E4E2', icon: '💎', min: 3300, max: 4699 },
  { id: 6,  name: 'Алмаз',        color: '#B9F2FF', icon: '💠', min: 4700, max: 6499 },
  { id: 7,  name: 'Мастер',       color: '#A335EE', icon: '🔮', min: 6500, max: 9199 },
  { id: 8,  name: 'Грандмастер',  color: '#FF8C00', icon: '🌟', min: 9200, max: 12999 },
  { id: 9,  name: 'Элитный',      color: '#FF4500', icon: '🔥', min: 13000, max: 18999 },
  { id: 10, name: 'Легенда',      color: '#FF0000', icon: '👑', min: 19000, max: Infinity },
];

/**
 * Вычислить композитный ELO для пользователя.
 * Формула: base_elo + level*w_level + floor(xp/w_xp_div) + floor(voice/w_voice_div) + floor(sqrt(coins)*w_coin)
 * @param {object} u - пользовательские данные (поля: elo, level, xp, totalVoiceMinutes, currency)
 * @param {object|undefined} w - веса ({ elo_floor, w_level, w_xp_div, w_voice_div, w_coin })
 * @returns {number}
 */
function computeCompositeElo(u, w) {
  const floor = (w && w.elo_floor) || 500;
  const wLvl = (w && w.w_level) || 25;
  const wXpDiv = (w && w.w_xp_div) || 120;
  const wVoiceDiv = (w && w.w_voice_div) || 6;
  const wCoin = (w && w.w_coin) || 1.5;

  const base = Math.max(u.elo || 500, floor);
  const fromLevel = (u.level || 0) * wLvl;
  const fromXp = Math.floor((u.xp || 0) / wXpDiv);
  const fromVoice = Math.floor((u.totalVoiceMinutes || 0) / wVoiceDiv);
  const fromCoins = Math.floor(Math.sqrt(u.currency || 0) * wCoin);

  return base + fromLevel + fromXp + fromVoice + fromCoins;
}

/**
 * Получить ранг по композитному ELO.
 * @param {number} elo
 * @returns {object} ранг из ELO_RANK_TIERS
 */
function getRankByComposite(elo) {
  return ELO_RANK_TIERS.find(r => elo >= r.min && elo <= r.max) || ELO_RANK_TIERS[ELO_RANK_TIERS.length - 1];
}

// ── Цвет эмбеда по умолчанию ──────────────────────────────────
const COLOR = 0xdc3545; // --red

/**
 * Роутер команд (префиксные)
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
        const updates = {
          username:    member.user.username,
          displayName: member.displayName,
          avatarUrl:   member.user.displayAvatarURL({ size: 64, extension: 'png' }),
        };
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

// ── !profile [@user] (улучшенный) ─────────────────────────────
async function cmdProfile(message, args) {
  let target = message.mentions.members.first() || message.member;
  const user = await getUser(target.id);
  if (!user) {
    return message.reply('❌ Профиль не найден. Напишите любое сообщение для создания.');
  }

  // Загружаем веса для композитного ELO из конфига
  let weights = null;
  try {
    const config = await getConfig();
    weights = config.eloFormula || null;
  } catch (e) { /* используем дефолтные */ }

  const composite = computeCompositeElo({ ...user, elo: user.elo || 500 }, weights);
  const rank = getRankByComposite(composite);
  const level = user.level || 0;
  const { progress } = xpProgress(user.xp || 0);
  const warns = (user.warnings || []).length;
  const achs = (user.achievements || []).length;

  // Прогресс до следующего ранга
  const currentTier = ELO_RANK_TIERS.find(t => t.id === rank.id);
  const nextTier = ELO_RANK_TIERS.find(t => t.id === rank.id + 1);
  let rankProgress = '';
  if (nextTier && currentTier) {
    const progressInTier = composite - currentTier.min;
    const tierRange = nextTier.min - currentTier.min;
    const pct = Math.min(100, Math.round((progressInTier / tierRange) * 100));
    const barLength = 10;
    const filled = Math.round((pct / 100) * barLength);
    const empty = barLength - filled;
    rankProgress = `\n${'█'.repeat(filled)}${'░'.repeat(empty)} ${pct}% до ${nextTier.icon || ''} ${nextTier.name}`;
  } else if (!nextTier) {
    rankProgress = '\n🌟 Максимальный ранг!';
  }

  // Discord-роли (если есть в профиле)
  const discordRoles = (user.discordRoles || []);
  const rolesText = discordRoles.length > 0
    ? discordRoles.map(r => `• ${r.name}`).join('\n')
    : 'Нет дополнительных ролей';

  // Последняя активность (из логов)
  let lastActivity = 'Нет данных';
  try {
    const logsSnap = await db.collection('logs')
      .where('targetUsername', '==', user.username)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (!logsSnap.empty) {
      const log = logsSnap.docs[0].data();
      lastActivity = `<t:${Math.floor(log.createdAt._seconds)}:R>`;
    }
  } catch (e) { /* игнорируем */ }

  const embed = new EmbedBuilder()
    .setColor(rank.color ? parseInt(rank.color.replace('#', ''), 16) : COLOR)
    .setAuthor({ name: target.displayName, iconURL: user.avatarUrl || undefined })
    .setThumbnail(user.avatarUrl || null)
    .setDescription(
      `**${rank.icon || ''} ${rank.name}** — ${fmtNum(composite)} ELO\n` +
      rankProgress
    )
    .addFields(
      {
        name: '📊 Основное',
        value: [
          `⚡ **Уровень:** ${level} (${progress}% до ${level + 1})`,
          `💰 **Монеты:** ${(user.currency || 0).toLocaleString('ru')}`,
          `🎮 **Ивентов:** ${user.eventsParticipated || 0}`,
          `🎙️ **Голос:** ${user.totalVoiceMinutes || 0} мин`,
          `🏅 **Ачивок:** ${achs}`,
        ].join('\n'),
        inline: true
      },
      {
        name: '🔰 Роли Discord',
        value: rolesText,
        inline: true
      }
    )
    .addFields(
      {
        name: '📈 Прогресс',
        value: [
          `**XP:** ${(user.xp || 0).toLocaleString('ru')}`,
          `**Base ELO:** ${user.elo || 500}`,
          `**Активность:** ${lastActivity}`,
          warns > 0 ? `⚠️ **Варны:** ${warns}` : '✅ **Варнов нет**',
        ].join('\n'),
        inline: false
      }
    )
    .setFooter({
      text: `${user.username} · ${user.role.toUpperCase()}`,
      iconURL: message.guild.iconURL() || undefined
    })
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

// ── !top [elo|level|coins|voice] (улучшенный) ───────────────
async function cmdTop(message, args) {
  const sort  = args[0]?.toLowerCase() || 'elo';
  const fieldMap = {
    elo: 'elo', level: 'level', coins: 'currency', voice: 'totalVoiceMinutes'
  };
  const field = fieldMap[sort] || 'elo';

  // Для сортировки по ELO будем использовать композитный ELO
  let topList;
  if (sort === 'elo') {
    // Получаем топ-50 по base_elo, вычисляем композит и сортируем по нему
    const snap = await db.collection('users').orderBy('elo', 'desc').limit(50).get();
    let users = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Загружаем веса
    let weights = null;
    try {
      const config = await getConfig();
      weights = config.eloFormula || null;
    } catch (e) {}
    users = users.map(u => ({
      ...u,
      _composite: computeCompositeElo(u, weights)
    })).sort((a, b) => b._composite - a._composite).slice(0, 10);
    topList = users;
  } else {
    const snap = await db.collection('users').orderBy(field, 'desc').limit(10).get();
    topList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  if (!topList.length) return message.reply('Нет данных');

  const lines = topList.map((u, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    let value;
    if (sort === 'elo') {
      const rank = getRankByComposite(u._composite);
      value = `${fmtNum(u._composite)} ELO (${rank.name})`;
    } else if (sort === 'voice') {
      value = `${u.totalVoiceMinutes || 0} мин`;
    } else {
      value = fmtNum(u[field] || 0);
    }
    return `${medal} **${u.displayName || u.username}** — ${value}`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🏆 Топ 10 — ${sort.toUpperCase()}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Gray Squad · Лидерборд' });

  await message.reply({ embeds: [embed] });
}

// ── !rank (улучшенный, композитный) ────────────────────────────
async function cmdRank(message, args) {
  let target = message.mentions.members.first() || message.member;
  const user = await getUser(target.id);
  if (!user) return message.reply('❌ Профиль не найден');

  let weights = null;
  try {
    const config = await getConfig();
    weights = config.eloFormula || null;
  } catch (e) {}

  const composite = computeCompositeElo({ ...user, elo: user.elo || 500 }, weights);
  const rank = getRankByComposite(composite);
  const nextTier = ELO_RANK_TIERS.find(t => t.id === rank.id + 1);
  let toNext = '';
  if (nextTier) {
    const left = nextTier.min - composite;
    toNext = `(до ${nextTier.icon || ''} ${nextTier.name}: +${left} ELO)`;
  } else {
    toNext = '(максимальный ранг!)';
  }

  const embed = new EmbedBuilder()
    .setColor(rank.color ? parseInt(rank.color.replace('#', ''), 16) : COLOR)
    .setAuthor({ name: target.displayName, iconURL: user.avatarUrl || undefined })
    .setDescription(
      `**${rank.icon || ''} ${rank.name}** — ${fmtNum(composite)} ELO\n` +
      `${toNext}`
    );

  await message.reply({ embeds: [embed] });
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

  const punishedRoleId = process.env.PUNISHED_ROLE_ID;
  if (warns.length >= 3 && punishedRoleId) {
    try {
      await target.roles.add(punishedRoleId);
      await message.channel.send(`⛔ ${target} получил роль «Наказанный» за 3 варна.`);
    } catch {}
  }

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

  const newWarns = user.warnings.slice(0, -1);
  await updateUser(target.id, { warnings: newWarns });

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

// ── !help (улучшенный) ────────────────────────────────────────
async function cmdHelp(message) {
  const isA = isAdmin(message.member);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('⚙️ Gray Squad — Команды')
    .setThumbnail(message.guild.iconURL() || null)
    .addFields(
      { name: '👤 Профиль',     value: '`!profile [@user]` — подробный профиль\n`!rank [@user]` — ранг ELO' },
      { name: '🏆 Рейтинг',     value: '`!top [elo|level|coins|voice]` — топ 10' },
      { name: '🎁 Бонус',       value: '`!daily` — ежедневный бонус (+25 монет)' },
      ...(isA ? [
        { name: '⚙️ Администратор', value: '`!sync` — синхронизация участников\n`!warn @user [причина]` — выдать варн\n`!unwarn @user` — снять варн\n`!give @user xp|coins|elo [число]` — выдать ресурс\n`!achiev @user [id]` — выдать ачивку' },
      ] : [])
    )
    .setFooter({ text: 'Gray Squad · graysquad.fun', iconURL: message.client.user.displayAvatarURL() || undefined });

  await message.reply({ embeds: [embed] });
}

// ── Проверка прав ──────────────────────────────────────────────
function isAdmin(member) {
  return member.permissions.has('ManageGuild') || member.permissions.has('Administrator');
}

// ═══════════════════════════════════════════════════════════════
//  SLASH COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════

async function handleSlashCommand(interaction, commandName, options) {
  const user = options.getUser('user') || interaction.user;
  const member = await interaction.guild.members.fetch(user.id);

  switch (commandName) {
    case 'profile': return cmdProfileSlash(interaction, member);
    case 'rank':    return cmdRankSlash(interaction, member);
    case 'top':     return cmdTopSlash(interaction, options.getString('type') || 'elo');
    case 'daily':   return cmdDailySlash(interaction);
    case 'sync':    return cmdSyncSlash(interaction);
    case 'warn':    return cmdWarnSlash(interaction, member, options.getString('reason') || 'Не указана');
    case 'unwarn':  return cmdUnwarnSlash(interaction, member);
    case 'give':    return cmdGiveSlash(interaction, member, options.getString('type'), options.getInteger('amount'));
    case 'achiev':  return cmdAchievSlash(interaction, member, options.getString('id'));
    case 'help':    return cmdHelpSlash(interaction);
    default: await interaction.reply({ content: '❌ Неизвестная команда', ephemeral: true });
  }
}

async function cmdProfileSlash(interaction, member) {
  const user = await getUser(member.id);
  if (!user) return interaction.reply({ content: '❌ Профиль не найден', ephemeral: true });

  let weights = null;
  try {
    const config = await getConfig();
    weights = config.eloFormula || null;
  } catch (e) {}

  const composite = computeCompositeElo({ ...user, elo: user.elo || 500 }, weights);
  const rank = getRankByComposite(composite);
  const level = user.level || 0;
  const warns = (user.warnings || []).length;

  const embed = new EmbedBuilder()
    .setColor(rank.color ? parseInt(rank.color.replace('#', ''), 16) : COLOR)
    .setAuthor({ name: member.displayName, iconURL: user.avatarUrl || undefined })
    .setThumbnail(user.avatarUrl || null)
    .addFields(
      { name: '⚡ Уровень',  value: `**${level}**`, inline: true },
      { name: '🏆 ELO',      value: `**${fmtNum(composite)}** — ${rank.name}`, inline: true },
      { name: '💰 Монеты',   value: `**${(user.currency || 0).toLocaleString('ru')}**`, inline: true },
    )
    .setFooter({ text: `${user.username} · ${user.role}` });

  await interaction.reply({ embeds: [embed] });
}

async function cmdRankSlash(interaction, member) {
  const user = await getUser(member.id);
  if (!user) return interaction.reply({ content: '❌ Профиль не найден', ephemeral: true });

  let weights = null;
  try { const config = await getConfig(); weights = config.eloFormula || null; } catch (e) {}
  const composite = computeCompositeElo({ ...user, elo: user.elo || 500 }, weights);
  const rank = getRankByComposite(composite);

  await interaction.reply(`${member.displayName}: **${rank.icon || ''} ${rank.name}** — ${fmtNum(composite)} ELO`);
}

async function cmdTopSlash(interaction, type) {
  // Используем общую логику, но ответ через interaction
  // Для упрощения можно вызвать cmdTop, но нужен message. Делаем упрощённую версию.
  const fieldMap = { elo: 'elo', level: 'level', coins: 'currency', voice: 'totalVoiceMinutes' };
  const field = fieldMap[type] || 'elo';
  let topList;
  if (type === 'elo') {
    const snap = await db.collection('users').orderBy('elo', 'desc').limit(50).get();
    let users = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    let weights = null;
    try { const config = await getConfig(); weights = config.eloFormula || null; } catch (e) {}
    users = users.map(u => ({ ...u, _composite: computeCompositeElo(u, weights) }))
                 .sort((a, b) => b._composite - a._composite).slice(0, 10);
    topList = users;
  } else {
    const snap = await db.collection('users').orderBy(field, 'desc').limit(10).get();
    topList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  if (!topList.length) return interaction.reply('Нет данных');
  const lines = topList.map((u, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    let value;
    if (type === 'elo') {
      const rank = getRankByComposite(u._composite);
      value = `${fmtNum(u._composite)} ELO (${rank.name})`;
    } else if (type === 'voice') {
      value = `${u.totalVoiceMinutes || 0} мин`;
    } else {
      value = fmtNum(u[field] || 0);
    }
    return `${medal} **${u.displayName || u.username}** — ${value}`;
  });
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🏆 Топ 10 — ${type.toUpperCase()}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Gray Squad · Лидерборд' });
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

async function cmdSyncSlash(interaction) {
  // Просто вызываем старую логику, но нужен message. Делаем упрощённо.
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!member.permissions.has('Administrator')) {
    return interaction.reply({ content: '❌ Нет прав', ephemeral: true });
  }
  await interaction.deferReply();
  let created = 0, updated = 0;
  try {
    const members = await interaction.guild.members.fetch();
    for (const [, m] of members) {
      if (m.user.bot) continue;
      const existing = await getUser(m.id);
      if (!existing) { await getOrCreateUser(m); created++; }
      else {
        await updateUser(m.id, {
          username: m.user.username,
          displayName: m.displayName,
          avatarUrl: m.user.displayAvatarURL({ size: 64, extension: 'png' })
        });
        updated++;
      }
    }
    await interaction.editReply(`✅ Синхронизация завершена! Создано: **${created}**, обновлено: **${updated}**`);
  } catch (e) {
    await interaction.editReply(`❌ Ошибка: ${e.message}`);
  }
}

async function cmdWarnSlash(interaction, member, reason) {
  // Аналог cmdWarn
  if (!interaction.member.permissions.has('ManageGuild')) {
    return interaction.reply({ content: '❌ Нет прав', ephemeral: true });
  }
  const user = await getOrCreateUser(member);
  const warns = (user.warnings || []);
  const warnId = `warn_${Date.now()}`;
  const newWarn = { id: warnId, reason, issuedBy: interaction.user.username, issuedAt: new Date().toISOString(), expiresAt: null };
  warns.push(newWarn);
  await updateUser(member.id, { warnings: warns });
  // ... остальные действия (роль, уведомления) можно добавить аналогично
  await interaction.reply(`⚠️ Варн #${warns.length} выдан **${member.displayName}**. Причина: ${reason}`);
}

async function cmdUnwarnSlash(interaction, member) {
  if (!interaction.member.permissions.has('ManageGuild')) {
    return interaction.reply({ content: '❌ Нет прав', ephemeral: true });
  }
  const user = await getUser(member.id);
  if (!user || !user.warnings?.length) return interaction.reply({ content: 'У пользователя нет варнов.', ephemeral: true });
  const newWarns = user.warnings.slice(0, -1);
  await updateUser(member.id, { warnings: newWarns });
  await interaction.reply(`✅ Последний варн снят с **${member.displayName}**. Осталось: ${newWarns.length}`);
}

async function cmdGiveSlash(interaction, member, type, amount) {
  if (!interaction.member.permissions.has('ManageGuild')) {
    return interaction.reply({ content: '❌ Нет прав', ephemeral: true });
  }
  if (!type || !amount) return interaction.reply({ content: '❌ Использование: /give user:[user] type:[xp|coins|elo] amount:[number]', ephemeral: true });
  const user = await getUser(member.id);
  if (!user) return interaction.reply({ content: '❌ Профиль не найден', ephemeral: true });

  let updates = {};
  let logType = '';
  if (type === 'xp') {
    const newXp = (user.xp || 0) + amount;
    updates = { xp: newXp, level: getLevelByXp(newXp) };
    logType = 'xp';
  } else if (type === 'coins') {
    updates = { currency: admin.firestore.FieldValue.increment(amount) };
    logType = 'coins';
  } else if (type === 'elo') {
    const newElo = Math.max(1, (user.elo || 1000) + amount);
    const newRank = getRankByElo(newElo);
    updates = { elo: newElo, rank: newRank.id, rankName: newRank.name, rankColor: newRank.color };
    logType = 'elo';
  } else {
    return interaction.reply({ content: '❌ Тип: xp|coins|elo', ephemeral: true });
  }
  await updateUser(member.id, updates);
  await writeLog(logType, member.user.username, `${amount > 0 ? '+' : ''}${amount}`, 'Ручная выдача', interaction.user.username);
  await interaction.reply(`✅ ${member.displayName} +${amount} ${type}`);
}

async function cmdAchievSlash(interaction, member, achId) {
  if (!interaction.member.permissions.has('ManageGuild')) {
    return interaction.reply({ content: '❌ Нет прав', ephemeral: true });
  }
  await grantAchievement(member.id, achId, { guild: interaction.guild, byAdmin: interaction.user.username });
  await interaction.reply(`✅ Ачивка **${achId}** выдана **${member.displayName}**`);
}

async function cmdHelpSlash(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Помощь по командам')
    .setDescription('`!profile` `!rank` `!top` `!daily` и другие...');
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = { handleCommand, handleSlashCommand };