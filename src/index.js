// src/index.js — Gray Squad Discord Bot
// Точка входа

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
} = require('discord.js');
const express = require('express');
const { db, getOrCreateUser, updateUser, getConfig, writeLog } = require('./firebase');
const { admin } = require('./firebase');
const { getRankByElo, getLevelByXp } = require('./ranks');
const { handleMessageXp, startVoiceTracking, stopVoiceTracking, tickVoiceXp } = require('./xp');
const { handleCommand } = require('./commands');
const { listenToPurchases } = require('./shop');
const { checkJoinDayAchievements, checkTimeAchievements } = require('./achievements');

// ── HTTP сервер (для UptimeRobot и OAuth) ──
const httpApp = express();
httpApp.use(express.json()); // для обработки POST запросов
const httpPort = process.env.PORT || 3000;

// Эндпоинт для обмена кода на токен (авторизация на сайте)
httpApp.post('/auth/token', async (req, res) => {
  const { code, redirect_uri } = req.body;
  if (!code) {
    return res.status(400).json({ ok: false, error: 'No code provided' });
  }

  try {
    // 1. Обмен кода на access_token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirect_uri || 'https://graysquad.fun/callback.html',
      }),
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      console.error('Token exchange error:', tokenData);
      return res.status(400).json({ ok: false, error: tokenData.error_description || 'Token exchange failed' });
    }

    // 2. Получение данных пользователя
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const discordUser = await userRes.json();

    // 3. Получение данных участника на сервере (ник, роли)
    let displayName = discordUser.global_name || discordUser.username;
    let memberRole = 'user';
    try {
      const memberRes = await fetch(`https://discord.com/api/users/@me/guilds/${process.env.GUILD_ID}/member`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (memberRes.ok) {
        const memberData = await memberRes.json();
        if (memberData.nick) displayName = memberData.nick;
        if (memberData.roles && memberData.roles.includes(process.env.MEMBER_ROLE_ID)) {
          memberRole = 'member';
        }
      }
    } catch (err) {
      console.warn('Failed to fetch guild member:', err.message);
    }

    // 4. Сохранение/обновление в Firestore
    const userRef = db.collection('users').doc(discordUser.id);
    const userData = {
      discordId: discordUser.id,
      username: discordUser.username,
      displayName: displayName,
      avatarUrl: discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=64`
        : null,
      role: memberRole,
      elo: 500,
      level: 0,
      xp: 0,
      currency: 0,
      achievements: [],
      lastLogin: admin.firestore.FieldValue.serverTimestamp(),
    };

    const snap = await userRef.get();
    if (!snap.exists) {
      userData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      await userRef.set(userData);
    } else {
      await userRef.update({
        username: discordUser.username,
        displayName: displayName,
        avatarUrl: userData.avatarUrl,
        lastLogin: admin.firestore.FieldValue.serverTimestamp(),
      });
      // Объединяем с существующими данными
      Object.assign(userData, snap.data());
    }

    // Отправляем пользователя обратно на сайт
    res.json({ ok: true, user: userData });
  } catch (error) {
    console.error('Auth token error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Эндпоинт для проверки работы (UptimeRobot)
httpApp.get('/', (req, res) => {
  res.send('Bot is alive!');
});

httpApp.listen(httpPort, () => {
  console.log(`✅ HTTP сервер запущен на порту ${httpPort}`);
});

// ── Discord клиент ────────────────────────────────────────────
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

let mainGuild = null;

// ─────────────────────────────────────────────────────────────
// READY
// ─────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║  Gray Squad Bot  ·  Online ✅     ║`);
  console.log(`╚══════════════════════════════════╝`);
  console.log(`Авторизован как: ${client.user.tag}`);

  client.user.setActivity('Gray Squad · graysquad.fun', { type: ActivityType.Watching });

  mainGuild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!mainGuild) {
    console.error(`❌ Сервер с ID ${process.env.GUILD_ID} не найден!`);
    return;
  }
  console.log(`Сервер: ${mainGuild.name} (${mainGuild.memberCount} участников)`);

  await syncAllMembers(mainGuild);
  initVoiceTracking(mainGuild);
  listenToPurchases(mainGuild);

  setInterval(() => tickVoiceXp(mainGuild), 60_000);
  setInterval(() => updateVoicePresence(mainGuild), 30_000);
  updateVoicePresence(mainGuild);
  setInterval(() => checkGlobalBoostExpiry(), 60_000);
  setInterval(() => dailyTasks(mainGuild), 24 * 60 * 60_000);
  dailyTasks(mainGuild);

  console.log('\n[✓] Все интервалы запущены\n');
});

