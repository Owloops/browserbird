FROM ubuntu:24.04

ARG WIDTH=1920
ARG HEIGHT=1080
ARG USERNAME=bbuser

ENV USERNAME=$USERNAME \
    LANG=C.UTF-8 \
    PLAYWRIGHT_BROWSERS_PATH=/home/$USERNAME/.cache/ms-playwright \
    XDG_RUNTIME_DIR=/tmp/xdg-runtime-bbuser \
    WAYLAND_DISPLAY=wayland-1 \
    DISPLAY=:1 \
    WIDTH=$WIDTH \
    HEIGHT=$HEIGHT

COPY oci/vm/scripts/build/install_system.sh /opt/browserbird/build/
COPY oci/vm/scripts/build/install_playwright.sh /opt/browserbird/build/
COPY oci/vm/scripts/build/setup_user.sh /opt/browserbird/build/
RUN chmod +x /opt/browserbird/build/*.sh

RUN /opt/browserbird/build/install_system.sh
RUN /opt/browserbird/build/setup_user.sh

COPY --chown=$USERNAME:$USERNAME oci/vm/config/sway/ /home/$USERNAME/.config/sway/
COPY --chown=$USERNAME:$USERNAME oci/vm/config/waybar/ /home/$USERNAME/.config/waybar/
COPY --chown=$USERNAME:$USERNAME oci/vm/config/foot/foot.ini /home/$USERNAME/.config/foot/foot.ini
COPY --chown=$USERNAME:$USERNAME oci/vm/config/fontconfig/fonts.conf /home/$USERNAME/.config/fontconfig/fonts.conf
COPY oci/vm/config/playwright.config.json /opt/browserbird/
COPY oci/vm/config/stealth.js /opt/browserbird/
COPY oci/vm/config/supervisord.conf /opt/browserbird/supervisord.conf

COPY oci/vm/scripts/runtime/ /opt/browserbird/runtime/
RUN chmod +x /opt/browserbird/runtime/*.sh

USER $USERNAME

RUN /opt/browserbird/build/install_playwright.sh

WORKDIR /opt/browserbird

USER root

EXPOSE 5900 6080 3000 3001

ENTRYPOINT ["/opt/browserbird/runtime/entrypoint.sh"]
