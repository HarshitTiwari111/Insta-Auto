# Using the app without Meta App Review (testers)

Without App Review the Meta app only gets **Standard Access**: it works for people who have a **role on the Meta app** (admin, developer or tester). So every person who connects their Instagram must be added as a tester first. Up to a few hundred testers is fine for a private tool.

## What each person needs
- An Instagram **Business or Creator** account
- That Instagram account linked to a **Facebook Page** (Instagram app → Settings → Accounts Center / Business tools → connect a Facebook Page)
- A Facebook account that manages that Page
- A login for this app (an admin creates it, see README "Create a login")

## 1. Add the person as a tester (app admin)
1. developers.facebook.com → app **AutoReply** → left menu **App roles → Roles**.
2. **Add People** → **Testers** → type their **Facebook** name or Facebook user ID → **Add**.

## 2. The person accepts (on their own Facebook account)
1. Open **https://developers.facebook.com/requests** while logged in to Facebook.
2. **Confirm** the AutoReply tester request. (If Facebook asks to "register as a developer", finish that first; it's free.)

## 3. The person connects Instagram in the app
1. Open the app → **Settings → Connect Instagram account**.
2. In Facebook's window: **Continue**, keep their **Page** and **Instagram account** ticked, allow everything → back in the app it shows "Connected @username".

## 4. Choose the reels a rule runs on
**Rules → New** (or open a rule) → **On comment** → **Runs on → Choose** → tab **Reels** shows every reel on the account → tick the ones you want (or **Select all reels**) → **Use N selected** → **Save rule**.
Nothing selected = the rule runs on all posts and reels.

## Limits of tester mode
- Works only for people added as testers (and admins/developers). Anyone else gets an error when connecting.
- Comment replies, AI replies, private DMs to commenters, post scheduling and analytics work.
- Incoming DMs from the public, competitor lookup and audience demographics need Advanced Access (App Review).
- Comments on selected older reels are checked every 2 minutes (when their comment count goes up), latest posts as before.
