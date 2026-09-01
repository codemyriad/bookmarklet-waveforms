# The official container has the entrypoint/runtime behavior Gocassini expects.
# Replace only its application tree with the next major's signed release
# candidate, then add the matching Talk pre-release selected by CI.
FROM nextcloud:34.0.0-apache

ARG NEXTCLOUD_ARCHIVE=https://download.nextcloud.com/server/prereleases/nextcloud-35.0.0rc2.tar.bz2
ARG TALK_ARCHIVE
ARG GROUPFOLDERS_ARCHIVE
ARG GROUP_EVERYONE_ARCHIVE=https://github.com/icewind1991/group_everyone/releases/download/v0.1.20/group_everyone-v0.1.20.tar.gz

RUN set -eux; \
	test -n "$TALK_ARCHIVE"; \
	test -n "$GROUPFOLDERS_ARCHIVE"; \
	test -n "$GROUP_EVERYONE_ARCHIVE"; \
	curl -fsSLo /tmp/nextcloud.tar.bz2 "$NEXTCLOUD_ARCHIVE"; \
	expected="$(curl -fsSL "$NEXTCLOUD_ARCHIVE.sha256" | awk 'NR == 1 { print $1; exit }')"; \
	echo "$expected  /tmp/nextcloud.tar.bz2" | sha256sum -c -; \
	find /usr/src/nextcloud -mindepth 1 -maxdepth 1 -exec rm -rf {} +; \
	tar -xjf /tmp/nextcloud.tar.bz2 --strip-components=1 -C /usr/src/nextcloud; \
	curl -fsSL "$TALK_ARCHIVE" | tar -xz -C /usr/src/nextcloud/apps; \
	curl -fsSL "$GROUPFOLDERS_ARCHIVE" | tar -xz -C /usr/src/nextcloud/apps; \
	# Gocassini uses group_everyone only to prepare its disposable test users. \
	# Its current release predates NC35, so widen that test-only compatibility \
	# declaration by one major while the app catches up. \
	curl -fsSL "$GROUP_EVERYONE_ARCHIVE" | tar -xz -C /usr/src/nextcloud/apps; \
	sed -i 's/max-version="34"/max-version="35"/' /usr/src/nextcloud/apps/group_everyone/appinfo/info.xml; \
	chown -R nobody:nogroup /usr/src/nextcloud; \
	rm /tmp/nextcloud.tar.bz2
