
FROM node:20

ENV DEBIAN_FRONTEND=noninteractive
RUN echo "insecure" >> /etc/curlrc && echo "check_certificate = off" >> /etc/wgetrc
RUN npm config set strict-ssl false -g
ENV CURL_CA_BUNDLE=""
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git \
      curl \
      ca-certificates \
      unzip \
      jq \
      less \
      procps \
      uuid-runtime \
      sqlite3 \
      build-essential \
      python3 \
 && ln -s /usr/bin/python3 /usr/bin/python \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

ARG BUN_VERSION=1.3.12
ENV BUN_INSTALL="/usr/local/bun"
RUN curl -kfsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
 && chmod -R a+rX /usr/local/bun
ENV PATH="/usr/local/bun/bin:${PATH}"

ARG UV_VERSION=0.11.7
ENV UV_INSTALL_DIR="/usr/local/bin"
RUN set -eux \
 && curl -kLsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | sh \
 && { chmod a+rX /usr/local/bin/uv /usr/local/bin/uvx 2>/dev/null || true; }

RUN mkdir -p /usr/local/share/npm-global \
 && chown -R node:node /usr/local/share/npm-global
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH="/usr/local/share/npm-global/bin:${PATH}"

ARG CLAUDE_CODE_VERSION=latest
USER node
RUN npm config set strict-ssl false
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} --strict-ssl=false --registry=http://registry.npmjs.org/

USER root
COPY plugin/ /opt/claude-mem/
RUN chown -R node:node /opt/claude-mem

USER node
RUN cd /opt/claude-mem \
 && npm install --omit=dev --legacy-peer-deps --strict-ssl=false --registry=http://registry.npmjs.org/

USER root
RUN mkdir -p /home/node/.claude /home/node/.claude-mem /data/claude-mem \
 && chown -R node:node /home/node/.claude /home/node/.claude-mem /data/claude-mem

COPY --chown=node:node docker/claude-mem/entrypoint.sh /usr/local/bin/claude-mem-entrypoint
RUN chmod +x /usr/local/bin/claude-mem-entrypoint

USER node
WORKDIR /home/node

# Phase 10 — server-beta runtime is the only foregrounded process. The legacy
# worker binaries remain available for tooling but are NEVER spawned by the
# entrypoint. Mode selection happens via CLAUDE_MEM_CONTAINER_MODE
# (server | worker | shell). `docker run ... bash` works because shell mode
# falls through to "$@".
ENV CLAUDE_MEM_CONTAINER_MODE=server
ENV CLAUDE_MEM_RUNTIME=server-beta

ENTRYPOINT ["/usr/local/bin/claude-mem-entrypoint"]
CMD []
