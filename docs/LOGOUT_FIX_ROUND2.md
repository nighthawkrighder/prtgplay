# LOGOUT FIX - Round 2 Implementation

## Issue Recap
After implementing initial logout fixes, testing revealed the logout button wasn't working as expected. Session ID `5341545e5c2eaf7febbf0547de862c1db2ef1ac9be1ac12b229310d21823b6a2` was persisting even after attempted logouts.

## Root Cause Analysis

### What We Found:
1. **No logout requests were reaching the backend** - Log analysis showed no "logout initiated" messages
2. **Session remained "active" in database** - The EDR session was never marked as "logged_out"
3. **Multiple express sessions restored from same EDR cookie** - Every page refresh created a new express session ID but restored authentication from the persistent EDR cookie

### Why This Happened:
- User wasn't actually clicking the logout button (or it wasn't working)
- Frontend `forceLogout()` function was catching errors silently without logging
- No client-side cookie cleanup as backup
- No graceful logout on tab close

## Additional Fixes Implemented

### 1. Enhanced Frontend Logging (`public/soc-dashboard.html`)
Added comprehensive console logging to `forceLogout()` function:
```javascript
async forceLogout(reason = 'Session expired') {
    console.log('🚪 LOGOUT INITIATED:', reason);
    console.log('📡 Sending logout request to backend...');
    // ... detailed logging throughout the function
    console.log('✅ Logout complete, redirecting...');
}
```

**Benefits:**
- Developers can see exactly where logout fails
- Browser console shows step-by-step logout progress
- Easier to debug user-reported issues

### 2. Client-Side Cookie Cleanup
Added explicit cookie clearing in `forceLogout()`:
```javascript
// Clear cookies client-side as well
console.log('🍪 Clearing client-side cookies...');
document.cookie.split(";").forEach(function(c) { 
    const cookieName = c.trim().split("=")[0];
    if (cookieName === 'connect.sid' || cookieName === 'edr.sid') {
        document.cookie = cookieName + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
        console.log('🍪 Cleared cookie:', cookieName);
    }
});
```

**Benefits:**
- Even if backend logout fails, cookies are cleared
- User won't be auto-restored from stale cookies
- Defense-in-depth approach

### 3. Graceful Tab Close Logout
Added `beforeunload` event handler using `sendBeacon`:
```javascript
window.addEventListener('beforeunload', (e) => {
    if (navigator.sendBeacon && document.cookie.includes('edr.sid')) {
        console.log('🚪 Attempting graceful logout on tab close...');
        navigator.sendBeacon('/logout', JSON.stringify({}));
    }
});
```

**Benefits:**
- Logout notification sent even when user closes tab/window
- `sendBeacon` is more reliable than `fetch` during page unload
- Helps clean up sessions when users don't explicitly logout

### 4. Backend Support for sendBeacon (`src/server.js`)
Enhanced `/logout` endpoint to detect and handle `sendBeacon` requests:
```javascript
const isBeacon = req.headers['content-type'] === 'text/plain;charset=UTF-8';

// Send response based on request type
if (isBeacon) {
    return res.status(204).end(); // No Content for beacon
}
```

**Benefits:**
- Properly handles different logout request types
- Returns appropriate HTTP status codes
- Better logging for debugging

### 5. GET Support for Logout
Added `app.get('/logout', ...)` endpoint:
```javascript
app.get('/logout', async (req, res) => {
    // Same logout logic as POST
    // Redirect to logout page
});
```

**Benefits:**
- Allows simple `<a href="/logout">` links
- Users can manually navigate to `/logout` URL
- More flexible logout options

## Files Modified

1. ✅ `public/soc-dashboard.html` - Enhanced logging, cookie cleanup, beforeunload handler
2. ✅ `src/server.js` - sendBeacon support, GET logout endpoint
3. ✅ `scripts/check-session.js` - New utility for debugging specific sessions (NEW)

## Manual Session Cleanup

We also manually terminated the persisting session:
```bash
node scripts/cleanup-session.js 5341545e5c2eaf7febbf0547de862c1db2ef1ac9be1ac12b229310d21823b6a2
```

Output:
```
✅ Session marked as logged_out
```

## Testing Instructions

