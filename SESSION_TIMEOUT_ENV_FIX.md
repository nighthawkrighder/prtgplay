# Session Timeout Fix - Environment Variable Added

## Problem
After changing session timeout from 24 hours → 60 minutes in code:
- ✅ Backend session cookies: 60 minutes
- ✅ Logout button: Working
- ❌ **Frontend timer still showing: "Expires in: 1439:59" (24 hours)**

## Root Cause
The EDR Session Manager was using a **missing environment variable** with a default value:

**File:** `src/services/edrSessionManager.js` (Line 9)
```javascript
this.retentionHours = parseInt(process.env.USER_SESSION_RETENTION_HOURS || '24', 10);
this.sessionTimeout = this.retentionHours * 60 * 60 * 1000;
```

Since `USER_SESSION_RETENTION_HOURS` wasn't in `.env`, it defaulted to **24 hours**.

The frontend timer gets its value from `/api/session/status` endpoint, which calculates:
```javascript
const inactivityExpiry = last + edrManager.sessionTimeout;
timeLeftMs = Math.max(0, inactivityExpiry - Date.now());
```

So the timer was showing 24 hours instead of 60 minutes!

## Solution Applied

### Added to `.env` file:
```bash
# Session timeout (1 hour = 60 minutes)
USER_SESSION_RETENTION_HOURS=1
```

### Restarted server:
```bash
pm2 restart prtg-dashboard --update-env
```

## Now All Timeouts Are Synchronized:

| Component | Timeout | Status |
|-----------|---------|--------|
| Express session cookie | 60 minutes | ✅ Fixed |
| EDR session cookie (login) | 60 minutes | ✅ Fixed |
| EDR session cookie (restore) | 60 minutes | ✅ Fixed |
| EDR session manager timeout | 60 minutes | ✅ Fixed |
| Frontend countdown timer | 60 minutes | ✅ Fixed |

## Testing

1. **Hard refresh your browser** (Ctrl+F5)
2. **Check the timer** - should now show: **"Expires in: 60:00"** or less
3. Timer will count down from 60:00 to 00:00 (60 minutes)
4. When it reaches 00:00, you'll be automatically logged out

## Files Modified
- ✅ `.env` - Added `USER_SESSION_RETENTION_HOURS=1`
- ✅ `src/server.js` - Changed 3 maxAge values to 60 minutes
- ✅ `public/soc-dashboard.html` - Fixed logout button, added spinner, changed label

---

**Now refresh your browser and the timer should show 60:00 (or counting down from there)!** 🎉
