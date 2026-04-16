// src/xp.js — начисление XP, валюты, уровней

const { admin, getUser, updateUser, getConfig, writeLog, sendNotification } = require('./firebase');
const { getRankByElo, getLevelByXp } = require('./ranks');
const { checkAchievements } = require('./achievements');

// Кулдаун сообщений: discordId → timestamp последнего XP
const messageCooldowns = new Map();

// ── Применить глобальный и личный множитель XP ──────────────
async function applyMultipliers(baseXp, user, config) {
  let multiplier = 1;

  // Личный множитель (купленный Double/Triple XP)
  if (user.xpMultiplier && user.xpMultiplier > 1) {
    if (!user.xpMultiplierExpiresAt || new Date(user.xpMultiplierExpiresAt) > new Date()) {
      multiplier *= user.xpMultiplier;
    } else {
      // Истёк — сбросить
      await updateUser(user.discordId, { xpMultiplier: 1, xpMultiplierExpiresAt: null });
    }
  }

  // Глобальный множитель (из config)
  if (config.globalXpMultiplier > 1) {
    if (!config.globalXpMultiplierExpiresAt || new Date(config.globalXpMultiplierExpiresAt) > new Date()) {
      multiplier *= config.globalXpMultiplier;
    }
  }

  return Math.round(baseXp * multiplier);
}

// ── Начислить XP и валюту ────────────────────────────────────
async function addXpAndCurrency(discordId, { xpBase, currencyBase, reason, guild }) {
  const user   = await getUser(discordId);
  const config = await getConfig();
  if (!user) return;

  const xpGain       = await applyMultipliers(xpBase, user, config);
  const currencyGain = currencyBase;

  const newXp       = (user.xp       || 0) + xpGain;
  const newCurrency = (user.currency || 0) + currencyGain;
  const oldLevel    = getLevelByXp(user.xp || 0);
  const newLevel    = getLevelByXp(newXp);

  const updates = { xp: newXp, currency: newCurrency };

  // Повышение уровня
  if (newLevel > oldLevel) {
    updates.level = newLevel;
    // Монеты за повышение уровня = level * 10
    const levelBonus = newLevel * (config.levelUpMultiplier || 10);
    updates.currency = newCurrency + levelBonus;

    console.log(`[XP] ${user.username} → Уровень ${newLevel}! +${levelBonus} монет`);

    // Уведомление
    await sendNotification(discordId, {
      type:    'level_up',
      title:   `🆙 Уровень ${newLevel}!`,
      message: `Поздравляем! Вы достигли уровня ${newLevel}. Начислено ${levelBonus} монет.`,
    });

    // Проверить ачивки на уровни
    await checkAchievements(discordId, { type: 'level', value: newLevel, guild });
  }

  await updateUser(discordId, updates);

  if (xpGain > 0) {
    console.log(`[XP] ${user.username} +${xpGain} XP +${currencyGain} монет (${reason})`);
  }

  return { xpGain, currencyGain, newLevel, levelUp: newLevel > oldLevel };
}

// ── XP за сообщение (кулдаун 1 минута) ──────────────────────
async function handleMessageXp(member) {
  const now      = Date.now();
  const lastTime = messageCooldowns.get(member.id) || 0;

  if (now - lastTime < 60_000) return; // Кулдаун не истёк
  messageCooldowns.set(member.id, now);

  const config = await getConfig();

  await addXpAndCurrency(member.id, {
    xpBase:       config.xpPerMessage       || 1,
    currencyBase: config.currencyPerMessage || 1,
    reason:       'message',
    guild:        member.guild,
  });

  // Ачивки за сообщения
  const user = await getUser(member.id);
  if (user) {
    await checkAchievements(member.id, { type: 'message_count', value: user.xp, guild: member.guild });
  }
}

// ── XP за голосовой чат (вызывается каждую минуту) ──────────
// voiceMembers — Map<discordId, { joinedAt, minutesAccrued }>
const voiceTracking = new Map();

function startVoiceTracking(member) {
  voiceTracking.set(member.id, { joinedAt: Date.now(), minutes: 0 });
}

function stopVoiceTracking(member) {
  voiceTracking.delete(member.id);
}

async function tickVoiceXp(guild) {
  if (!guild) return;
  const config = await getConfig();

  for (const [memberId, data] of voiceTracking.entries()) {
    // Найти участника в войсе
    let member;
    try {
      member = await guild.members.fetch(memberId);
    } catch { voiceTracking.delete(memberId); continue; }

    const voiceState = member.voice;
    if (!voiceState?.channel) { voiceTracking.delete(memberId); continue; }

    const channel = voiceState.channel;

    // Условия для начисления XP:
    const afkChannelId   = process.env.AFK_CHANNEL_ID;
    const isAfk          = channel.id === afkChannelId;
    const isSelfMuted    = voiceState.selfMute || voiceState.serverMute;
    const isSelfDeafened = voiceState.selfDeaf || voiceState.serverDeaf;
    const usersInChannel = channel.members.filter(m => !m.user.bot).size;
    const minUsers       = config.minUsersInVoice || 2;
    const requireMic     = config.requireMic !== false;

    if (isAfk)                             continue;
    if (usersInChannel < minUsers)         continue;
    if (requireMic && isSelfMuted)         continue;
    if (isSelfDeafened)                    continue;

    data.minutes++;

    // Обновить totalVoiceMinutes каждую минуту
    await updateUser(memberId, {
      totalVoiceMinutes: admin.firestore.FieldValue.increment(1),
    });

    // Начислять XP каждые 10 минут
    if (data.minutes % 10 === 0) {
      await addXpAndCurrency(memberId, {
        xpBase:       config.xpPer10MinVoice   || 5,
        currencyBase: config.currencyPer10Min  || 5,
        reason:       'voice_10min',
        guild,
      });

      // Ачивки за голосовой
      const user = await getUser(memberId);
      if (user) {
        await checkAchievements(memberId, {
          type:  'voice_minutes',
          value: user.totalVoiceMinutes || 0,
          guild,
        });
      }
    }
  }
}

// ── Ежедневный бонус ─────────────────────────────────────────
const DAILY_KEY = 'lastDailyBonus';

async function claimDailyBonus(discordId) {
  const user   = await getUser(discordId);
  const config = await getConfig();
  if (!user) return { ok: false, reason: 'Профиль не найден' };

  const now      = new Date();
  const lastClaim = user[DAILY_KEY]?.toDate?.() || null;

  if (lastClaim) {
    const diffHours = (now - lastClaim) / 3_600_000;
    if (diffHours < 24) {
      const nextIn = Math.ceil(24 - diffHours);
      return { ok: false, reason: `Уже забрано. Следующий бонус через ~${nextIn}ч` };
    }
  }

  const bonus = config.dailyBonus || 25;
  await updateUser(discordId, {
    currency:   admin.firestore.FieldValue.increment(bonus),
    lastDailyBonus: admin.firestore.FieldValue.serverTimestamp(),
  });

  await writeLog('daily_bonus', user.username, `+${bonus} монет`, 'ежедневный бонус', 'Система');
  return { ok: true, bonus };
}

module.exports = {
  addXpAndCurrency,
  handleMessageXp,
  startVoiceTracking,
  stopVoiceTracking,
  tickVoiceXp,
  claimDailyBonus,
};
