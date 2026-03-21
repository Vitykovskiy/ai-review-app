# DEPLOY.md

## Что это за прод-схема

Продовый бот работает на VPS в Docker Compose и принимает webhook от GitHub App по публичному HTTPS URL.

Основной путь обработки:

```text
pull_request event -> GitHub App webhook -> /webhook -> сбор контекста -> Claude CLI -> GitHub review
```

Fallback-поллер остаётся только как резервный механизм. В проде он не должен быть основным способом доставки событий.

---

## 1. Что нужно подготовить заранее

### VPS

Нужен Linux VPS с:

- Docker
- Docker Compose plugin
- git
- публичным доменом или поддоменом
- обратным прокси / TLS терминацией

Текущий прод развёрнут в:

```text
/opt/ai-review-app
```

### Домен

Нужен домен, который указывает на VPS. Текущий продовый адрес:

```text
https://review.vitykovskiy.ru
```

Webhook URL GitHub App должен указывать именно на:

```text
https://<your-domain>/webhook
```

Health endpoint:

```text
https://<your-domain>/health
```

### GitHub App

Нужно создать отдельный GitHub App, а не использовать PAT.

Обязательные permissions:

- `Pull requests: Read & write`
- `Contents: Read`
- `Metadata: Read`

События, на которые App **обязательно** должен быть подписан:

- `Pull request`

Если `pull_request` event не включён, webhook-driven review работать не будет, и бот останется только на fallback-поллере.

После создания App нужно:

1. сохранить `App ID`
2. скачать private key `.pem`
3. установить App на нужные репозитории
4. проверить, что webhook URL указывает на публичный HTTPS endpoint

---

## 2. Подготовка директории на VPS

```bash
sudo mkdir -p /opt/ai-review-app
sudo chown -R $USER:$USER /opt/ai-review-app
cd /opt/ai-review-app
git clone git@github.com:Vitykovskiy/ai-review-app.git .
mkdir -p secrets
```

Положить private key GitHub App:

```bash
cp /path/to/github-app.pem /opt/ai-review-app/secrets/github_private_key.pem
chmod 600 /opt/ai-review-app/secrets/github_private_key.pem
```

---

## 3. Реальный `.env`

Создать файл `/opt/ai-review-app/.env`.

Пример без секретных значений:

```env
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY_PATH=/run/secrets/github_private_key.pem
GITHUB_WEBHOOK_SECRET=change_me
AI_PROVIDER=claude
AI_TIMEOUT_MS=300000
PORT=3000
LOG_LEVEL=info
MAX_PROMPT_CHARS=200000
MAX_RULES_CHARS=50000
```

### Пояснение переменных

- `GITHUB_APP_ID` — ID GitHub App
- `GITHUB_PRIVATE_KEY_PATH` — путь к private key внутри контейнера
- `GITHUB_WEBHOOK_SECRET` — секрет webhook из GitHub App settings
- `AI_PROVIDER` — `claude` или `codex`; в текущем проде используется `claude`
- `AI_TIMEOUT_MS` — таймаут AI subprocess
- `PORT` — HTTP порт внутри контейнера
- `LOG_LEVEL` — уровень логирования
- `MAX_PROMPT_CHARS` — общий лимит размера prompt
- `MAX_RULES_CHARS` — лимит размера repo rules/docs context

### Про `POLLER_REPOS`

В проде этот параметр **не нужен**.

Если его задавать, он превращает fallback-поллер в whitelist и требует ручного обновления конфига при каждом новом репозитории. Это плохо для прод-схемы.

Разрешённый use-case для `POLLER_REPOS` — локальная отладка или временный sandbox, где нужно ограничить опрос конкретными репозиториями.

---

## 4. Запуск сервиса

```bash
cd /opt/ai-review-app
docker compose up -d --build
```

После старта проверить логи:

```bash
docker compose logs --tail=100 review-bot
```

Нормальный старт выглядит так:

```text
[startup] AI provider: claude
[server] Listening on port 3000
[startup] Auth confirmed. Mounting webhook handler.
```

Если GitHub App не подписан на `pull_request`, бот теперь пишет явное предупреждение в логах на старте.

---

## 5. Авторизация Claude CLI внутри контейнера

Если Claude ещё не авторизован:

```bash
docker compose exec review-bot claude auth login
```

Дальше:

1. открыть URL из терминала
2. завершить login
3. бот автоматически продолжит работу

Токены Claude сохраняются в docker volume и переживают перезапуски контейнера.

