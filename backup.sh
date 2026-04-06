#!/bin/bash

BACKUP_DIR="/home/leo/services/wave-server/backups"
GROUPS_DIR="/home/leo/services/wave-server/groups"
TIMESTAMP=$(date +%Y-%m-%d)

mkdir -p "$BACKUP_DIR"

zip -rq "$BACKUP_DIR/groups-$TIMESTAMP.zip" "$GROUPS_DIR"

# Remove backups older than 1 day
find "$BACKUP_DIR" -name "groups-*.zip" -mtime +0 -not -name "groups-$TIMESTAMP.zip" -delete
