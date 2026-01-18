// State
let storyData = null;
let timelineData = null;
let currentTab = 'compare';

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
async function fetchStory(id) {
  const res = await fetch(`/api/story/${id}`);
  if (!res.ok) throw new Error('Story not found');
  return res.json();
}

async function fetchTimeline(id) {
  const res = await fetch(`/api/story/${id}/timeline`);
  if (!res.ok) throw new Error('Timeline not found');
  return res.json();
}

// Render
function renderHeader() {
  if (!storyData) return;
  
  document.getElementById('title').textContent = storyData.title;
  document.getElementById('coveragePill').textContent = 
    `${storyData.coverage} source${storyData.coverage !== 1 ? 's' : ''}`;
  document.getElementById('leanPill').textContent = storyData.lean || 'Unknown';
  document.getElementById('scorePill').textContent = 
    `Bias Score ${storyData.bias_score?.toFixed(2) || '0.00'}`;
  
  renderBiasBar();
}

function renderBiasBar() {
  const bar = storyData.bias_bar || {};
  const segments = [
    { type: 'left', value: bar.left || 0 },
    { type: 'center', value: bar.center || 0 },
    { type: 'right', value: bar.right || 0 },
    { type: 'unknown', value: bar.unknown || 0 }
  ].filter(seg => seg.value > 0);
  
  const html = segments.map(seg => `
    <div class="biasSegment ${seg.type}" style="width: ${seg.value * 100}%"></div>
  `).join('');
  
  document.getElementById('bar').innerHTML = html;
}

function renderCompare() {
  const container = document.getElementById('compare');
  const compare = storyData.compare || {};
  
  const buckets = [
    { key: 'left', label: 'Left-Leaning Coverage' },
    { key: 'center', label: 'Center Coverage' },
    { key: 'right', label: 'Right-Leaning Coverage' },
    { key: 'unknown', label: 'Unknown Bias' }
  ];
  
  const html = buckets
    .filter(b => compare[b.key] && compare[b.key].length > 0)
    .map(bucket => {
      const articles = compare[bucket.key];
      return `
        <div class="compareGroup">
          <div class="compareHeader ${bucket.key}">${bucket.label}</div>
          <div class="articleList">
            ${articles.map(a => renderArticle(a)).join('')}
          </div>
        </div>
      `;
    })
    .join('');
  
  container.innerHTML = html || '<div class="empty"><p>No comparison data available</p></div>';
}

