.RECIPEPREFIX = >
.PHONY: setup up down logs test benchmark build dev clean

setup:
> cp -n .env.example .env || true
> npm install

up:
> docker compose up -d --build

down:
> docker compose down

logs:
> docker compose logs -f

test:
> npm test

benchmark:
> npm run benchmark:security

build:
> npm run build

dev:
> npm run dev

clean:
> docker compose down -v
