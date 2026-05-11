# browser-linux

Полноценный Linux (Alpine 3.19, x86) в браузере через v86 + WebAssembly.
React + TypeScript + Vite. Без серверной части для UI; опциональный Node.js
прокси нужен только для сети внутри VM (curl / wget / apk).

## Что внутри

```
src/
  emulator/      # Обёртка над v86, типы, detection
  filesystem/    # IndexedDB (state-snapshots) + OPFS (host files) + upload
  network/       # Конфиг WS-relay
  terminal/      # xterm.js, прошитый на serial0 v86
  ui/            # Toolbar, Settings, BootScreen
  boot/          # Манифест образа
public/
  v86/           # libv86.js + v86.wasm + BIOS (fetch-v86.mjs)
  images/        # Flat disk image (fetch-image.mjs)
scripts/         # Скрипты подтягивания артефактов
server/proxy/    # Node.js WS↔TCP прокси (v86-совместимый)
```

## Быстрый старт

Нужен Node.js >= 20.

```bash
npm install
npm run prepare:all   # скачает v86 (libv86.js, wasm, BIOS) и образ Linux
npm run dev           # Vite поднимет http://localhost:5173 с COOP/COEP
```

Откроется тёмный UI с тулбаром и терминалом. Жми **▶ Start**. Первая загрузка ~30–60 МБ,
прогресс показан. После первого запуска можно нажать **💾 Save state** — следующий boot
за <1 с.

### Проверка

```bash
# 1. Типы и сборка
npm run build

# 2. Локальный прод-прокси + статика
npm run build
docker compose up --build       # http://localhost:8088
```

Внутри VM:

```sh
# чек CPU и памяти
cat /proc/cpuinfo | head
free -m

# если настроил сеть (см. ниже) — проверка
wget -qO- https://example.com | head
```

## Сеть

Сеть в браузерной VM физически невозможна без WS↔TCP моста. У тебя три варианта:

1. **`self`** (по умолчанию). Запусти `server/proxy` рядом со статикой.
   Caddyfile уже пробрасывает `/net/` → `proxy:8080`. Режим по умолчанию после `docker compose up`.
2. **`public`** — `wss://relay.widgetry.org/` (общий v86-релей). Медленный, без гарантий, не для прода.
3. **`user`** — свой URL (Fly.io, Railway, etc). Для Fly.io: `fly deploy -c fly.toml`.
4. **`none`** — без сети, VM полностью офлайн.

Переключается в **⚙ Settings → Network relay**.

Мой прокси в `server/proxy/index.mjs` — не полный slirp. Он терминирует TCP
на хост-стороне и проксирует байт-потоки. Этого хватит для `curl`, `wget`, `apk`, TLS.
Не поддерживается: ICMP/ping, входящие соединения, сырые сокеты. Если надо «всё» —
ставь [`benjamincburns/websockproxy`](https://github.com/benjamincburns/websockproxy),
протокол на проводе идентичный.

## Образ Linux

По умолчанию `scripts/fetch-image.mjs` кладёт Alpine-совместимый образ в
`public/images/alpine.img` + пишет `alpine.manifest.json` с точным размером.

Подменить свой образ:

```bash
# твой raw .img
cp my-linux.img public/images/alpine.img
node scripts/fetch-image.mjs    # перегенерит manifest с новым размером
```

Конвертация из qcow2:

```bash
qemu-img convert -f qcow2 -O raw in.qcow2 public/images/alpine.img
```

Собрать свой Alpine через `alpine-make-vm-image`:

```bash
# на Linux-хосте
sudo alpine-make-vm-image \
  --image-format raw \
  --image-size 256M \
  --packages "openssl ca-certificates wget curl vim git nodejs tmux" \
  public/images/alpine.img
```

## Деплой

### Vercel / Netlify / Cloudflare Pages

Конфиги (`vercel.json`, `netlify.toml`, `public/_headers`) задают COOP/COEP и кеш
для `/v86/*` и `/images/*`. Команда сборки: `npm run prepare:all && npm run build`.

**Важно:** хостинг раздаёт только статику. Для сети деплой `server/proxy`
отдельно (Fly.io / Railway / Render / свой VPS) и в настройках UI вбей `wss://...`.

### Self-hosted (Docker)

```bash
npm run build
docker compose up --build     # Caddy + прокси на одном origin :8088
```

Это единственный способ иметь app и proxy на одном origin без CORS-танцев.

## Ограничения и честные грабли

- **GUI (X11) не поддерживается.** Это TTY. X-сервер для v86 — отдельный
  проект на 2–3 дня только на сборку образа.
- **SharedArrayBuffer** требует `COOP: same-origin` и `COEP: require-corp`.
  На GitHub Pages эти заголовки задать нельзя — VM запустится, но в ~5× медленнее.
- **Safari**: OPFS-запись с главного потока не работает. Мы используем IDB
  как основной storage; OPFS — best-effort.
- **Звук**: v86 эмулирует AC97, но в дефолтном Alpine-образе ALSA не
  поднят. Пересобери образ с `alsa-utils`, если нужен звук.
- **Clipboard**: `navigator.clipboard.readText()` в Firefox требует
  расширения. `writeText` работает везде по user-gesture.
- **Первый boot** — это полное сырое ядро + userspace. Хочешь <1 s — жми
  **Save state** после первой загрузки, следующий старт восстанавливает снапшот.

## Стек и версии

- React 18.3 + TypeScript 5.6 strict
- Vite 5.4
- v86 @ `v1.32.1` (BSD-2, коммерческое использование ОК)
- xterm.js 5.5 + fit + web-links аддоны
- Node.js 20 для прокси, `ws` 8.18

## Лицензия

Код проекта — под лицензией, которую ты выберешь (по умолчанию MIT в корень не положен).
`public/v86/*` — BSD-2 (см. upstream copy/v86).
