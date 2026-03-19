# AI Review App

GitHub App на Node.js + TypeScript для автоматического code review с помощью AI.

## Как это работает

При открытии или обновлении Pull Request GitHub отправляет webhook на сервер. Сервер собирает контекст через GitHub API (diff, правила проекта, связанная задача), передаёт его в AI (Claude или Codex), получает структурированный ответ и постит ревью от имени бот-аккаунта.

```
PR opened/updated
      ↓
POST /webhook  (GitHub)
      ↓
Верификация подписи HMAC-SHA256
      ↓
Параллельный сбор контекста:
  ├── Diff PR (файлы с патчами)
  ├── Правила проекта (CLAUDE.md, docs/, rules/)
  └── Связанная задача (Closes #N из описания PR)
      ↓
Сборка промпта
      ↓
AI CLI subprocess (claude / codex)
      ↓
POST /pulls/{n}/reviews → APPROVE / REQUEST_CHANGES / COMMENT
```

## Почему GitHub App, а не PAT токен

GitHub не позволяет апрувить собственный PR. Если coding-агент и review-агент используют один токен — ревью невозможно. GitHub App имеет собственный identity (бот-аккаунт), не зависит от личных аккаунтов разработчиков и может апрувить любой PR.

## Структура проекта

```
src/
├── index.ts                       # Точка входа: HTTP сервер, проверка авторизации при старте
├── config.ts                      # Загрузка и валидация env vars
├── types/index.ts                 # Все TypeScript интерфейсы
│
├── auth/
│   ├── githubAuth.ts              # Генерация JWT + получение installation token
│   └── webhookVerify.ts           # Middleware: верификация X-Hub-Signature-256
│
├── webhooks/
│   ├── webhookRouter.ts           # Express router, дедупликация доставок
│   └── pullRequestHandler.ts      # Оркестратор: сбор контекста → AI → ревью
│
├── github/
│   ├── githubClient.ts            # Authenticated fetch wrapper для GitHub API
│   ├── diffFetcher.ts             # Получение списка изменённых файлов с патчами
│   ├── repoFileFetcher.ts         # Получение правил проекта (CLAUDE.md, docs/, rules/)
│   ├── issueFetcher.ts            # Парсинг "Closes #N" + получение issue
│   └── reviewPoster.ts            # Постинг ревью, валидация inline-комментариев
│
├── context/
│   └── contextBuilder.ts          # Сборка промпта с бюджетом символов
│
└── ai/
    ├── aiProvider.ts              # Интерфейс AIProvider + фабрика
    ├── claudeProvider.ts          # Claude CLI через subprocess
    ├── codexProvider.ts           # Codex CLI через subprocess
    └── authChecker.ts             # Polling авторизации при старте сервера
```

## Переменные окружения

Скопируй `.env.example` в `.env` и заполни:

| Переменная | Описание |
|-----------|----------|
| `GITHUB_APP_ID` | ID GitHub App (из настроек App) |
| `GITHUB_PRIVATE_KEY_PATH` | Путь к .pem файлу внутри контейнера |
| `GITHUB_PRIVATE_KEY` | Альтернатива — inline ключ с `\n` вместо переносов |
| `GITHUB_WEBHOOK_SECRET` | Секрет вебхука (задаётся при создании App) |
| `AI_PROVIDER` | `claude` или `codex` (default: `claude`) |
| `AI_TIMEOUT_MS` | Таймаут AI subprocess в мс (default: `300000`) |
| `PORT` | Порт HTTP сервера (default: `3000`) |
| `MAX_PROMPT_CHARS` | Максимум символов в промпте (default: `200000`) |
| `MAX_RULES_CHARS` | Максимум символов для правил из репо (default: `50000`) |

## Деплой на VPS

### 1. Создать GitHub App

1. GitHub → Settings → Developer Settings → GitHub Apps → New GitHub App
2. Заполнить:
   - **Homepage URL**: URL твоего VPS или любой
   - **Webhook URL**: `http://<IP_VPS>:3000/webhook`
   - **Webhook secret**: придумать строку, записать в `.env`
3. Права (Permissions):
   - Pull requests: **Read & Write**
   - Issues: **Read**
   - Contents: **Read**
4. Events: поставить галочку **Pull request**
5. Создать App → сохранить **App ID**
6. Generate private key → скачать `.pem` файл
7. Установить App на нужные репозитории (Install App)

### 2. Подготовить сервер

```bash
# Клонировать репозиторий
git clone https://github.com/Vitykovskiy/ai-review-app.git
cd ai-review-app

# Скопировать и заполнить конфиг
cp .env.example .env
nano .env

# Положить private key
mkdir -p secrets
cp /path/to/your-app.pem secrets/github_private_key.pem
```

### 3. Запустить

```bash
docker compose up -d --build
```

### 4. Авторизовать AI при первом запуске

Сервер стартует и ждёт авторизации:

```bash
# Для Claude
docker compose exec review-bot claude auth login
# Перейти по ссылке из терминала

# Для Codex
docker compose exec review-bot codex auth login
```

После авторизации сервер продолжит работу автоматически. Токены сохраняются в Docker volume и переживают перезапуски контейнера.

### 5. Проверить

```bash
# Health check
curl http://localhost:3000/health

# Логи
docker compose logs -f
```

## Контекст для AI

Агент получает из репозитория (через GitHub API, без клонирования):
- `CLAUDE.md` / `AGENT.md` в корне
- `.github/CONTRIBUTING.md`
- Файлы из папок `docs/` и `rules/`

Чтобы задать правила ревью — положи их в `CLAUDE.md` в корне проверяемого репозитория.

Связанная задача берётся из описания PR по шаблону:
```
Closes #42
Fixes #15
Resolves #7
```

## Формат ответа AI

Агент должен вернуть JSON:

```json
{
  "action": "APPROVE",
  "body": "Общий комментарий к ревью",
  "comments": [
    { "path": "src/auth.ts", "line": 42, "body": "Замечание к конкретной строке" }
  ]
}
```

- `APPROVE` — принять PR
- `REQUEST_CHANGES` — заблокировать, есть замечания
- `COMMENT` — нейтральный комментарий без блокировки

## Особенности реализации

- **Нет клонирования**: весь контекст получается через GitHub API
- **Кеш токенов**: installation token кешируется на 55 минут
- **Дедупликация**: повторные доставки одного webhook игнорируются
- **Параллельные ревью**: одновременные ревью одного PR блокируются
- **Большие PR**: лимит 50 файлов, diff обрезается по символам (самые большие первыми)
- **Бинарные файлы**: пропускаются, упоминаются в промпте
- **Невалидные inline-комментарии**: строки вне diff переносятся в общий body
- **Таймаут AI**: SIGTERM → SIGKILL, постится COMMENT с сообщением об ошибке
- **Невалидный JSON от AI**: постится raw output как COMMENT
