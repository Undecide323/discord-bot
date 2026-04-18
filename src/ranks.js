// src/ranks.js — логика рангов ELO и уровней XP

const RANKS = [
  { id: 0,  name: 'Неактивен',   color: '#6c757d', min: 0,    max: 500  },
  { id: 1,  name: 'Железо',      color: '#8B8B8B', min: 501,  max: 800  },
  { id: 2,  name: 'Бронза',      color: '#CD7F32', min: 501,  max: 800  },
  { id: 3,  name: 'Серебро',     color: '#C0C0C0', min: 801,  max: 1000 },
  { id: 4,  name: 'Золото',      color: '#FFD700', min: 1001, max: 1200 },
  { id: 5,  name: 'Платина',     color: '#E5E4E2', min: 1201, max: 1400 },
  { id: 6,  name: 'Алмаз',       color: '#B9F2FF', min: 1401, max: 1600 },
  { id: 7,  name: 'Мастер',      color: '#A335EE', min: 1601, max: 1800 },
  { id: 8,  name: 'Грандмастер', color: '#FF8C00', min: 1801, max: 2000 },
  { id: 9,  name: 'Элитный',     color: '#FF4500', min: 2001, max: 2300 },
  { id: 10, name: 'Легенда',     color: '#FF0000', min: 2301, max: Infinity },
];

/**
 * Получить ранг по значению ELO
 * @param {number} elo
 * @returns {{ id, name, color, min, max }}
 */
function getRankByElo(elo) {
  return RANKS.find(r => elo >= r.min && elo <= r.max) || RANKS[RANKS.length - 1];
}

/**
 * Вычислить уровень по XP
 * Формула: level = floor(sqrt(xp / 100))
 * @param {number} xp
 * @returns {number}
 */
function getLevelByXp(xp) {
  return Math.floor(Math.sqrt(xp / 100));
}

/**
 * XP до следующего уровня
 * @param {number} xp
 * @returns {{ currentLevelXp, nextLevelXp, progress }}
 */
function xpProgress(xp) {
  const lvl = getLevelByXp(xp);
  const currentLevelXp = lvl * lvl * 100;
  const nextLevelXp    = (lvl + 1) * (lvl + 1) * 100;
  const progress       = Math.round(((xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100);
  return { currentLevelXp, nextLevelXp, progress };
}

module.exports = { RANKS, getRankByElo, getLevelByXp, xpProgress };
