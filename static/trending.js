// State
let topics = [];
let loading = false;

// Theme
function initTheme() {
  const saved = localStorage.getItem('openground-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('openground-theme', next);
}

// API
async function fetchTrending() {
  const res = await fetch('/api/trending');
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
      await loadTrending();
      showToast(`✓ Refreshed: ${data.stories} stories analyzed`);
    }
  } catch (err) {
    showToast('✗ Refresh failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

// Render
function renderTrending() {
  const grid = document.getElementById('grid');
  
  if (topics.length === 0 && !loading) {
    grid.innerHTML = `
      <div class="empty" style="grid-column: 1/-1;">
        <h3>No trending topics detected</h3>
        <p>Try clicking Refresh to analyze recent articles</p>
      </div>
    `;
    return;
  }
  
  const html = topics.map((topic, index) => {
    const velocity = topic.velocity || 0;
    const velocityClass = velocity > 0.5 ? 'hot' : velocity > 0.3 ? 'warm' : 'cool';
    const velocityLabel = velocity > 0.5 ? 'Surging' : velocity > 0.3 ? 'Rising' : 'Steady';
    
    const rank = index + 1;
    const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
    
    return `
      <div class="trendingCard">
        <div class="trendingHeader">
          <div class="trendingKeyword">${emoji} ${escapeHtml(topic.keyword)}</div>
          <div class="heatBadge">${Math.round(topic.heat_score)}</div>
        </div>
        
        <div class="trendingStats">
          <div class="trendingStat">
            <div class="trendingStatLabel">Mentions</div>
            <div class="trendingStatValue">${topic.count}</div>
          </div>
          <div class="trendingStat">
            <div class="trendingStatLabel">Sources</div>
            <div class="trendingStatValue">${topic.sources}</div>
          </div>
          <div class="trendingStat">
            <div class="trendingStatLabel">Momentum</div>
            <div class="trendingStatValue">
              <span class="velocityIndicator ${velocityClass}">${velocityLabel}</span>
            </div>
          </div>
        </div>
        
        ${topic.sample_headlines && topic.sample_headlines.length > 0 ? `
          <div class="sampleHeadlines">
            ${topic.sample_headlines.slice(0, 3).map(h => `
              <div class="sampleHeadline">${escapeHtml(h)}</div>
            `).join('')}
          </div>
        ` : ''}
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

async function loadTrending() {
  if (loading) return;
  
  loading = true;
  const grid = document.getElementById('grid');
  
  grid.innerHTML = `
    <div class="loading" style="grid-column: 1/-1;">
      <div class="spinner"></div>
      <p>Analyzing trending topics...</p>
    </div>
  `;
  
  try {
    const data = await fetchTrending();
    topics = data.topics || [];
    renderTrending();
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

// Utilities
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
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
  document.querySelectorAll('.toast').forEach(t => t.remove());
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    background: ${type === 'error' ? 'var(--danger)' : 'var(--success)'};
    color: white;
    padding: 16px 24px;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-xl);
    font-weight: 600;
    font-size: 14px;
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
  
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('refreshBtn').addEventListener('click', refreshData);
  
  await loadTrending();
}

// Animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}