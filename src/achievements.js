// src/achievements.js — система автоматических ачивок

const { admin, getUser, updateUser, getConfig, writeLog, sendNotification } = require('./firebase');

// ── Список автоматических ачивок ─────────────────────────────
// trigger: тип события ('message_count','level','voice_minutes','purchase','join_days')
// value:   пороговое значение
// ──────────────────────────────────────────────────────────────
const AUTO_ACHIEVEMENTS = [
  // Сообщения
  { id: 'first_message',    title: 'Первое слово',        icon: '💬', trigger: 'message_count', value: 100,    desc: 'Набрать 100 XP за сообщения' },
  { id: 'chatter',          title: 'Болтун',              icon: '🗣️', trigger: 'message_count', value: 500,    desc: 'Набрать 500 XP за сообщения' },
  { id: 'big_mouth',        title: 'Оратор',              icon: '📢', trigger: 'message_count', value: 2000,   desc: 'Набрать 2000 XP за сообщения' },

  // Уровни
  { id: 'first_step',       title: 'Первый шаг',          icon: '👣', trigger: 'level', value: 1,    desc: 'Достичь 1 уровня' },
  { id: 'level5',           title: 'Новобранец',          icon: '🔰', trigger: 'level', value: 5,    desc: 'Достичь 5 уровня' },
  { id: 'level10',          title: 'Опытный',             icon: '⚡', trigger: 'level', value: 10,   desc: 'Достичь 10 уровня' },
  { id: 'level25',          title: 'Ветеран',             icon: '🎖️', trigger: 'level', value: 25,   desc: 'Достичь 25 уровня' },
  { id: 'level50',          title: 'Легенда сквада',      icon: '🌟', trigger: 'level', value: 50,   desc: 'Достичь 50 уровня' },
  { id: 'level100',         title: 'Непоколебимый',       icon: '💎', trigger: 'level', value: 100,  desc: 'Достичь 100 уровня' },

  // Голосовые
  { id: 'voice_30',         title: 'Тихоня',              icon: '🎧', trigger: 'voice_minutes', value: 30,    desc: '30 минут в голосовых' },
  { id: 'voice_marathon',   title: 'Голосовой марафон',   icon: '🎙️', trigger: 'voice_minutes', value: 300,   desc: '300 минут в голосовых' },
  { id: 'voice_addict',     title: 'Голосоман',           icon: '📡', trigger: 'voice_minutes', value: 1000,  desc: '1000 минут в голосовых' },
  { id: 'voice_legend',     title: 'Вещатель',            icon: '📻', trigger: 'voice_minutes', value: 5000,  desc: '5000 минут в голосовых' },

  // Покупки в магазине
  { id: 'first_purchase',   title: 'Первая покупка',      icon: '🛒', trigger: 'purchase', value: 1,   desc: 'Совершить первую покупку в магазине' },
  { id: 'shopaholic',       title: 'Шопоголик',           icon: '💸', trigger: 'purchase', value: 5,   desc: 'Совершить 5 покупок в магазине' },

  // Стаж
  { id: 'joined',           title: 'Добро пожаловать',    icon: '🎉', trigger: 'join_days', value: 1,   desc: 'Зарегистрироваться' },
  { id: 'week',             title: 'Неделя в скваде',     icon: '📅', trigger: 'join_days', value: 7,   desc: '7 дней в сообществе' },
  { id: 'month',            title: 'Месяц с нами',        icon: '🗓️', trigger: 'join_days', value: 30,  desc: '30 дней в сообществе' },
  { id: 'veteran',          title: 'Ветеран',             icon: '🏅', trigger: 'join_days', value: 180, desc: '180 дней в сообществе' },
  { id: 'year',             title: 'Год в скваде',        icon: '🎂', trigger: 'join_days', value: 365, desc: '365 дней в сообществе' },

  // Ивенты
  { id: 'first_event',      title: 'Участник',            icon: '🎮', trigger: 'events', value: 1,  desc: 'Участвовать в первом ивенте' },
  { id: 'event5',           title: 'Турнирщик',           icon: '🏆', trigger: 'events', value: 5,  desc: 'Участвовать в 5 ивентах' },
  { id: 'event_winner',     title: 'Победитель',          icon: '🥇', trigger: 'event_win', value: 1, desc: 'Победить в ивенте' },
  { id: 'triple_win',       title: 'Хет-трик',            icon: '🎯', trigger: 'event_win', value: 3, desc: 'Победить в 3 ивентах' },

  // Ночная сова / Жаворонок (UTC+3)
  { id: 'night_owl',        title: 'Ночная сова',         icon: '🦉', trigger: 'hour_night', value: 1, desc: 'Написать сообщение между 2:00 и 5:00 МСК' },
  { id: 'early_bird',       title: 'Жаворонок',           icon: '🌅', trigger: 'hour_morning', value: 1, desc: 'Написать сообщение между 6:00 и 7:00 МСК' },
];

