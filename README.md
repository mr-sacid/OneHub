# One Hub

A personal hub for meals, study, side projects, budget, schedule, fitness and a roadmap.
It installs on a phone like an app, works offline, and syncs through your own Supabase project.

This repository holds the app's code only. Your entries live in your Supabase database, behind your sign-in.

## Files

| File | What it is |
|---|---|
| `index.html` | The app. Built from `../one-hub.html` by `build.js`; do not edit it by hand. |
| `config.js` | Your Supabase project URL and publishable (anon) key. |
| `supabase.sql` | Run once in Supabase to create the table and lock each row to its owner. |
| `sw.js` | Offline support. |
| `manifest.webmanifest`, `icons/` | What makes it installable. |
| `build.js`, `make-icons.js` | Rebuild the page and the icons. |

## Set up

1. **Supabase:** create a project, open SQL Editor, paste `supabase.sql`, run it.
2. **Connection details:** in Supabase open Project Settings, then API. Put the Project URL and the publishable (anon) key into `config.js`. Never use the secret or service_role key.
3. **GitHub Pages:** push this folder to a repository, then in the repository open Settings, Pages, and deploy from the `main` branch, root folder.
4. **Supabase sign-in address:** in Supabase open Authentication, URL Configuration, and set Site URL to your Pages address.
5. **Create your account** in the app, confirm the email, sign in.
6. **Close sign-ups:** in Supabase open Authentication, Sign In / Providers, and turn off "Allow new users to sign up" so nobody else can make an account.

## Install on a phone

- **Android (Chrome):** open the Pages address, menu, "Install app" or "Add to Home screen".
- **iPhone (Safari):** open the Pages address, Share, "Add to Home Screen".

## Update the app

Edit `../one-hub.html`, then:

```bash
node build.js
```

Commit and push. Phones pick up the new version the next time they open the app online.

## Backups

In the app: Account, "Download a backup". Keep backup files out of this repository; `.gitignore` already blocks the usual names.