---

## 6. Публикация наружу

Нужно, чтобы внешний HTTPS URL проксировал запросы на контейнерный порт `3000`.

Минимальная проверка:

```bash
curl https://<your-domain>/health
```

Ожидаемый ответ:

```json
{"status":"ok"}
```

Важно: зелёный `/health` означает, что HTTP сервер жив. Но готовность к review наступает только после AI auth и монтирования `/webhook`.

---

## 7. Как реально работает review flow

### Основной путь

1. создаётся или обновляется PR
2. GitHub отправляет `pull_request` webhook на `/webhook`
3. бот проверяет `X-Hub-Signature-256`
4. бот дедуплицирует delivery по `X-GitHub-Delivery`
5. бот собирает контекст через GitHub API:
   - diff PR
   - markdown/rules/docs из репозитория
   - связанную issue по `Closes #N` / `Fixes #N` / `Resolves #N`
6. бот запускает Claude CLI
7. бот публикует review от identity GitHub App

### Fallback-путь

Если webhook не приходит, поллер раз в 60 секунд просматривает открытые PR и публикует review для head SHA, у которого ещё нет bot-review.

Это резервный путь, а не основная схема прод-доставки.

---

## 8. Проверка после деплоя

### Базовые проверки

```bash
curl https://<your-domain>/health
docker compose logs --tail=100 review-bot
```

### Проверка webhook

1. открыть тестовый PR в репозитории, куда установлен App
2. посмотреть логи:

```bash
docker compose logs --tail=200 review-bot
```

Ожидаемо должны появиться строки вида:

```text
[webhook] Incoming event=pull_request delivery=...
[pr] Starting review for owner/repo#N (...)
[pr] Review posted for owner/repo#N: APPROVE|REQUEST_CHANGES|COMMENT
```

### Проверка GitHub App настроек

В GitHub App settings проверить:

- `Webhook URL`
- `Webhook secret`
- `Pull request` в списке subscribed events
- `Recent Deliveries`

Если webhook работает правильно, review должен появляться быстро, без ожидания fallback-поллера.

---

## 9. Диагностика, если review не приходит

### Сценарий 1: `/health` работает, review нет

Проверьте логи:

```bash
docker compose logs --tail=200 review-bot
```

Что искать:

- есть ли `[startup] Auth confirmed. Mounting webhook handler.`
- есть ли `[webhook] Incoming event=pull_request ...`
- есть ли `[pr] Error reviewing ...`

### Сценарий 2: webhook вообще не приходит

Проверьте в GitHub App settings -> `Advanced` -> `Recent Deliveries`:

- есть ли доставки `pull_request`
- какой у них HTTP status
- есть ли ошибки TLS / timeout / 404 / 401

Если доставок `pull_request` нет вообще, первым делом проверьте, что App подписан на событие `Pull request`.

### Сценарий 3: сервер отвечает `401`

Проблема в webhook secret или подписи.

Проверьте, что:

- секрет в GitHub App settings совпадает с `GITHUB_WEBHOOK_SECRET`
- запрос идёт на правильный URL
- reverse proxy не ломает тело запроса

### Сценарий 4: webhook приходит, но review не постится

Проверьте:

- Claude auth внутри контейнера
- логи ошибок GitHub API
- права GitHub App (`pull_requests: write`, `contents: read`, `metadata: read`)

### Сценарий 5: review появляется только через минуту

Значит сработал fallback poller, а не webhook. Нужно чинить GitHub App webhook delivery, а не полагаться на поллер.

---

## 10. Автодеплой

В репозитории есть GitHub Actions workflow `.github/workflows/deploy.yml`, который заходит на VPS по SSH и запускает `scripts/deploy.sh`.

Нужные GitHub Secrets:

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `APP_DIR`

`deploy.sh` делает:

1. проверку наличия `.env`
2. проверку наличия `secrets/github_private_key.pem`
3. `git fetch origin <branch>`
4. `git reset --hard origin/<branch>`
5. `docker compose up -d --build`
6. `docker image prune -f`

---

## 11. Критичные замечания по реальной эксплуатации

1. `health` сам по себе не доказывает готовность review pipeline
2. без `pull_request` subscription GitHub App webhook-driven flow не заработает
3. `POLLER_REPOS` в проде лучше не использовать
4. если новый репозиторий требует ручного внесения в `.env`, значит прод-схема настроена неправильно
5. рабочий критерий успеха — review приходит по webhook без ручного whitelist и без ожидания poller