/**
 * Проверить ачивки для пользователя
 * @param {string} discordId
 * @param {{ type: string, value: number, guild?: object }} context
 */
async function checkAchievements(discordId, context) {
  const user   = await getUser(discordId);
  const config = await getConfig();
  if (!user) return;

  const earned = user.achievements || [];

  // Подходящие ачивки для данного trigger
  const candidates = AUTO_ACHIEVEMENTS.filter(a => {
    if (earned.includes(a.id)) return false;       // Уже есть
    if (a.trigger !== context.type) return false;  // Не тот тип
    return context.value >= a.value;               // Порог достигнут
  });

  for (const ach of candidates) {
    await grantAchievement(discordId, ach.id, { user, config, guild: context.guild });
  }
}

/**
 * Выдать ачивку (авто или ручная)
 * @param {string} discordId
 * @param {string} achievementId
 * @param {{ user, config, guild, byAdmin }} opts
 */
async function grantAchievement(discordId, achievementId, opts = {}) {
  const { user: u, guild, byAdmin } = opts;
  const user   = u || await getUser(discordId);
  const config = opts.config || await getConfig();
  if (!user) return;

  // Не давать повторно
  if ((user.achievements || []).includes(achievementId)) return;

  const achDef = AUTO_ACHIEVEMENTS.find(a => a.id === achievementId) || { id: achievementId, title: achievementId };

  // Начислить бонус за ачивку
  const bonus = config.achievementBonus || 50;

  await updateUser(discordId, {
    achievements: admin.firestore.FieldValue.arrayUnion(achievementId),
    currency:     admin.firestore.FieldValue.increment(bonus),
  });

  // Уведомление
  await sendNotification(discordId, {
    type:    'achievement',
    title:   `🏅 Ачивка: ${achDef.icon || '🏅'} ${achDef.title || achievementId}`,
    message: `${achDef.desc || ''}  (+${bonus} монет)`,
  });

  // DM в Discord
  if (guild) {
    try {
      const member = await guild.members.fetch(discordId);
      await member.send(
        `🏅 **Новая ачивка: ${achDef.icon || ''} ${achDef.title || achievementId}**\n` +
        `${achDef.desc || ''}\n+${bonus} монет начислено!`
      );
    } catch {}
  }

  await writeLog(
    'achievement',
    user.username,
    `+ ${achDef.title || achievementId}`,
    byAdmin ? 'Ручная выдача' : 'Автоматически',
    byAdmin || 'Система'
  );

  console.log(`[🏅] ${user.username} получил ачивку: ${achDef.title || achievementId}`);
}

/**
 * Проверить ачивки за стаж (вызывать раз в сутки)
 */
async function checkJoinDayAchievements(member) {
  const user = await getUser(member.id);
  if (!user || !user.createdAt) return;

  const createdAt = user.createdAt.toDate?.() || new Date(user.createdAt);
  const days      = Math.floor((Date.now() - createdAt) / 86_400_000);

  await checkAchievements(member.id, { type: 'join_days', value: days, guild: member.guild });
}

/**
 * Проверить ачивки за ночное/утреннее время (MSK = UTC+3)
 */
async function checkTimeAchievements(discordId, guild) {
  const hourMsk = (new Date().getUTCHours() + 3) % 24;
  if (hourMsk >= 2 && hourMsk < 5) {
    await checkAchievements(discordId, { type: 'hour_night', value: 1, guild });
  }
  if (hourMsk >= 6 && hourMsk < 7) {
    await checkAchievements(discordId, { type: 'hour_morning', value: 1, guild });
  }
}

module.exports = { AUTO_ACHIEVEMENTS, checkAchievements, grantAchievement, checkJoinDayAchievements, checkTimeAchievements };
