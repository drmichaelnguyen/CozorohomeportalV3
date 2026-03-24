# Cozorohome Failover & Redundancy Guide

This guide explains how to set up and use a backup computer if the primary server fails.

## 1. Redundancy Setup (Preparation)

To ensure you can switch to a backup machine quickly:

### Continuous Mirroring
1.  **Use OneDrive/Google Drive**: Ensure the `api/data` folder and the `.env` file are mirrored to the cloud. The `backup-sync.cmd` script in the `scripts/` folder automates this.
2.  **Network Mirroring**: If the backup computer is in the same local network, you can set `BACKUP_ROOT` in `backup-sync.cmd` to a network share on the backup machine (e.g., `\\BACKUP-PC\CozoroMirror`).

### Backup Machine Preparation
1.  **Clone the Repository**: Ensure the `cozorohome webapp` folder is present on the backup machine.
2.  **Install Environment**:
    *   Install **Node.js** (v18 or later).
    *   Run `npm install` in both `api/` and `portal/` directories.
3.  **Sync Data**: Run the `backup-sync.cmd` script regularly or ensure OneDrive is active to keep the `api/data` and `.env` files up to date.

## 2. Failover Procedure (When Primary Dies)

If the primary computer fails:

1.  **Verify Data**: On the backup computer, ensure `api/data` contains the latest JSON caches (check many `*-cache.json` files).
2.  **Start the API**:
    *   Open terminal in `api/`.
    *   Run `npm run dev` (or your production start command).
    *   Ensure it starts on port **4000**.
3.  **Start the Portal**:
    *   Open terminal in `portal/`.
    *   Run `npm run dev`.
4.  **Update Accessibility**:
    *   **Cloudflare Tunnel**: If you use `cloudflared`, start it on the backup machine using the same token or pointing the public hostname to the backup machine's local port.
    *   **Local Access**: If users connect via IP, provide them the backup machine's local IP address.

## 3. Vietnam Backup (Remote Redundancy)

For the computer in Vietnam:
1.  Use **OneDrive** to mirror the `api/data` and `.env`.
2.  Because the latency is high, this should be considered a "disaster recovery" option rather than a "hot standby".
3.  Ensure the Vietnam computer has a stable internet connection for the Cloudflare Tunnel.

---
**Tip**: Schedule `backup-sync.cmd` via Windows Task Scheduler (e.g., every 60 minutes) to ensure data loss is minimal.
