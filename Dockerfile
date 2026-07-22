# MIT License - Copyright (c) fintonlabs.com
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Real CLIs for the infra steps: ssh, kubectl, aws, docker, git, psql.
# Terraform comes from HashiCorp releases (not in alpine repos). Detect the arch
# from `uname -m` at build time — robust on any builder (Railway/Fly/CI/local),
# unlike a TARGETARCH build-arg that silently defaults to the wrong platform.
ARG TF_VERSION=1.15.8
RUN apk add --no-cache openssh-client sshpass git curl bash unzip aws-cli kubectl docker-cli postgresql-client ansible \
  && case "$(uname -m)" in x86_64) TFARCH=amd64 ;; aarch64) TFARCH=arm64 ;; *) TFARCH="$(uname -m)" ;; esac \
  && curl -fsSL -o /tmp/tf.zip "https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_linux_${TFARCH}.zip" \
  && unzip -o /tmp/tf.zip -d /usr/local/bin && rm /tmp/tf.zip && terraform -version \
  # ssh/ansible record trust-on-first-use host keys here; without it every
  # connection warns "Failed to add the host to the list of known hosts"
  && mkdir -p -m 700 /root/.ssh

COPY package*.json ./
# npm is only needed for this install; removing it from the runtime image
# drops its bundled dependency tree (a recurring CVE source) and shrinks
# the attack surface — the server runs with plain `node`.
RUN npm ci --omit=dev && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
EXPOSE 8452
# Probe the port the app actually binds — PORT is 8452 under compose but injected
# by the platform on Railway/Fly/etc. Shell form so ${PORT} expands at runtime.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT:-8452}/api/health" || exit 1
CMD ["node", "server/index.mjs"]
