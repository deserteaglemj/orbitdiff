# Local authentication

OrbitDiff never asks for or accepts credentials. A human creates an Instaloader session in their own terminal before OrbitDiff scans a public target:

```bash
instaloader --login YOUR_INSTAGRAM_USERNAME
```

Stop while the human completes this step. Do not ask them to paste a password, verification code, session material, browser data, or any credential into chat.

After the human confirms the saved local session exists, OrbitDiff can load it by login username:

```bash
orbitdiff init PUBLIC_TARGET --login LOGIN_USERNAME
```

If the session is missing, expired, challenged, or rejected, stop and ask the human to resolve it locally. Do not invent a workaround or add a new login flow.