function renderTimeline() {
  const container = document.getElementById('timeline');
  
  if (!timelineData) {
    container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading timeline...</p></div>';
    return;
  }
  
  if (!timelineData.timeline_items || timelineData.timeline_items.length === 0) {
    container.innerHTML = '<div class="empty"><p>No timeline data available</p></div>';
    return;
  }
  
  let html = '';
  
  // Coverage stats
  html += `
    <div class="coverageStats">
      <div class="coverageStat">
        <div class="coverageStatLabel">Coverage Span</div>
        <div class="coverageStatValue">${timelineData.coverage_span_hours}h</div>
      </div>
      <div class="coverageStat">
        <div class="coverageStatLabel">Total Articles</div>
        <div class="coverageStatValue">${timelineData.total_articles}</div>
      </div>
      <div class="coverageStat">
        <div class="coverageStatLabel">Phases</div>
        <div class="coverageStatValue">${timelineData.phases?.length || 0}</div>
      </div>
    </div>
  `;
  
  // First reported
  if (timelineData.first_reported_by) {
    const first = timelineData.first_reported_by;
    const time = formatTime(new Date(first.timestamp));
    html += `
      <div class="firstReported">
        <div class="firstReportedLabel">First Reported By</div>
        <div class="firstReportedContent">
          <div class="firstReportedPublisher">${escapeHtml(first.publisher)}</div>
          <div class="firstReportedTitle">${escapeHtml(first.title)}</div>
          <div style="font-size: 12px; color: var(--text-subtle); margin-top: 4px;">${time}</div>
        </div>
      </div>
    `;
  }
  
  // Phases
  if (timelineData.phases && timelineData.phases.length > 0) {
    html += '<div class="timeline">';
    
    for (let i = 0; i < timelineData.phases.length; i++) {
      const phase = timelineData.phases[i];
      const phaseTime = formatTime(new Date(phase.start_time));
      
      html += `
        <div class="timelinePhase">
          <div class="phaseHeader">
            <div class="phaseNumber">${phase.phase_number}</div>
            <div class="phaseInfo">
              <div class="phaseTime">${phaseTime}</div>
              <div class="phaseStats">
                <span>${phase.article_count} article${phase.article_count !== 1 ? 's' : ''}</span>
                <span class="phaseBias ${phase.dominant_bias}">${phase.dominant_bias}</span>
              </div>
            </div>
          </div>
          <div class="timelineArticles">
            ${phase.articles.map(article => `
              <div class="timelineArticle ${article.bias_bucket}">
                <div class="timelineArticleHeader">
                  <div class="timelinePublisher">${escapeHtml(article.publisher)}</div>
                  <div class="timelineTime">${formatTime(new Date(article.timestamp))}</div>
                </div>
                <div class="timelineTitle">
                  <a href="${escapeHtml(article.link)}" target="_blank" rel="noopener">
                    ${escapeHtml(article.title)}
                  </a>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      
      // Show narrative shift if exists
      const shift = timelineData.narrative_shifts?.find(s => s.phase_index === i + 1);
      if (shift) {
        html += `
          <div class="narrativeShift">
            <div class="narrativeShiftText">${escapeHtml(shift.description)}</div>
          </div>
        `;
      }
    }
    
    html += '</div>';
  }
  
  container.innerHTML = html;
}

function renderAll() {
  const container = document.getElementById('all');
  const articles = storyData.articles || [];
  
  if (articles.length === 0) {
    container.innerHTML = '<div class="empty"><p>No articles available</p></div>';
    return;
  }
  
  const html = `
    <div class="articleList">
      ${articles.map(a => renderArticle(a)).join('')}
    </div>
  `;
  
  container.innerHTML = html;
}

function renderArticle(article) {
  const publisher = article.publisher_name || article.domain || 'Unknown';
  const time = article.published ? formatTime(new Date(article.published)) : '';
  
  return `
    <div class="article">
      <div class="articleTitle">
        <a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(article.title)}
        </a>
      </div>
      <div class="articleMeta">
        <span class="articlePublisher">${escapeHtml(publisher)}</span>
        ${time ? `<span class="articleTime">${time}</span>` : ''}
      </div>
      ${article.summary ? `<p style="margin-top: 8px; font-size: 13px; color: var(--text-secondary); line-height: 1.5;">${escapeHtml(article.summary)}</p>` : ''}
    </div>
  `;
}

// Tabs
function switchTab(tabName) {
  currentTab = tabName;
  
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  
  // Update panels
  document.querySelectorAll('.panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== tabName);
  });
  
  // Load timeline data if needed
  if (tabName === 'timeline' && !timelineData) {
    loadTimeline();
  }
}

async function loadTimeline() {
  const storyId = window.__STORY_ID__;
  if (!storyId) return;
  
  try {
    timelineData = await fetchTimeline(storyId);
    renderTimeline();
  } catch (err) {
    console.error('Failed to load timeline:', err);
    const container = document.getElementById('timeline');
    container.innerHTML = '<div class="empty"><p>Failed to load timeline</p></div>';
  }
}

// Utilities
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function formatTime(date) {
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  // Show date and time
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Init
async function init() {
  initTheme();
  
  // Get story ID from window variable (set by template)
  const storyId = window.__STORY_ID__;
  
  if (!storyId) {
    document.getElementById('title').textContent = 'Story ID missing';
    return;
  }
  
  // Event listeners
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  
  // Load story
  try {
    storyData = await fetchStory(storyId);
    renderHeader();
    renderCompare();
    renderAll();
  } catch (err) {
    console.error('Failed to load story:', err);
    document.getElementById('title').textContent = 'Story not found';
  }
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}