### Test 1: Normal Logout Flow
1. Open dashboard in browser
2. Open browser Developer Tools (F12) → Console tab
3. Click the user menu → Logout
4. Watch console output - should see:
   ```
   🚪 LOGOUT INITIATED: User logged out
   📡 Sending logout request to backend...
   📡 Logout response status: 200
   ✅ Logout response: {success: true, redirect: '/logout.html?sessionId=...'}
   🍪 Clearing client-side cookies...
   🍪 Cleared cookie: connect.sid
   🍪 Cleared cookie: edr.sid
   🗑️ Clearing session data...
   ✅ Logout complete, redirecting...
   ```
5. Should redirect to logout.html
6. Try to navigate back to dashboard - should redirect to login

### Test 2: Tab Close Logout
1. Login to dashboard
2. Open Developer Tools → Console
3. Close the browser tab
4. Before closing, console should show:
   ```
   🚪 Attempting graceful logout on tab close...
   ```
5. Check server logs:
   ```bash
   grep "Logout initiated" /srv/www/htdocs/cpm/logs/prtg-dashboard.log | tail -1
   ```
6. Should show logout was triggered

### Test 3: Session Cleanup
1. Login to dashboard
2. Close browser without logout
3. Check sessions:
   ```bash
   node scripts/check-session.js
   ```
4. Session should eventually be marked as logged_out or expired

### Test 4: No Auto-Restore After Logout
1. Login to dashboard
2. Properly logout using button
3. Close browser completely
4. Reopen browser
5. Navigate to dashboard
6. Should be redirected to login (no automatic restore)

## Monitoring Commands

### Check if logout is working:
```bash
# Watch for logout requests in real-time
tail -f /srv/www/htdocs/cpm/logs/prtg-dashboard.log | grep -i logout
```

### Check session status:
```bash
# List all sessions
node scripts/cleanup-session.js --list

# Check specific session
node scripts/check-session.js SESSION_ID
```

### Manual cleanup if needed:
```bash
# Clean specific session
node scripts/cleanup-session.js SESSION_ID

# Clean all logged-out sessions
node scripts/cleanup-session.js --all-logged-out
```

## What Changed vs. First Implementation

### First Implementation:
- Fixed backend logout handler (async/await)
- Added session status checking in auto-restore
- Enhanced validateSession()
- Added manual cleanup scripts

### Second Implementation (This Round):
- ✅ Added comprehensive frontend logging
- ✅ Client-side cookie cleanup as backup
- ✅ Graceful logout on tab close (sendBeacon)
- ✅ Backend support for different logout methods
- ✅ GET endpoint for logout
- ✅ Better error visibility for debugging

## Expected Behavior Now

1. **Explicit Logout**: User clicks logout → Backend notified → Cookies cleared → Session terminated
2. **Tab Close**: User closes tab → sendBeacon fires → Backend notified → Session terminated
3. **Session Restoration**: Only "active" sessions are restored, never "logged_out" or "expired"
4. **Client Protection**: Even if backend fails, cookies are cleared client-side
5. **Debugging**: Console logs show exactly what's happening during logout

## If Issues Persist

### Check Browser Console:
- Open Developer Tools → Console
- Look for logout messages
- Check for JavaScript errors

### Check Server Logs:
```bash
# Look for logout attempts
grep "Logout initiated" /srv/www/htdocs/cpm/logs/prtg-dashboard.log | tail -20

# Look for specific session
grep "SESSION_ID" /srv/www/htdocs/cpm/logs/prtg-dashboard.log | tail -10
```

### Manual Testing:
```bash
# Test logout endpoint directly
curl -X POST http://localhost:3010/logout \
  -H "Cookie: connect.sid=YOUR_SESSION_ID" \
  -H "Accept: application/json" \
  -v
```

### Nuclear Option:
```bash
# If all else fails, manually clean up all sessions
node scripts/cleanup-session.js --all-logged-out
mysql -u sqladmin -p cpm_dashboard -e "UPDATE user_sessions SET session_status='logged_out', logout_time=NOW() WHERE session_status='active';"
```

## Success Metrics

✅ Console shows logout flow with emojis
✅ "Logout initiated" appears in server logs
✅ Cookies are cleared (both server and client)
✅ Session status changes to "logged_out" in database
✅ No auto-restore after explicit logout
✅ Users see logout.html page after logout
✅ Navigation back to dashboard requires re-login

---

**Status**: ✅ Deployed and running
**Version**: 2.0 (Enhanced Logout)
**Date**: October 16, 2025
