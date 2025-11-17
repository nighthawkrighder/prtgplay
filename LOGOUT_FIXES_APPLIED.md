# Logout & Session Timeout Fixes Applied

## Changes Made

### 1. ✅ Session Timeout Changed: 24 hours → 60 minutes

Updated in **3 locations** in `src/server.js`:

**Line 47:** Express session cookie maxAge
```javascript
maxAge: 60 * 60 * 1000 // 60 minutes (was 24 hours)
```

**Line 181:** EDR session cookie on login
```javascript
maxAge: 60 * 60 * 1000, // 60 minutes (was 24 hours)
```

**Line 240:** EDR session cookie on auto-restore
```javascript
maxAge: 60 * 60 * 1000, // 60 minutes (was 24 hours)
```

### 2. ✅ Logout Button Fixed - Now Works Immediately

#### Problem
- Logout button called `showLogoutConfirm()` modal that wasn't rendering
- No visual feedback during logout
- User couldn't tell if logout was happening

#### Solution
Changed `logout()` function in `soc-dashboard.html` (line ~2063):
- **OLD:** Called broken modal function `showLogoutConfirm()`
- **NEW:** Shows simple browser confirm dialog → immediate logout

```javascript
logout() {
    // Show confirmation and force logout immediately
    if (confirm('Are you sure you want to logout?')) {
        this.forceLogout('User logged out');
    }
}
```

### 3. ✅ Added Visual Loading Spinner During Logout

Added spinner overlay in `forceLogout()` function:
- Shows **🚪 "Logging out..."** modal immediately when logout starts
- Provides clear visual feedback that action is in progress
- Prevents user confusion about whether logout is working

```javascript
// Show loading spinner immediately
<div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
            background: rgba(0,0,0,0.7); z-index: 999999;">
    <div>🚪</div>
    <div>Logging out...</div>
</div>
```

### 4. ✅ UI Timer Label Improved

Changed session countdown display:
- **OLD:** "Session: 1439:59" (confusing - looks like session ID)
- **NEW:** "Expires in: 59:59" (clear - it's a countdown)

Now shows **60:00** counting down to **00:00** (60 minutes)

## Testing Instructions

### Test Session Timeout (60 minutes)
1. Login to dashboard
2. Check countdown timer - should show "Expires in: 60:00"
3. Wait and watch it count down (or wait 60 minutes for auto-logout)

### Test Logout Button
1. **Open browser console (F12)** to see emoji logs
2. Click your username → **Logout**
3. **Should see:**
   - Browser confirm dialog: "Are you sure you want to logout?"
   - Click OK
   - **Loading spinner** appears: "🚪 Logging out..."
   - Console shows:
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
   - Redirect to `/logout.html`
4. Click browser back button → should redirect to `/login` (NOT dashboard)

### Verify Backend Logs
```bash
grep "Logout initiated" logs/prtg-dashboard.log | tail -3
```

Should show logout activity with your session ID.

## What Was Fixed

| Issue | Status | Solution |
|-------|--------|----------|
| Session timeout too long (24 hours) | ✅ Fixed | Changed to 60 minutes in 3 places |
| Logout button has no effect | ✅ Fixed | Replaced broken modal with simple confirm |
| No visual feedback during logout | ✅ Fixed | Added loading spinner overlay |
| Confusing "Session: 1439:59" display | ✅ Fixed | Changed to "Expires in: 60:00" |
| Timer doesn't match actual timeout | ✅ Fixed | Now shows 60 minutes countdown |

## Files Modified
- ✅ `src/server.js` - 3 timeout values changed (24h → 60m)
- ✅ `public/soc-dashboard.html` - logout() function fixed, spinner added, timer label improved

---

**Server restarted with PM2 - all changes are now active!**

Ready to test? Click logout and watch the magic happen! 🚀
