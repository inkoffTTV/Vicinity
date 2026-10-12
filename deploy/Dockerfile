# Vicinity backend — контейнер для VPS.
# Контекст сборки = корень репозитория (см. docker-compose.yml).
# Сборка: Drogon из исходников (с поддержкой SQLite) + сам сервер. Рантайм — лёгкий.

# ───── build ─────
FROM ubuntu:22.04 AS build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake git ca-certificates \
        libjsoncpp-dev uuid-dev zlib1g-dev libssl-dev libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Drogon (с trantor-сабмодулем): та же версия и те же опции, что в CI (.github/workflows)
ARG DROGON_VERSION=v1.9.13
RUN git clone --recurse-submodules --depth 1 --branch "$DROGON_VERSION" \
        https://github.com/drogonframework/drogon /tmp/drogon \
    && cmake -S /tmp/drogon -B /tmp/drogon/build -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_ORM=ON -DBUILD_SQLITE=ON -DBUILD_MYSQL=OFF -DBUILD_POSTGRESQL=OFF -DBUILD_REDIS=OFF \
        -DBUILD_CTL=OFF -DBUILD_EXAMPLES=OFF -DBUILD_TESTING=OFF \
    && cmake --build /tmp/drogon/build -j"$(nproc)" --target install \
    && rm -rf /tmp/drogon

# libcurl — письма с кодом подтверждения (SMTP). Отдельным слоем после Drogon, чтобы его долгая
# сборка оставалась в кэше Docker у тех, кто уже собирал образ
RUN apt-get update && apt-get install -y --no-install-recommends libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Сам сервер
COPY backend/ /app/backend/
COPY shared/  /app/shared/
RUN cmake -S /app/backend -B /app/build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /app/build -j"$(nproc)"

# ───── runtime ─────
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
# curl — для healthcheck в docker-compose.yml, libcurl4 — письма с кодом подтверждения (SMTP),
# sqlite3 — для онлайн-бэкапа базы (deploy/backup.sh)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libjsoncpp25 libssl3 libsqlite3-0 zlib1g libuuid1 ca-certificates curl libcurl4 sqlite3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/build/VicinityServer /app/VicinityServer
COPY deploy/config.docker.json /app/config.json
# /data — том с базой и загрузками (см. compose), создаётся при первом запуске
EXPOSE 8080
CMD ["/app/VicinityServer"]
