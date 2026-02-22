FROM ubuntu:24.04

ARG USERNAME=bbuser

ENV USERNAME=$USERNAME

COPY oci/app/scripts/build/install_app.sh /opt/browserbird/build/
COPY oci/app/scripts/build/build_app.sh /opt/browserbird/build/
COPY oci/app/scripts/build/setup_user.sh /opt/browserbird/build/
RUN chmod +x /opt/browserbird/build/*.sh

RUN /opt/browserbird/build/install_app.sh
RUN /opt/browserbird/build/setup_user.sh

USER $USERNAME

WORKDIR /app

COPY --chown=$USERNAME:$USERNAME package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=$USERNAME:$USERNAME web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY --chown=$USERNAME:$USERNAME . .

RUN /opt/browserbird/build/build_app.sh

EXPOSE 18800

ENTRYPOINT ["oci/app/scripts/runtime/entrypoint.sh"]
