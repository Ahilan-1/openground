// State
let state = {
  category: 'All',
  query: '',
  stories: [],
  offset: 0,
  limit: 30,
  hasMore: true,
  loading: false,
  categories: []
};

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
  console.log('Theme switched to:', next);
}

// API
async function fetchMeta() {
  try {
    const res = await fetch('/api/meta');
    if (!res.ok) throw new Error('Meta fetch failed');
    return await res.json();
  } catch (err) {
    console.error('fetchMeta error:', err);
    return { last_updated: null, stories: 0, articles: 0 };
  }
}

async function fetchCategories() {
  try {
    const res = await fetch('/api/categories');
    if (!res.ok) throw new Error('Categories fetch failed');
    const data = await res.json();
    return data.categories || ['All'];
  } catch (err) {
    console.error('fetchCategories error:', err);
    return ['All'];
  }
}

async function fetchStories(category, query, limit, offset) {
  try {
    const params = new URLSearchParams({ 
      category: category || 'All', 
      q: query || '', 
      limit: limit.toString(), 
      offset: offset.toString() 
    });
    const res = await fetch(`/api/stories?${params}`);
    if (!res.ok) throw new Error('Stories fetch failed');
    return await res.json();
  } catch (err) {
    console.error('fetchStories error:', err);
    return { last_updated: null, total: 0, items: [] };
  }
}

