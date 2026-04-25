// src/index.js — Gray Squad Discord Bot
// Точка входа

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
} = require('discord.js');

const { db, getOrCreateUser, updateUser, getConfig, writeLog } = require('./firebase');
const { admin }        = require('./firebase');
const { getRankByElo, getLevelByXp } = require('./ranks');
const { handleMessageXp, startVoiceTracking, stopVoiceTracking, tickVoiceXp } = require('./xp');
const { handleCommand }  = require('./commands');
const { listenToPurchases } = require('./shop');
const { checkJoinDayAchievements, checkTimeAchievements } = require('./achievements');
const express = require('express');

// ── Создать клиент ────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

// Ссылка на основной сервер (кешируется после ready)
let mainGuild = null;

// ─────────────────────────────────────────────────────────────
// READY
// ─────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║  Gray Squad Bot  ·  Online ✅     ║`);
  console.log(`╚══════════════════════════════════╝`);
  console.log(`Авторизован как: ${client.user.tag}`);

  // Установить статус бота
  client.user.setActivity('Gray Squad · graysquad.fun', { type: ActivityType.Watching });

  // Получить основной сервер
  mainGuild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!mainGuild) {
    console.error(`❌ Сервер с ID ${process.env.GUILD_ID} не найден!`);
    console.error('Проверьте GUILD_ID в .env и убедитесь что бот добавлен на сервер.');
    return;
  }
  console.log(`Сервер: ${mainGuild.name} (${mainGuild.memberCount} участников)`);

  // Авто-создать профили всех участников
  await syncAllMembers(mainGuild);

  // Инициализировать слежку за голосовыми (кто уже в войсе)
  initVoiceTracking(mainGuild);

  // Слушать покупки из магазина
  listenToPurchases(mainGuild);

  // ── Интервалы ─────────────────────────────────────────────

  // Голосовые XP — каждые 60 секунд
  setInterval(() => tickVoiceXp(mainGuild), 60_000);

  // Виджет «Сейчас в голосовых» — каждые 30 секунд
  setInterval(() => updateVoicePresence(mainGuild), 30_000);
  updateVoicePresence(mainGuild); // сразу при старте

  // Проверка глобального XP-буста — каждую минуту
  setInterval(() => checkGlobalBoostExpiry(), 60_000);

  // Ежесуточные задачи — каждые 24 часа
  setInterval(() => dailyTasks(mainGuild), 24 * 60 * 60_000);
  // Запустить сразу
  dailyTasks(mainGuild);

  console.log('\n[✓] Все интервалы запущены\n');
});

// ─────────────────────────────────────────────────────────────
// СЛЕШ-КОМАНДЫ
// ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.guildId !== process.env.GUILD_ID) return;

  const { commandName, options } = interaction;

  // Импортируем функции обработки команд
  const { handleSlashCommand } = require('./commands');

  try {
    await handleSlashCommand(interaction, commandName, options);
  } catch (error) {
    console.error(error);
    await interaction.reply({ content: '❌ Ошибка при выполнении команды', ephemeral: true });
  }
});

// ─────────────────────────────────────────────────────────────
// СООБЩЕНИЯ (префиксные команды !)
// ─────────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild || message.guild.id !== process.env.GUILD_ID) return;

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;

  // Создать профиль если нет
  await getOrCreateUser(member);

  // XP за сообщение (с кулдауном 1 мин)
  await handleMessageXp(member);

  // Ачивки за время суток
  await checkTimeAchievements(member.id, message.guild);

  // Команды (!sync, !daily и т.д.)
  if (message.content.startsWith('!')) {
    await handleCommand(message).catch(e => console.error('[Command]', e));
  }
});

// ─────────────────────────────────────────────────────────────
// ГОЛОСОВЫЕ КАНАЛЫ
// ─────────────────────────────────────────────────────────────
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (newState.guild.id !== process.env.GUILD_ID) return;

  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const joinedChannel = !oldState.channel && newState.channel;
  const leftChannel   = oldState.channel && !newState.channel;
  const switched      = oldState.channel && newState.channel && oldState.channelId !== newState.channelId;

  if (joinedChannel) {
    await getOrCreateUser(member);
    startVoiceTracking(member);
    console.log(`[🎙️] ${member.user.username} → ${newState.channel.name}`);
  }

  if (leftChannel) {
    stopVoiceTracking(member);
    console.log(`[🔇] ${member.user.username} ← покинул войс`);
    // Обновить виджет при изменениях
    await updateVoicePresence(member.guild);
  }

  if (switched) {
    console.log(`[🔀] ${member.user.username}: ${oldState.channel.name} → ${newState.channel.name}`);
    await updateVoicePresence(member.guild);
  }
});