// ── Слеш-команды ──
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.guildId !== process.env.GUILD_ID) return;

  const { commandName, options } = interaction;
  const { handleSlashCommand } = require('./commands');

  try {
    await handleSlashCommand(interaction, commandName, options);
  } catch (error) {
    console.error(error);
    await interaction.reply({ content: '❌ Ошибка при выполнении команды', ephemeral: true });
  }
});

// ── Сообщения (префиксные команды) ──
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild || message.guild.id !== process.env.GUILD_ID) return;

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;

  await getOrCreateUser(member);
  await handleMessageXp(member);
  await checkTimeAchievements(member.id, message.guild);

  if (message.content.startsWith('!')) {
    await handleCommand(message).catch(e => console.error('[Command]', e));
  }
});

// ── Голосовые каналы ──
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (newState.guild.id !== process.env.GUILD_ID) return;

  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const joinedChannel = !oldState.channel && newState.channel;
  const leftChannel = oldState.channel && !newState.channel;
  const switched = oldState.channel && newState.channel && oldState.channelId !== newState.channelId;

  if (joinedChannel) {
    await getOrCreateUser(member);
    startVoiceTracking(member);
    console.log(`[🎙️] ${member.user.username} → ${newState.channel.name}`);
  }

  if (leftChannel) {
    stopVoiceTracking(member);
    console.log(`[🔇] ${member.user.username} ← покинул войс`);
    await updateVoicePresence(member.guild);
  }

  if (switched) {
    console.log(`[🔀] ${member.user.username}: ${oldState.channel.name} → ${newState.channel.name}`);
    await updateVoicePresence(member.guild);
  }
});

// ── Новый участник ──
client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== process.env.GUILD_ID) return;
  if (member.user.bot) return;

  await getOrCreateUser(member);
  console.log(`[👋] Новый участник: ${member.user.username}`);

  const { checkAchievements } = require('./achievements');
  await checkAchievements(member.id, { type: 'join_days', value: 1, guild: member.guild });
});

// ── Участник вышел ──
client.on('guildMemberRemove', async (member) => {
  if (member.guild.id !== process.env.GUILD_ID) return;
  stopVoiceTracking(member);
  console.log(`[👋] Участник вышел: ${member.user.username}`);
});

// ── Синхронизация всех участников ──
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
        await getOrCreateUser(member);
        if (memberRoleId && member.roles.cache.has(memberRoleId)) {
          await updateUser(member.id, { role: 'member' });
        }
        created++;
      } else {
        const updates = {
          username: member.user.username,
          displayName: member.displayName,
          avatarUrl: member.user.displayAvatarURL({ size: 64, extension: 'png' }),
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

// ── Инициализация отслеживания голосовых ──
function initVoiceTracking(guild) {
  guild.voiceStates.cache.forEach(vs => {
    if (vs.channel && vs.member && !vs.member.user.bot) {
      startVoiceTracking(vs.member);
    }
  });
  console.log('[🎙️] Voice tracking инициализирован');
}

// ── Виджет «Сейчас в голосовых» ──
async function updateVoicePresence(guild) {
  try {
    const voiceChannels = guild.channels.cache.filter(c => c.type === 2);
    const users = [];

    for (const [, channel] of voiceChannels) {
      if (channel.id === process.env.AFK_CHANNEL_ID) continue;
      for (const [, member] of channel.members) {
        if (member.user.bot) continue;
        users.push({
          discordId: member.id,
          username: member.user.username,
          displayName: member.displayName,
          avatarUrl: member.user.displayAvatarURL({ size: 32, extension: 'png' }),
          channelName: channel.name,
          selfMuted: member.voice.selfMute || member.voice.serverMute || false,
          selfDeafed: member.voice.selfDeaf || member.voice.serverDeaf || false,
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

// ── Проверка истечения глобального XP-буста ──
async function checkGlobalBoostExpiry() {
  try {
    const config = await getConfig();
    if (!config.globalXpMultiplierExpiresAt) return;
    const expiresAt = new Date(config.globalXpMultiplierExpiresAt);
    if (expiresAt <= new Date()) {
      await db.collection('config').doc('main').update({
        globalXpMultiplier: 1,
        globalXpMultiplierExpiresAt: null,
      });
      console.log('[⚡] Глобальный XP-буст истёк, сброшен');
    }
  } catch (e) {
    console.error('[checkGlobalBoost]', e.message);
  }
}

// ── Ежесуточные задачи ──
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

// ── Обработка ошибок ──
client.on('error', e => console.error('[Discord Error]', e));
client.on('warn', w => console.warn('[Discord Warn]', w));

process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
  process.exit(1);
});

// ── Запуск бота ──
const token = process.env.DISCORD_TOKEN;
if (!token || token.startsWith('TODO')) {
  console.error('❌ DISCORD_TOKEN не задан в .env!');
  process.exit(1);
}

client.login(token).catch(e => {
  console.error('❌ Ошибка авторизации бота:', e.message);
  process.exit(1);
});