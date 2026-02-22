FROM ubuntu:24.04

ARG WIDTH=1280
ARG HEIGHT=800
ARG USERNAME=bbuser

ENV USERNAME=$USERNAME \
    PLAYWRIGHT_BROWSERS_PATH=/home/$USERNAME/.cache/ms-playwright \
    XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser \
    WAYLAND_DISPLAY=wayland-1 \
    WIDTH=$WIDTH \
    HEIGHT=$HEIGHT

COPY docker/scripts/build/ /opt/browserbird/build/
RUN chmod +x /opt/browserbird/build/*.sh

RUN /opt/browserbird/build/install_system.sh
RUN /opt/browserbird/build/setup_user.sh

COPY --chown=$USERNAME:$USERNAME docker/config/sway/ /home/$USERNAME/.config/sway/
COPY --chown=$USERNAME:$USERNAME docker/config/waybar/ /home/$USERNAME/.config/waybar/

USER $USERNAME

RUN /opt/browserbird/build/install_playwright.sh

WORKDIR /app

COPY --chown=$USERNAME:$USERNAME package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=$USERNAME:$USERNAME web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY --chown=$USERNAME:$USERNAME . .

RUN /opt/browserbird/build/build_app.sh

EXPOSE 5900 6080 18800

ENTRYPOINT ["./docker/scripts/runtime/entrypoint.sh"]
