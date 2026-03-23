# TODO: Land Auctions Module

## Proper deployment (persistent server)

**Текущее состояние:** модуль запускается как one-shot скрипт через GitHub Actions
(`npm run scrape` → `src/scripts/scrape.ts`). Actions коммитит обновлённые снапшоты
обратно в репо.

**Почему это временное решение:**
- Коммитить runtime-данные в репо — антипаттерн
- GitHub Actions runner стартует с нуля при каждом запуске (нет персистентного состояния)
- Скрипт поднимает и сразу гасит весь NestJS-контекст ради одного вызова — лишний оверхед
- Встроенный cron в `LandAuctionsService` не используется (он для persistent-режима)

**Правильное решение:**
1. Задеплоить NestJS-приложение на постоянный хост (VPS, Railway, Fly.io, DigitalOcean App Platform и т.п.)
2. Смонтировать Docker volume для `./data/` — снапшоты живут на сервере между перезапусками
3. Встроенный cron в `LandAuctionsService` сам запускает скрейп по расписанию
4. Удалить `daily-scrape.yml`, `src/scripts/scrape.ts` и `npm run scrape`
5. Снапшоты убрать из `.gitignore` или оставить там же (они не нужны в репо)
6. CI (`ci.yml`) остаётся — только lint/build/test, без деплоя данных

**Что нужно для деплоя:**
- Выбрать хостинг
- Настроить переменные окружения (`TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `SCRAPE_CRON`)
- Настроить Docker volume для `/app/data`
- Опционально: CD-pipeline при пуше в `main`
