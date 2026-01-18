// State
let blindspots = [];
let loading = false;

// Theme
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

// API
async function fetchBlindspots() {
  const res = await fetch('/api/blindspots');
  return res.json();
}

async function refreshData() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'Refreshing...';
  
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json();
    
    if (data.ok) {
      await loadBlindspots();
      showToast(`Refreshed: ${data.stories} stories`);
    }
  } catch (err) {
    showToast('Refresh failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

// Render
function renderBlindspots() {
  const grid = document.getElementById('grid');
  
  if (blindspots.length === 0 && !loading) {
    grid.innerHTML = `
      <div class="empty" style="grid-column: 1/-1;">
        <h3>No blindspots detected</h3>
        <p>All stories have balanced coverage across the political spectrum</p>
      </div>
    `;
    return;
  }
  
  const html = blindspots.map(item => {
    const bar = item.bias_bar || {};
    const segments = [
      { type: 'left', value: bar.left || 0 },
      { type: 'center', value: bar.center || 0 },
      { type: 'right', value: bar.right || 0 },
      { type: 'unknown', value: bar.unknown || 0 }
    ].filter(seg => seg.value > 0);
    
    // Determine badge color based on blindspot kind
    const badgeClass = item.kind.includes('Left') ? 'badge-left' : 'badge-right';
    
    return `
      <div class="story" data-id="${item.story_id}">
        <div style="margin-bottom: 8px;">
          <span class="pill ${badgeClass}" style="font-weight: 700;">
            ${item.kind}
          </span>
        </div>
        <div class="storyTitle">${escapeHtml(item.title)}</div>
        <div class="storyMeta">
          <span class="pill">${item.coverage} source${item.coverage !== 1 ? 's' : ''}</span>
          <span class="pill">${item.lean || 'Unknown'}</span>
          <span class="pill">Score ${item.bias_score?.toFixed(2) || '0.00'}</span>
        </div>
        <div class="biasBarWrap">
          <div class="biasLabels">
            <span>Left</span>
            <span>Center</span>
            <span>Right</span>
            <span>Unknown</span>
          </div>
          <div class="biasBar">
            ${segments.map(seg => `
              <div class="biasSegment ${seg.type}" style="width: ${seg.value * 100}%"></div>
            `).join('')}
          </div>
        </div>
        <div class="storyActions">
          <button class="btn ghost wide" onclick="viewStory('${item.story_id}')">
            View Coverage
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  grid.innerHTML = html;
}

function updateMeta(data) {
  const el = document.getElementById('updatedText');
  if (data.last_updated) {
    const date = new Date(data.last_updated);
    const formatted = formatRelativeTime(date);
    el.textContent = `Updated ${formatted}`;
  }
}

async function loadBlindspots() {
  if (loading) return;
  
  loading = true;
  const grid = document.getElementById('grid');
  
  grid.innerHTML = `
    <div class="loading" style="grid-column: 1/-1;">
      <div class="spinner"></div>
      <p>Finding blindspots...</p>
    </div>
  `;
  
  try {
    const data = await fetchBlindspots();
    blindspots = data.items || [];
    renderBlindspots();
    updateMeta(data);
  } catch (err) {
    console.error('Load failed:', err);
    grid.innerHTML = `
      <div class="empty" style="grid-column: 1/-1;">
        <h3>Failed to load</h3>
        <p>Please try again</p>
      </div>
    `;
  } finally {
    loading = false;
  }
}

// Navigation
function viewStory(id) {
  window.location.href = `/story/${id}`;
}

// Utilities
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'error' ? 'var(--danger)' : 'var(--success)'};
    color: white;
    padding: 16px 24px;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-xl);
    font-weight: 600;
    z-index: 9999;
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Init
async function init() {
  initTheme();
  
  // Event listeners
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('refreshBtn').addEventListener('click', refreshData);
  
  // Load data
  await loadBlindspots();
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
  .badge-left {
    background: linear-gradient(135deg, var(--left), #60a5fa) !important;
    color: white !important;
    border: none !important;
  }
  .badge-right {
    background: linear-gradient(135deg, var(--right), #f87171) !important;
    color: white !important;
    border: none !important;
  }
`;
document.head.appendChild(style);

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}