// ─────────────────────────────────────────────────────────────
// НОВЫЙ УЧАСТНИК
// ─────────────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== process.env.GUILD_ID) return;
  if (member.user.bot) return;

  const user = await getOrCreateUser(member);
  console.log(`[👋] Новый участник: ${member.user.username}`);

  // Ачивка «Добро пожаловать»
  const { checkAchievements } = require('./achievements');
  await checkAchievements(member.id, { type: 'join_days', value: 1, guild: member.guild });
});

// ─────────────────────────────────────────────────────────────
// УЧАСТНИК ВЫШЕЛ
// ─────────────────────────────────────────────────────────────
client.on('guildMemberRemove', async (member) => {
  if (member.guild.id !== process.env.GUILD_ID) return;
  stopVoiceTracking(member);
  console.log(`[👋] Участник вышел: ${member.user.username}`);
});

// ─────────────────────────────────────────────────────────────
// СИНХРОНИЗАЦИЯ ВСЕХ УЧАСТНИКОВ
// ─────────────────────────────────────────────────────────────
async function syncAllMembers(guild) {
  console.log('[🔄] Синхронизация всех участников...');
  try {
    const members = await guild.members.fetch();
    let created = 0;

    const memberRoleId = process.env.MEMBER_ROLE_ID;

    for (const [, member] of members) {
      if (member.user.bot) continue;

      const existing = await require('./firebase').getUser(member.id);
      if (!existing) {
        const newUser = await getOrCreateUser(member);
        // Если у участника есть роль Member на Discord — сразу выдать role=member
        if (memberRoleId && member.roles.cache.has(memberRoleId)) {
          await updateUser(member.id, { role: 'member' });
        }
        created++;
      } else {
        // Обновить аватар и ник при каждом запуске
        const updates = {
          username:    member.user.username,
          displayName: member.displayName,
          avatarUrl:   member.user.displayAvatarURL({ size: 64, extension: 'png' }),
        };
        if (memberRoleId && member.roles.cache.has(memberRoleId) && existing.role === 'user') {
          updates.role = 'member';
        }
        await updateUser(member.id, updates);
      }
    }

    console.log(`[✓] Синхронизировано: ${members.size - 1} участников, создано ${created} новых профилей`);
  } catch (e) {
    console.error('[syncAllMembers]', e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// ИНИЦИАЛИЗИРОВАТЬ TRACKING ДЛЯ ТЕХ КТО УЖЕ В ВОЙСЕ
// ─────────────────────────────────────────────────────────────
function initVoiceTracking(guild) {
  guild.voiceStates.cache.forEach(vs => {
    if (vs.channel && vs.member && !vs.member.user.bot) {
      startVoiceTracking(vs.member);
    }
  });
  console.log('[🎙️] Voice tracking инициализирован');
}

// ─────────────────────────────────────────────────────────────
// ВИДЖЕТ «СЕЙЧАС В ГОЛОСОВЫХ»
// Обновляет документ voicePresence/main в Firestore
// ─────────────────────────────────────────────────────────────
async function updateVoicePresence(guild) {
  try {
    const voiceChannels = guild.channels.cache.filter(c => c.type === 2); // VoiceChannel
    const users         = [];

    for (const [, channel] of voiceChannels) {
      if (channel.id === process.env.AFK_CHANNEL_ID) continue;

      for (const [, member] of channel.members) {
        if (member.user.bot) continue;
        users.push({
          discordId:   member.id,
          username:    member.user.username,
          displayName: member.displayName,
          avatarUrl:   member.user.displayAvatarURL({ size: 32, extension: 'png' }),
          channelName: channel.name,
          selfMuted:   member.voice.selfMute || member.voice.serverMute || false,
          selfDeafed:  member.voice.selfDeaf || member.voice.serverDeaf || false,
        });
      }
    }

    await db.collection('voicePresence').doc('main').set({
      users,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error('[voicePresence]', e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// ПРОВЕРКА ИСТЕЧЕНИЯ ГЛОБАЛЬНОГО XP-БУСТА
// ─────────────────────────────────────────────────────────────
async function checkGlobalBoostExpiry() {
  try {
    const config = await getConfig();
    if (!config.globalXpMultiplierExpiresAt) return;

    const expiresAt = new Date(config.globalXpMultiplierExpiresAt);
    if (expiresAt <= new Date()) {
      await db.collection('config').doc('main').update({
        globalXpMultiplier:          1,
        globalXpMultiplierExpiresAt: null,
      });
      console.log('[⚡] Глобальный XP-буст истёк, сброшен');
    }
  } catch (e) {
    console.error('[checkGlobalBoost]', e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// ЕЖЕСУТОЧНЫЕ ЗАДАЧИ
// ─────────────────────────────────────────────────────────────
async function dailyTasks(guild) {
  console.log('[📅] Запуск ежесуточных задач...');
  try {
    const members = await guild.members.fetch();
    for (const [, member] of members) {
      if (member.user.bot) continue;
      await checkJoinDayAchievements(member).catch(() => {});
    }
    console.log('[📅] Ежесуточные задачи завершены');
  } catch (e) {
    console.error('[dailyTasks]', e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// ОБРАБОТКА ОШИБОК
// ─────────────────────────────────────────────────────────────
client.on('error',   e => console.error('[Discord Error]', e));
client.on('warn',    w => console.warn('[Discord Warn]', w));

process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────
// ЗАПУСК
// ─────────────────────────────────────────────────────────────
const token = process.env.DISCORD_TOKEN;
if (!token || token.startsWith('TODO')) {
  console.error('❌ DISCORD_TOKEN не задан в .env!');
  process.exit(1);
}

// ── ПРОСТОЙ HTTP-СЕРВЕР ДЛЯ UPTIMEROBOT ──
const httpPort = process.env.PORT || 3000;
const httpApp = express();

// ── CORS — разрешаем запросы с сайта ──────────────────────────
const ALLOWED_ORIGINS = [
  'https://graysquad.fun',
  'https://www.graysquad.fun',
  'https://gray-squad.web.app',
  'https://gray-squad-c667e.web.app',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
];
httpApp.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

httpApp.use(express.json());

httpApp.get('/', (req, res) => {
  res.send('Gray Squad Bot is alive!');
});

// ── Эндпоинт авторизации Discord → данные пользователя ──────
httpApp.post('/auth/token', async (req, res) => {
  const { code, redirect_uri } = req.body;
  if (!code) return res.status(400).json({ error: 'Нет кода авторизации' });

  const CLIENT_ID      = process.env.DISCORD_CLIENT_ID;
  const CLIENT_SECRET  = process.env.DISCORD_CLIENT_SECRET;
  const BOT_TOKEN      = process.env.DISCORD_TOKEN;
  const GUILD_ID       = process.env.GUILD_ID;
  const MEMBER_ROLE_ID = process.env.MEMBER_ROLE_ID;

  try {
    // 1. Обмен кода на токен
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.status(400).json({ error: tokenData.error_description || tokenData.error });

    // 2. Данные пользователя Discord
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const discordUser = await userRes.json();

    // 3. Ник и роли с сервера
    let displayName  = discordUser.global_name || discordUser.username;
    let discordRoles = [];
    let memberRole   = 'user';

    try {
      const memberRes = await fetch(`https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (memberRes.ok) {
        const memberData = await memberRes.json();
        if (memberData.nick) displayName = memberData.nick;

        const guildRes = await fetch(`https://discord.com/api/guilds/${GUILD_ID}/roles`, {
          headers: { Authorization: `Bot ${BOT_TOKEN}` },
        });
        if (guildRes.ok) {
          const allRoles = await guildRes.json();
          const roleMap  = Object.fromEntries(allRoles.map(r => [r.id, r]));
          discordRoles   = (memberData.roles || [])
            .map(id => roleMap[id])
            .filter(Boolean)
            .map(r => ({ id: r.id, name: r.name, color: r.color ? '#' + r.color.toString(16).padStart(6, '0') : '#888888' }));
          if (MEMBER_ROLE_ID && memberData.roles.includes(MEMBER_ROLE_ID)) memberRole = 'member';
        }
      }
    } catch (guildErr) {
      console.warn('[auth] Guild fetch failed:', guildErr.message);
    }

    // 4. Создать/обновить профиль в Firestore
    const { db, getUser, updateUser } = require('./firebase');
    const { admin } = require('./firebase');
    const userRef  = db.collection('users').doc(discordUser.id);
    const existing = await userRef.get();
    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=64`
      : null;

    if (!existing.exists) {
      await userRef.set({
        discordId: discordUser.id, username: discordUser.username,
        displayName, avatarUrl, role: memberRole,
        elo: 500, rank: 0, rankName: 'Калибровка', rankColor: '#6c757d',
        currency: 0, level: 0, xp: 0, totalVoiceMinutes: 0,
        xpMultiplier: 1, xpMultiplierExpiresAt: null,
        achievements: [], warnings: [],
        forumBanExpiresAt: null, canCreateEvents: false,
        customColor: null, title: null, discordRoles,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      const upd = { username: discordUser.username, displayName, avatarUrl, discordRoles };
      if (existing.data().role === 'user' && memberRole === 'member') upd.role = 'member';
      await userRef.update(upd);
    }

    const snap = await userRef.get();
    const user = { id: discordUser.id, ...snap.data() };

    return res.json({ ok: true, user });

  } catch (e) {
    console.error('[auth/token]', e);
    return res.status(500).json({ error: e.message });
  }
});

httpApp.listen(httpPort, () => {
  console.log(`✅ HTTP сервер запущен на порту ${httpPort}`);
});

client.login(token).catch(e => {
  console.error('❌ Ошибка авторизации бота:', e.message);
  process.exit(1);
});