async function refreshData() {
  const btn = document.getElementById('refreshBtn');
  if (!btn) return;
  
  btn.disabled = true;
  btn.textContent = 'Refreshing...';
  
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json();
    
    if (data.ok) {
      state.offset = 0;
      state.stories = [];
      await loadStories();
      await updateMeta();
      showToast(`✓ Added ${data.added_articles} articles, ${data.stories} stories`);
    } else {
      throw new Error('Refresh returned not ok');
    }
  } catch (err) {
    console.error('Refresh error:', err);
    showToast('✗ Refresh failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

// Render
function renderCategories() {
  const nav = document.getElementById('cats');
  if (!nav) return;
  
  nav.innerHTML = state.categories.map(cat => `
    <button 
      class="cat ${cat === state.category ? 'active' : ''}" 
      data-cat="${cat}"
    >
      <span>${cat}</span>
    </button>
  `).join('');
  
  nav.querySelectorAll('.cat').forEach(el => {
    el.addEventListener('click', () => {
      const newCat = el.dataset.cat;
      if (newCat === state.category) return;
      
      state.category = newCat;
      state.offset = 0;
      state.stories = [];
      renderCategories();
      loadStories();
      updateStatCategory();
    });
  });
}

function renderStories() {
  const grid = document.getElementById('grid');
  if (!grid) return;
  
  if (state.stories.length === 0 && !state.loading) {
    grid.innerHTML = `
      <div class="empty" style="grid-column: 1/-1;">
        <h3>No stories found</h3>
        <p>Try a different category or search term, or click Refresh to fetch new articles</p>
      </div>
    `;
    return;
  }
  
  const html = state.stories.map(s => {
    const bar = s.bias_bar || {};
    const segments = [
      { type: 'left', value: bar.left || 0 },
      { type: 'center', value: bar.center || 0 },
      { type: 'right', value: bar.right || 0 },
      { type: 'unknown', value: bar.unknown || 0 }
    ].filter(seg => seg.value > 0);
    
    return `
      <div class="story" data-id="${s.story_id}" onclick="viewStory('${s.story_id}')">
        <div class="storyTitle">${escapeHtml(s.title)}</div>
        <div class="storyMeta">
          <span class="pill">${s.coverage} source${s.coverage !== 1 ? 's' : ''}</span>
          <span class="pill">${s.lean || 'Unknown'}</span>
          <span class="pill">Score ${(s.bias_score || 0).toFixed(2)}</span>
        </div>
        <div class="biasBarWrap">
          <div class="biasLabels">
            <span>Left</span>
            <span>Center</span>
            <span>Right</span>
            <span>Unknown</span>
          </div>
          <div class="biasBar">
            ${segments.length > 0 ? segments.map(seg => `
              <div class="biasSegment ${seg.type}" style="width: ${(seg.value * 100).toFixed(1)}%"></div>
            `).join('') : '<div class="biasSegment unknown" style="width: 100%"></div>'}
          </div>
        </div>
        <div class="storyActions">
          <button class="btn ghost wide" onclick="event.stopPropagation(); viewStory('${s.story_id}')">
            View Coverage
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  grid.innerHTML = html;
}

function updateStatCategory() {
  const el = document.getElementById('statCat');
  if (el) el.textContent = state.category;
}

function updateStatStories(total) {
  const el = document.getElementById('statStories');
  if (el) el.textContent = total;
}

async function updateMeta() {
  try {
    const meta = await fetchMeta();
    const el = document.getElementById('updatedText');
    const statEl = document.getElementById('statUpdated');
    
    if (meta.last_updated) {
      const date = new Date(meta.last_updated);
      const formatted = formatRelativeTime(date);
      if (el) el.textContent = `Updated ${formatted}`;
      if (statEl) statEl.textContent = formatted;
    } else {
      if (el) el.textContent = 'Not updated yet';
      if (statEl) statEl.textContent = '—';
    }
  } catch (err) {
    console.error('updateMeta error:', err);
  }
}

async function loadStories() {
  if (state.loading) {
    console.log('Already loading, skipping...');
    return;
  }
  
  state.loading = true;
  const grid = document.getElementById('grid');
  
  if (state.offset === 0 && grid) {
    grid.innerHTML = `
      <div class="loading" style="grid-column: 1/-1;">
        <div class="spinner"></div>
        <p>Loading stories...</p>
      </div>
    `;
  }
  
  try {
    console.log('Loading stories:', { category: state.category, query: state.query, offset: state.offset });
    const data = await fetchStories(state.category, state.query, state.limit, state.offset);
    console.log('Loaded:', data);
    
    if (state.offset === 0) {
      state.stories = data.items || [];
    } else {
      state.stories = [...state.stories, ...(data.items || [])];
    }
    
    state.hasMore = state.stories.length < (data.total || 0);
    
    renderStories();
    updateStatStories(data.total || 0);
    updateMoreButton();
  } catch (err) {
    console.error('Load failed:', err);
    if (grid) {
      grid.innerHTML = `
        <div class="empty" style="grid-column: 1/-1;">
          <h3>Failed to load</h3>
          <p>Error: ${err.message}</p>
          <button class="btn primary" onclick="loadStories()">Retry</button>
        </div>
      `;
    }
  } finally {
    state.loading = false;
  }
}

function updateMoreButton() {
  const btn = document.getElementById('more');
  if (!btn) return;
  btn.style.display = state.hasMore ? 'block' : 'none';
}

function loadMore() {
  state.offset += state.limit;
  loadStories();
}

// Search
let searchTimeout;
function handleSearch(e) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.query = e.target.value;
    state.offset = 0;
    state.stories = [];
    loadStories();
  }, 300);
}

function clearSearch() {
  const input = document.getElementById('q');
  if (input) input.value = '';
  state.query = '';
  state.offset = 0;
  state.stories = [];
  loadStories();
}

// Navigation
function viewStory(id) {
  console.log('Navigating to story:', id);
  window.location.href = `/story/${id}`;
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
  // Remove any existing toasts
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
    max-width: 400px;
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
  console.log('🚀 OpenGround initializing...');
  
  initTheme();
  
  // Event listeners
  const themeBtn = document.getElementById('themeBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const searchInput = document.getElementById('q');
  const clearBtn = document.getElementById('clear');
  const moreBtn = document.getElementById('more');
  
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  if (refreshBtn) refreshBtn.addEventListener('click', refreshData);
  if (searchInput) searchInput.addEventListener('input', handleSearch);
  if (clearBtn) clearBtn.addEventListener('click', clearSearch);
  if (moreBtn) moreBtn.addEventListener('click', loadMore);
  
  // Load data
  console.log('Loading categories...');
  state.categories = await fetchCategories();
  console.log('Categories loaded:', state.categories);
  
  renderCategories();
  
  console.log('Loading stories...');
  await loadStories();
  await updateMeta();
  
  console.log('✓ OpenGround ready!');
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
`;
document.head.appendChild(style);

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}