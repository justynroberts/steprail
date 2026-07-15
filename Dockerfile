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
# Terraform comes from HashiCorp releases (not in alpine repos).
ARG TARGETARCH=arm64
ARG TF_VERSION=1.9.8
RUN apk add --no-cache openssh-client sshpass git curl bash unzip aws-cli kubectl docker-cli postgresql-client \
  && curl -fsSL -o /tmp/tf.zip "https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_linux_${TARGETARCH}.zip" \
  && unzip -o /tmp/tf.zip -d /usr/local/bin && rm /tmp/tf.zip && terraform -version

COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
EXPOSE 8452
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8452/api/health || exit 1
CMD ["node", "server/index.mjs"]
