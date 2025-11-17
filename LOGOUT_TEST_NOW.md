# LOGOUT TESTING INSTRUCTIONS

## Current Situation
You're logged in with Session ID: **c90f5827ca9068ddb3e63bc95a2138faf40d6f736d5da9da6216b5e7b7a6a964**

The "Session: 1439:59" you see in the UI is **NOT** a session ID - it's the **session expiry countdown timer** showing you have ~24 hours remaining before your session expires.

## What I Just Fixed
✅ Cleaned up old stale session from yesterday (ff6f5daab...)
✅ That session was still marked as "active" even though it was from Oct 15

## How to Test Logout NOW

### Step 1: Open Browser Console
1. In your browser, press **F12** to open Developer Tools
2. Click the **Console** tab

### Step 2: Click Logout
1. Click your username "LoginApiUser" in the top right
2. Click **Logout** from the dropdown menu

### Step 3: Watch for These Messages in Console
You should see:
```
🚪 LOGOUT INITIATED: User logged out
📡 Sending logout request to backend...
📡 Logout response status: 200
✅ Logout response: {success: true, ...}
🍪 Clearing client-side cookies...
🍪 Cleared cookie: connect.sid
🍪 Cleared cookie: edr.sid
🗑️ Clearing session data...
✅ Logout complete, redirecting...
```

### Step 4: Verify Redirect
- You should be redirected to `/logout.html`
- You should see a "Logged Out" message

### Step 5: Try to Go Back
1. Click the browser's **back button**
2. You should be **automatically redirected to /login**
3. You should **NOT** be able to access the dashboard without logging in again

## If Logout Doesn't Work

### Check Console for Errors
- Look for red error messages in the Console tab
- Take a screenshot and share it

### Check if Backend Received Logout Request
Run this command on the server:
```bash
grep "Logout initiated" /srv/www/htdocs/cpm/logs/prtg-dashboard.log | tail -3
```

Should show something like:
```
{"level":"info","message":"Logout initiated","sessionId":"xxx","edrSessionId":"c90f5827...","timestamp":"..."}
```

### Manual Cleanup (If Needed)
If logout button doesn't work, manually clean your session:
```bash
node /srv/www/htdocs/cpm/scripts/cleanup-session.js c90f5827ca9068ddb3e63bc95a2138faf40d6f736d5da9da6216b5e7b7a6a964
```

## Understanding the Session Timer

The "Session: 1439:59" display means:
- **1439 minutes** = 23 hours 59 minutes
- This is your **session timeout countdown**
- It counts down from 24 hours (1440 minutes)
- When it reaches 00:00, your session will expire
- You'll see a warning at 5 minutes remaining

This is **NOT** a session ID - it's showing how much time you have left before auto-logout.

## Current Session Status
```
Active Sessions: 1 (yours: c90f5827...)
Logged Out: 2 
```

Your session is the ONLY active one now. The old stale session has been cleaned up.

---

**Please test logout now and let me know what happens!**
