ARG NEXTCLOUD_BASE=nextcloud:34.0.0
FROM ${NEXTCLOUD_BASE}

ARG TALK_ARCHIVE
ARG GROUPFOLDERS_ARCHIVE
ARG GROUP_EVERYONE_ARCHIVE=https://github.com/icewind1991/group_everyone/releases/download/v0.1.20/group_everyone-v0.1.20.tar.gz

# Bundle exact app versions into the image so compatibility CI does not depend
# on live App Store installation during Gocassini bootstrap.
RUN set -eux; \
	test -n "$TALK_ARCHIVE"; \
	test -n "$GROUPFOLDERS_ARCHIVE"; \
	curl -fsSL "$TALK_ARCHIVE" | tar -xz -C /usr/src/nextcloud/apps; \
	curl -fsSL "$GROUPFOLDERS_ARCHIVE" | tar -xz -C /usr/src/nextcloud/apps; \
	curl -fsSL "$GROUP_EVERYONE_ARCHIVE" | tar -xz -C /usr/src/nextcloud/apps; \
	chown -R nobody:nogroup /usr/src/nextcloud/apps
