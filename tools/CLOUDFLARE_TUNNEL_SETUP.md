# Cloudflare Tunnel Setup

This is the stable version of the temporary tunnel approach.

## What you need

- A Cloudflare account
- `cozorohome.com` added to Cloudflare as a zone
- DNS for `app.cozorohome.com` managed in Cloudflare
- `cloudflared.exe` already exists at:
  - `C:\Users\User\Desktop\cozorohome webapp\tools\cloudflared.exe`

## Important limitation

If `cozorohome.com` stays fully managed only on Hawk Host DNS, you cannot use the best version of named Cloudflare Tunnel for `app.cozorohome.com`.

The stable setup is:

1. Add `cozorohome.com` to Cloudflare
2. Change nameservers at your registrar to the Cloudflare nameservers
3. Create a named tunnel
4. Route `app.cozorohome.com` to `http://localhost:3000`

Official docs:

- https://developers.cloudflare.com/tunnel/setup/
- https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/routing-to-tunnel/dns/
- https://developers.cloudflare.com/dns/nameservers/

## One-time Cloudflare login on this PC

Open PowerShell:

```powershell
cd "C:\Users\User\Desktop\cozorohome webapp\tools"
.\cloudflared.exe tunnel login
```

That opens a browser and asks you to choose the Cloudflare zone.

## Create a named tunnel

```powershell
cd "C:\Users\User\Desktop\cozorohome webapp\tools"
.\cloudflared.exe tunnel create cozorohome-portal
```

Cloudflare will print a tunnel ID and create a credentials JSON file in:

- `C:\Users\User\.cloudflared\`

## Configure the tunnel

Copy:

- `C:\Users\User\Desktop\cozorohome webapp\tools\cloudflared-config.example.yml`

to:

- `C:\Users\User\.cloudflared\config.yml`

Then replace:

- `REPLACE_WITH_TUNNEL_ID`

with your real tunnel ID.

## Create the public hostname

```powershell
cd "C:\Users\User\Desktop\cozorohome webapp\tools"
.\cloudflared.exe tunnel route dns cozorohome-portal app.cozorohome.com
```

## Run the local app through the tunnel

Use the helper script:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\cozorohome webapp\tools\start-local-portal-tunnel.ps1"
```

Or, once your local API and portal are already running:

```powershell
cd "C:\Users\User\Desktop\cozorohome webapp\tools"
.\cloudflared.exe tunnel run cozorohome-portal
```

## What this gives you

- Stable hostname: `https://app.cozorohome.com`
- No changing `trycloudflare.com` URL
- Tunnel traffic goes to your local portal on `localhost:3000`
- The portal already proxies API requests to `localhost:4000`

## Recommended next improvement

If you want the API to have its own stable hostname too, add another ingress hostname such as:

- `api.cozorohome.com`

and point it to:

- `http://localhost:4000`

## Chatbot tunnel (recommended separate named tunnel)

This keeps the chatbot independent from the portal tunnel and avoids accidental downtime when restarting the portal tunnel.

Runtime model:

- `chatbot.cozorohome.com` is not served by the main portal or the main API
- it is served by the separate `bot/` service
- the Windows Cloudflare tunnel for the chatbot points to the Windows-local origin `http://127.0.0.1:4111`
- if the bot is only running inside WSL and not reachable from Windows on `127.0.0.1:4111`, the public chatbot hostname can fail even though the bot looks healthy inside WSL

Recommended operational rule:

- run the chatbot on Windows on port `4111` whenever you need the public hostname to work through Cloudflare
- keep this separate from the main portal tunnel and the main API process

### Create the chatbot tunnel

```powershell
cd "C:\Users\User\Desktop\cozorohome webapp\tools"
.\cloudflared.exe tunnel create cozorohome-chatbot
```

### Configure the chatbot tunnel

Copy:

- `C:\Users\User\Desktop\cozorohome webapp\tools\cloudflared-config.chatbot.example.yml`

to:

- `C:\Users\User\.cloudflared\config.chatbot.yml`

Then replace:

- `REPLACE_WITH_CHATBOT_TUNNEL_ID`

with your real tunnel ID.

### Route the DNS hostname

```powershell
cd "C:\Users\User\Desktop\cozorohome webapp\tools"
.\cloudflared.exe tunnel --config "C:\Users\User\.cloudflared\config.chatbot.yml" route dns cozorohome-chatbot chatbot.cozorohome.com
```

### Run the tunnel

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\cozorohome webapp\tools\restart-chatbot-tunnel.ps1"
```

This will expose your local chatbot at:

- `https://chatbot.cozorohome.com`

### Run the bot process that the tunnel expects

The chatbot tunnel config routes traffic to `http://127.0.0.1:4111`, so make sure the bot is running on Windows on that port:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\User\Desktop\cozorohome webapp\bot\start-bot-win.ps1"
```

Or use the repo helper:

```batch
C:\Users\User\Desktop\cozorohome webapp\start-bot-wsl.bat restart
```

Useful checks:

- local bot health: `http://127.0.0.1:4111/health`
- public bot health: `https://chatbot.cozorohome.com/health`
