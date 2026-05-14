// src/telegram.js — интеграция с Telegram ботом

const TelegramBot = require('node-telegram-bot-api');

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Хранилище подписчиков: Map<chatId, { active: boolean }>
let subscribers = new Map();

/**
 * Загрузить подписчиков из файла
 */
function loadSubscribers() {
  try {
    const fs = require('fs');
    if (fs.existsSync('subscribers.json')) {
      const raw = JSON.parse(fs.readFileSync('subscribers.json', 'utf8'));
      if (Array.isArray(raw)) {
        // Новый формат: массив объектов { chatId, active }
        subscribers = new Map(raw.map(s => [s.chatId, { active: s.active !== false }]));
      } else if (typeof raw === 'object' && raw !== null) {
        // Старый формат: массив chatId (без active)
        const ids = Array.isArray(raw) ? raw : Object.keys(raw).map(Number);
        subscribers = new Map(ids.map(id => [id, { active: true }]));
      }
      console.log(`[Telegram] Загружено ${subscribers.size} подписчиков`);
    }
  } catch (error) {
    console.error('[Telegram] Ошибка загрузки подписчиков:', error.message);
  }
}

/**
 * Сохранить подписчиков в файл
 */
function saveSubscribers() {
  try {
    const fs = require('fs');
    const data = Array.from(subscribers.entries()).map(([chatId, info]) => ({
      chatId,
      active: info.active,
    }));
    fs.writeFileSync('subscribers.json', JSON.stringify(data));
    console.log(`[Telegram] Сохранено ${subscribers.size} подписчиков`);
  } catch (error) {
    console.error('[Telegram] Ошибка сохранения подписчиков:', error.message);
  }
}

/**
 * Добавить или обновить подписчика (по умолчанию active = true)
 */
function addSubscriber(chatId) {
  subscribers.set(chatId, { active: true });
  saveSubscribers();
  console.log(`[Telegram] Подписчик ${chatId} (активен)`);
}

/**
 * Удалить подписчика полностью
 */
function removeSubscriber(chatId) {
  subscribers.delete(chatId);
  saveSubscribers();
  console.log(`[Telegram] Отписался: ${chatId}`);
}

/**
 * Установить статус активности подписчика
 */
function setSubscriberActive(chatId, active) {
  if (subscribers.has(chatId)) {
    subscribers.get(chatId).active = active;
    saveSubscribers();
    console.log(`[Telegram] ${chatId}: active = ${active}`);
  }
}

/**
 * Проверить, активен ли подписчик
 */
function isSubscriberActive(chatId) {
  return subscribers.has(chatId) && subscribers.get(chatId).active === true;
}

/**
 * Получить количество подписчиков (всех)
 */
function getSubscriberCount() {
  return subscribers.size;
}

/**
 * Получить количество активных подписчиков
 */
function getActiveSubscriberCount() {
  let count = 0;
  for (const info of subscribers.values()) {
    if (info.active) count++;
  }
  return count;
}

/**
 * Отправить сообщение всем активным подписчикам
 */
async function sendToAllSubscribers(message) {
  const activeChatIds = [];
  for (const [chatId, info] of subscribers.entries()) {
    if (info.active) activeChatIds.push(chatId);
  }

  if (activeChatIds.length === 0) {
    console.log('[Telegram] Нет активных подписчиков для отправки');
    return;
  }

  let sent = 0;
  let failed = 0;

  for (const chatId of activeChatIds) {
    try {
      await telegramBot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      sent++;
    } catch (error) {
      console.error(`[Telegram] Ошибка отправки для ${chatId}:`, error.message);
      if (error.response && error.response.statusCode === 403) {
        removeSubscriber(chatId);
      }
      failed++;
    }
  }

  console.log(`[Telegram] Отправлено: ${sent}, ошибок: ${failed}`);
}

// ── Уведомления для Discord ──

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}ч ${mins}мин` : `${hours}ч`;
}

async function notifyVoiceJoin(username, channelName) {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const message = `🔊 <b>${username}</b> зашёл в голосовой канал <b>${channelName}</b>\n⏰ ${time}`;
  await sendToAllSubscribers(message);
}

async function notifyVoiceLeave(username, channelName, durationMinutes) {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const duration = formatDuration(durationMinutes);
  const message = `🔇 <b>${username}</b> вышел из голосового канала <b>${channelName}</b>\n⏱️ Был в канале: ${duration}\n⏰ ${time}`;
  await sendToAllSubscribers(message);
}

async function notifyVoiceSwitch(username, fromChannel, toChannel) {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const message = `🔄 <b>${username}</b> перешёл из <b>${fromChannel}</b> в <b>${toChannel}</b>\n⏰ ${time}`;
  await sendToAllSubscribers(message);
}

// Загружаем при старте
loadSubscribers();

module.exports = {
  sendToAllSubscribers,
  notifyVoiceJoin,
  notifyVoiceLeave,
  notifyVoiceSwitch,
  addSubscriber,
  removeSubscriber,
  setSubscriberActive,
  isSubscriberActive,
  getSubscriberCount,
  getActiveSubscriberCount,
  telegramBot
};