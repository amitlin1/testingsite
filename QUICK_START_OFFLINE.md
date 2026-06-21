# Quick Start: Offline Build & Update

This guide explains how to update the project dependencies and build the application in an offline environment (e.g., air-gapped server).

## Phase 1: Update & Prepare (On ONLINE Machine)

**Goal:** Fetch the latest updates and "pack" them for the offline machine.

1.  **Open PowerShell** in the project folder (`c:\Amit_Projects\testingSite`).

2.  **Run the Update Script:**
    This script will:
    1. Clean your old cache.
    2. Download all current dependencies.
    3. **Auto-patch vulnerabilities** (runs `npm audit fix`).
    4. Save everything into `.npm-offline`.

    ```powershell
    .\scripts\refresh-offline-cache.ps1
    ```

    > **Success:** You should see "Success! Offline cache updated in .npm-offline".

3.  **Prepare Docker Images (If needed):**
    If you haven't done this recently, pull and save the base Docker images:

    ```powershell
    docker pull node:20.18.0-bullseye-slim
    docker save node:20.18.0-bullseye-slim -o node-20.18.0-bullseye-slim.tar
    ```

4.  **Zip the Project:**
    Compress the entire project folder (excluding `node_modules` and `.git`, but **INCLUDING** `.npm-offline`) into a ZIP file.

---

## Phase 2: Transfer (To OFFLINE Machine)

Transfer the following to the offline server:

1.  Your Project ZIP file.
2.  The Docker Image TAR files (`node-*.tar`, `nginx-*.tar`, `postgres-*.tar`).

---

## Phase 3: Build & Run (On OFFLINE Machine)

1.  **Load Images:**

    ```powershell
    docker load -i node-20.18.0-bullseye-slim.tar
    # Load others if needed...
    ```

2.  **Extract Project:**
    Unzip your project to a folder (e.g., `C:\app`).

3.  **Build:**
    Run the Docker Compose build command. The Dockerfile is configured to automatically use the `.npm-offline` folder you prepared.

    ```powershell
    docker compose -f docker-compose.prod.yml build
    ```

4.  **Start:**
    ```powershell
    docker compose -f docker-compose.prod.yml up -d
    ```

---

**Troubleshooting:**

- If the build fails saying "package not found", it means Phase 1 wasn't successful. Run `refresh-offline-cache.ps1` again on an online machine.
