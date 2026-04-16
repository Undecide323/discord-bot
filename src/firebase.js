// src/firebase.js — подключение к Firebase Admin SDK

const admin = require('firebase-admin');

// Инициализация (один раз)
if (!admin.apps.length) {
  const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
    // Если указан путь к JSON-файлу
    ? admin.credential.cert(require(require('path').resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)))
    // Иначе — собираем из переменных окружения
    : admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      });

  admin.initializeApp({ credential });
}

const db = admin.firestore();

// ── Хелперы ──────────────────────────────────────────────────

/** Получить документ пользователя по discordId */
async function getUser(discordId) {
  const snap = await db.collection('users').doc(discordId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/** Создать профиль если не существует. Возвращает профиль. */
async function getOrCreateUser(member) {
  const existing = await getUser(member.id);
  if (existing) return existing;

  const newUser = {
    discordId:          member.id,
    username:           member.user.username,
    displayName:        member.displayName,
    avatarUrl:          member.user.displayAvatarURL({ size: 64, extension: 'png' }),
    role:               'user',
    elo:                500,
    rank:               0,
    rankName:           'Калибровка',
    rankColor:          '#6c757d',
    currency:           0,
    level:              0,
    xp:                 0,
    totalVoiceMinutes:  0,
    xpMultiplier:       1,
    xpMultiplierExpiresAt: null,
    achievements:       [],
    warnings:           [],
    forumBanExpiresAt:  null,
    canCreateEvents:    false,
    customColor:        null,
    title:              null,
    createdAt:          admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('users').doc(member.id).set(newUser);
  console.log(`[+] Создан профиль: ${member.user.username}`);
  return { id: member.id, ...newUser };
}

/** Обновить поля пользователя */
async function updateUser(discordId, fields) {
  await db.collection('users').doc(discordId).update(fields);
}

/** Получить системный конфиг */
async function getConfig() {
  const snap = await db.collection('config').doc('main').get();
  // Дефолтные значения если конфиг не инициализирован
  const defaults = {
    xpPerMessage:        1,
    xpPer10MinVoice:     5,
    currencyPerMessage:  1,
    currencyPer10Min:    5,
    minUsersInVoice:     2,
    requireMic:          true,
    globalXpMultiplier:  1,
    globalXpMultiplierExpiresAt: null,
    dailyBonus:          25,
    achievementBonus:    50,
    levelUpMultiplier:   10,
    eventParticipation:  100,
    eventWinBonus:       50,
    forbiddenRoleWords:  ['admin','moderator','owner','creator','system'],
  };
  return snap.exists ? { ...defaults, ...snap.data() } : defaults;
}

/** Записать лог действия */
async function writeLog(type, targetUsername, change, reason, byWhom) {
  await db.collection('logs').add({
    type,
    targetUsername,
    change,
    reason,
    byWhom,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/** Отправить уведомление пользователю */
async function sendNotification(discordId, { type, title, message, link }) {
  await db.collection('notifications').add({
    userId:    discordId,
    type,
    title,
    message,
    link:      link || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    readAt:    null,
  });
}

module.exports = { admin, db, getUser, getOrCreateUser, updateUser, getConfig, writeLog, sendNotification };
