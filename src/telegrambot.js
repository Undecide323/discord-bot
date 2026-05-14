// src/telegramBot.js — обработчик команд Telegram бота с inline-кнопками

const TelegramBot = require('node-telegram-bot-api');
const telegram = require('./telegram');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

console.log('[Telegram Bot] Запущен с polling...');

// ── /start ──
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  telegram.addSubscriber(chatId);

  const keyboard = {
    inline_keyboard: [
      [{ text: '📊 Статус', callback_data: 'status' }]
    ]
  };

  bot.sendMessage(chatId, 
    `👋 Привет, ${msg.from.first_name}!\n\n` +
    `Ты подписан на уведомления о заходах в голосовые каналы Discord сервера Gray Squad.\n` +
    `Сейчас уведомления <b>включены</b>.\n\n` +
    `Нажми кнопку «Статус» чтобы управлять подпиской.`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboard
    }
  );
});

// ── /stop ──
bot.onText(/\/stop/, (msg) => {
  const chatId = msg.chat.id;
  telegram.removeSubscriber(chatId);
  bot.sendMessage(chatId, '❌ Ты отписался от уведомлений. Чтобы снова подписаться, отправь /start');
});

// ── /status (с кнопками) ──
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  if (!telegram.isSubscriberActive(chatId) && !telegram.getSubscriberCount()) {
    // Если пользователь не подписан, предложить /start
    return bot.sendMessage(chatId, 'Вы не подписаны. Отправьте /start чтобы начать.');
  }

  const isActive = telegram.isSubscriberActive(chatId);
  const total = telegram.getSubscriberCount();
  const active = telegram.getActiveSubscriberCount();

  const keyboard = {
    inline_keyboard: [
      [{ 
        text: isActive ? '🔕 Выключить уведомления' : '🔔 Включить уведомления',
        callback_data: isActive ? 'mute' : 'unmute'
      }]
    ]
  };

  await bot.sendMessage(chatId,
    `📊 <b>Статистика подписчиков</b>\n` +
    `Всего: ${total}\n` +
    `Активных: ${active}\n\n` +
    `Ваш статус: ${isActive ? '🟢 Уведомления включены' : '🔴 Уведомления выключены'}`,
    {
      parse_mode: 'HTML',
      reply_markup: keyboard
    }
  );
});

// ── Обработка callback-запросов от inline-кнопок ──
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  if (!telegram.getSubscriberCount() || !telegram.isSubscriberActive(chatId) && data !== 'unmute') {
    // На случай, если пользователя нет в подписчиках
    return bot.answerCallbackQuery(query.id, { text: 'Сначала подпишитесь через /start' });
  }

  if (data === 'mute') {
    telegram.setSubscriberActive(chatId, false);
    // Редактируем сообщение с новыми кнопками
    const newKeyboard = {
      inline_keyboard: [
        [{ text: '🔔 Включить уведомления', callback_data: 'unmute' }]
      ]
    };
    await bot.editMessageText(
      `📊 <b>Статистика подписчиков</b>\n` +
      `Всего: ${telegram.getSubscriberCount()}\n` +
      `Активных: ${telegram.getActiveSubscriberCount()}\n\n` +
      `Ваш статус: 🔴 Уведомления выключены`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: newKeyboard
      }
    );
    return bot.answerCallbackQuery(query.id, { text: 'Уведомления выключены' });
  }

  if (data === 'unmute') {
    telegram.setSubscriberActive(chatId, true);
    const newKeyboard = {
      inline_keyboard: [
        [{ text: '🔕 Выключить уведомления', callback_data: 'mute' }]
      ]
    };
    await bot.editMessageText(
      `📊 <b>Статистика подписчиков</b>\n` +
      `Всего: ${telegram.getSubscriberCount()}\n` +
      `Активных: ${telegram.getActiveSubscriberCount()}\n\n` +
      `Ваш статус: 🟢 Уведомления включены`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: newKeyboard
      }
    );
    return bot.answerCallbackQuery(query.id, { text: 'Уведомления включены' });
  }

  if (data === 'status') {
    // Кнопка "Статус" просто вызывает /status
    const isActive = telegram.isSubscriberActive(chatId);
    const keyboard = {
      inline_keyboard: [
        [{ 
          text: isActive ? '🔕 Выключить уведомления' : '🔔 Включить уведомления',
          callback_data: isActive ? 'mute' : 'unmute'
        }]
      ]
    };
    await bot.editMessageText(
      `📊 <b>Статистика подписчиков</b>\n` +
      `Всего: ${telegram.getSubscriberCount()}\n` +
      `Активных: ${telegram.getActiveSubscriberCount()}\n\n` +
      `Ваш статус: ${isActive ? '🟢 Уведомления включены' : '🔴 Уведомления выключены'}`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: keyboard
      }
    );
    return bot.answerCallbackQuery(query.id);
  }

  // Неизвестный callback
  bot.answerCallbackQuery(query.id, { text: 'Неизвестная команда' });
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
  console.error('[Telegram Bot] Polling error:', error.message);
});

module.exports = bot;