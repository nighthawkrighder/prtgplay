/*
 * PRTG Dashboard - Browser Console Helper
 * 
 * Copy and paste this into your browser console (F12) to debug issues
 */

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function prtgDiagnostics() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║       PRTG Dashboard Browser Diagnostics                    ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    
    // Check version
    const htmlComment = document.documentElement.innerHTML.match(/<!-- SOC Dashboard (v[\d.]+) - (.+?) -->/);
    if (htmlComment) {
        console.log('📌 Version:', htmlComment[1]);
        console.log('📝 Build:', htmlComment[2]);
    }
    console.log('');
    
    // Check dashboard object
    console.log('🔍 Dashboard Object:');
    console.log('   - Exists:', !!window.dashboard);
    if (window.dashboard) {
        console.log('   - Companies:', window.dashboard.companies?.size || 0);
        console.log('   - Devices:', window.dashboard.devices?.length || 0);
        console.log('   - WebSocket:', window.dashboard.ws?.readyState === 1 ? '✅ Connected' : '❌ Disconnected');
    }
    console.log('');
    
    // Check DOM structure
    console.log('📊 DOM Structure:');
    const sections = document.querySelectorAll('.company-section');
    console.log('   - Company Sections:', sections.length);
    
    const grids = document.querySelectorAll('.devices-grid');
    console.log('   - Total Grids:', grids.length);
    
    // Check for nesting issues
    let nestingIssues = 0;
    grids.forEach((grid, idx) => {
        const parent = grid.parentElement;
        const isValid = parent && parent.classList.contains('company-content');
        if (!isValid) {
            console.warn(`   ⚠️ Grid ${idx}: Invalid parent (${parent?.className || 'none'})`);
            nestingIssues++;
        }
    });
    
    if (nestingIssues === 0) {
        console.log('   ✅ No nesting issues detected');
    } else {
        console.warn(`   ⚠️ ${nestingIssues} nesting issues found!`);
    }
    console.log('');
    
    // Check localStorage
    console.log('💾 LocalStorage:');
    const securitySession = localStorage.getItem('securitySession');
    if (securitySession) {
        try {
            const session = JSON.parse(securitySession);
            console.log('   - Session User:', session.username || 'N/A');
            console.log('   - Session Age:', Math.floor((Date.now() - session.loginTime) / 1000 / 60), 'minutes');
        } catch (e) {
            console.warn('   ⚠️ Invalid session data');
        }
    } else {
        console.log('   - No session data (using server-side auth)');
    }
    console.log('');
    
    // Check for device cards
    const deviceCards = document.querySelectorAll('.device-card');
    console.log('📱 Device Cards:');
    console.log('   - Total Cards:', deviceCards.length);
    
    // Check for misplaced cards
    let misplacedCards = 0;
    deviceCards.forEach(card => {
        const parent = card.parentElement;
        if (!parent || !parent.classList.contains('devices-grid')) {
            console.warn('   ⚠️ Misplaced card found');
            misplacedCards++;
        }
    });
    
    if (misplacedCards === 0) {
        console.log('   ✅ All cards properly placed');
    } else {
        console.warn(`   ⚠️ ${misplacedCards} misplaced cards!`);
    }
    console.log('');
    
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║ Diagnostics Complete                                        ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
}

// ═══════════════════════════════════════════════════════════════
// FIX FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function prtgClearCache() {
    console.log('🧹 Clearing browser cache...');
    localStorage.clear();
    sessionStorage.clear();
    console.log('✅ Cache cleared!');
    console.log('📝 Now hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)');
}

function prtgFixNesting() {
    console.log('🔧 Running cleanup to fix nesting...');
    if (window.dashboard && typeof window.dashboard.cleanupNestedGrids === 'function') {
        window.dashboard.cleanupNestedGrids();
        console.log('✅ Cleanup complete!');
    } else {
        console.error('❌ Dashboard cleanup function not available');
        console.log('💡 Try refreshing the page first');
    }
}

function prtgReload() {
    console.log('🔄 Reloading dashboard data...');
    if (window.dashboard && typeof window.dashboard.loadData === 'function') {
        window.dashboard.loadData();
        console.log('✅ Data reload initiated');
    } else {
        console.error('❌ Dashboard not available');
    }
}

function prtgShowCompanies() {
    console.log('🏢 Companies loaded:');
    if (window.dashboard && window.dashboard.companies) {
        const companies = Array.from(window.dashboard.companies.values())
            .sort((a, b) => a.name.localeCompare(b.name));
        
        console.table(companies.map(c => ({
            Code: c.code,
            Name: c.name,
            Devices: c.devices.length,
            Up: c.stats.up,
            Down: c.stats.down,
            Warning: c.stats.warning
        })));
    } else {
        console.error('❌ No companies data available');
    }
}

// ═══════════════════════════════════════════════════════════════
// QUICK REFERENCE
// ═══════════════════════════════════════════════════════════════

console.log('%c═══════════════════════════════════════════════════════════════', 'color: #3498db; font-weight: bold');
console.log('%c PRTG Dashboard - Browser Console Helper Loaded! ', 'color: #3498db; font-weight: bold; background: #1a1a2e; padding: 5px');
console.log('%c═══════════════════════════════════════════════════════════════', 'color: #3498db; font-weight: bold');
console.log('');
console.log('%cAvailable Commands:', 'color: #2ecc71; font-weight: bold');
console.log('');
console.log('  %cprtgDiagnostics()%c   - Run full diagnostics check', 'color: #3498db', 'color: inherit');
console.log('  %cprtgClearCache()%c    - Clear localStorage and sessionStorage', 'color: #3498db', 'color: inherit');
console.log('  %cprtgFixNesting()%c    - Fix any nesting issues', 'color: #3498db', 'color: inherit');
console.log('  %cprtgReload()%c        - Reload dashboard data', 'color: #3498db', 'color: inherit');
console.log('  %cprtgShowCompanies()%c - Show all companies table', 'color: #3498db', 'color: inherit');
console.log('');
console.log('%c💡 Quick Fix:', 'color: #f39c12; font-weight: bold');
console.log('  If you see nesting issues, run: %cprtgFixNesting()', 'color: #e74c3c; font-weight: bold');
console.log('');
console.log('%c═══════════════════════════════════════════════════════════════', 'color: #3498db; font-weight: bold');

// Auto-run diagnostics
prtgDiagnostics();
