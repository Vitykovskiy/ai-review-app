# Прод-деплой через GitHub Actions

## Что уже подготовлено в репозитории

- `.github/workflows/deploy.yml` — workflow автодеплоя
- `scripts/deploy.sh` — единый серверный сценарий деплоя

## Что нужно один раз сделать на VPS

```bash
sudo mkdir -p /opt/ai-review-app
sudo chown -R $USER:$USER /opt/ai-review-app
cd /opt/ai-review-app
git clone https://github.com/Vitykovskiy/ai-review-app.git .
mkdir -p secrets
```

Создать `.env`:

```env
GITHUB_APP_ID=3132337
GITHUB_PRIVATE_KEY_PATH=/opt/ai-review-app/secrets/github_private_key.pem
GITHUB_WEBHOOK_SECRET=Veni, vidi, review
AI_PROVIDER=claude
AI_TIMEOUT_MS=300000
PORT=3000
LOG_LEVEL=info
MAX_PROMPT_CHARS=200000
MAX_RULES_CHARS=50000
```

Положить private key сюда:

```bash
/opt/ai-review-app/secrets/github_private_key.pem
```

## GitHub Secrets

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `APP_DIR` = `/opt/ai-review-app`

## Что делает workflow

Подключается по SSH к VPS и запускает:

```bash
export APP_DIR="/opt/ai-review-app"
export BRANCH="main"
bash "/opt/ai-review-app/scripts/deploy.sh"
```
