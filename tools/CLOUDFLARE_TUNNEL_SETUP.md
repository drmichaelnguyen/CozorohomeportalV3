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
