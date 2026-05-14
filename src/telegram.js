// src/telegram.js — интеграция с Telegram ботом

const TelegramBot = require('node-telegram-bot-api');

// Создаем Telegram бота
const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Хранилище подписчиков
let subscribers = new Set();

/**
 * Загрузить подписчиков из файла
 */
function loadSubscribers() {
  try {
    const fs = require('fs');
    if (fs.existsSync('subscribers.json')) {
      const data = JSON.parse(fs.readFileSync('subscribers.json', 'utf8'));
      subscribers = new Set(data);
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
    fs.writeFileSync('subscribers.json', JSON.stringify([...subscribers]));
    console.log(`[Telegram] Сохранено ${subscribers.size} подписчиков`);
  } catch (error) {
    console.error('[Telegram] Ошибка сохранения подписчиков:', error.message);
  }
}

/**
 * Добавить подписчика
 * @param {number} chatId 
 */
function addSubscriber(chatId) {
  subscribers.add(chatId);
  saveSubscribers();
  console.log(`[Telegram] Новый подписчик: ${chatId}`);
}

/**
 * Удалить подписчика
 * @param {number} chatId 
 */
function removeSubscriber(chatId) {
  subscribers.delete(chatId);
  saveSubscribers();
  console.log(`[Telegram] Отписался: ${chatId}`);
}

/**
 * Получить количество подписчиков
 * @returns {number}
 */
function getSubscriberCount() {
  return subscribers.size;
}

/**
 * Отправить сообщение всем подписчикам
 * @param {string} message - текст сообщения
 */
async function sendToAllSubscribers(message) {
  if (subscribers.size === 0) {
    console.log('[Telegram] Нет подписчиков для отправки');
    return;
  }

  let sent = 0;
  let failed = 0;

  for (const chatId of subscribers) {
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

/**
 * Форматировать время в читаемый вид
 * @param {number} minutes - количество минут
 * @returns {string}
 */
function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}ч ${mins}мин` : `${hours}ч`;
}

/**
 * Уведомление о входе в голосовой канал
 * @param {string} username - имя пользователя
 * @param {string} channelName - название канала
 */
async function notifyVoiceJoin(username, channelName) {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const message = `🔊 <b>${username}</b> зашёл в голосовой канал <b>${channelName}</b>\n⏰ ${time}`;
  await sendToAllSubscribers(message);
}

/**
 * Уведомление о выходе из голосового канала
 * @param {string} username - имя пользователя
 * @param {string} channelName - название канала
 * @param {number} durationMinutes - сколько времени провёл
 */
async function notifyVoiceLeave(username, channelName, durationMinutes) {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const duration = formatDuration(durationMinutes);
  const message = `🔇 <b>${username}</b> вышел из голосового канала <b>${channelName}</b>\n⏱️ Был в канале: ${duration}\n⏰ ${time}`;
  await sendToAllSubscribers(message);
}

/**
 * Уведомление о переключении каналов
 * @param {string} username - имя пользователя
 * @param {string} fromChannel - из какого канала
 * @param {string} toChannel - в какой канал
 */
async function notifyVoiceSwitch(username, fromChannel, toChannel) {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const message = `🔄 <b>${username}</b> перешёл из <b>${fromChannel}</b> в <b>${toChannel}</b>\n⏰ ${time}`;
  await sendToAllSubscribers(message);
}

// Загружаем подписчиков при запуске
loadSubscribers();

module.exports = {
  sendToAllSubscribers,
  notifyVoiceJoin,
  notifyVoiceLeave,
  notifyVoiceSwitch,
  addSubscriber,
  removeSubscriber,
  getSubscriberCount,
  telegramBot
};